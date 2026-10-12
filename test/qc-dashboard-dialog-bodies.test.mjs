// Collector item 4 tests — dialog popup body retrieval, identity matching,
// pagination, and content/domain checks.
//
// Popup fixture is a captured, sanitized shape from a live read-only probe
// against QPRO1 (id=701) on 2026-08-10 — id/code/locale_id/content/title/cta
// fields only, nothing site-identifying beyond the catalogue itself.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPopupCatalogue, resolveDialogBodiesForPromotion, checkDialogBodyDomains,
  resetPopupCatalogueCache,
} from '../src/qc-dashboard/canonical/dialog-bodies.js';
import { liveFromQpro } from '../src/qc-dashboard/canonical/qpro-adapter.js';
import { liveFromQp2 } from '../src/qc-dashboard/canonical/qp2-adapter.js';

const POPUP_701 = {
  id: 701, code: 'SBLEK', platform: 1, label: 'Deposit 200 Get 61',
  location: 1, start_date: '2026-08-06T05:15:46.000000Z', end_date: null,
  session: 3, position: 99, status: 1, locale_ids: [6, 7], locale_name: 'SG_EN,SG_ZH',
  contents: [
    {
      id: 2222, popup_id: 701, locale_id: 6, locale_name: 'SG_EN',
      title: 'Deposit 200 Get 61',
      content: '<p><strong>How to Apply:</strong></p><ol><li>Go to Transfer.</li></ol>',
      cta_button_link_1: '/member/deposit', cta_button_link_2: '/member/message',
    },
    {
      id: 2223, popup_id: 701, locale_id: 7, locale_name: 'SG_ZH',
      title: '存200送61',
      content: '<p><strong>如何申请：</strong></p><ol><li>前往转账。</li></ol>',
      cta_button_link_1: '/member/deposit', cta_button_link_2: '/member/message',
    },
  ],
};

// A second popup belonging to a DIFFERENT merchant (QP2 multi-merchant BO).
const POPUP_800_OTHER_MERCHANT = {
  id: 800, code: 'ZZZZZ', site_id: 99, locale_ids: [1],
  contents: [{ id: 3001, popup_id: 800, locale_id: 1, locale_name: 'MY_EN', title: 'Other', content: 'other merchant content' }],
};

function fakeSite(id = 'qpro1') { return { id }; }
function catalogueFrom(rows) {
  return { source: 'api:/api/bo/popups', siteId: 'qpro1', complete: true, byId: new Map(rows.map((p) => [p.id, p])) };
}

test.beforeEach(() => resetPopupCatalogueCache());

// ── getPopupCatalogue: pagination + cache + failure handling ────────────

test('getPopupCatalogue walks every page — proves the pre-item-4 page=1-only gap is closed', async () => {
  const page1 = { data: { rows: [{ id: 900 }], paginations: { last_page: 2, total: 701 } } };
  const page2 = { data: { rows: [POPUP_701], paginations: { last_page: 2, total: 701 } } };
  let calls = [];
  const fetchImpl = async (site, path) => { calls.push(path); return path.includes('page=2') ? page2 : page1; };
  const catalogue = await getPopupCatalogue(fakeSite(), { now: 1000, fetchImpl });
  assert.equal(catalogue.total, 701);
  assert.equal(catalogue.pages, 2);
  assert.ok(catalogue.byId.has(701), 'popup 701 (only reachable via page 2) must be present in the walked catalogue');
  assert.ok(catalogue.byId.has(900));
  assert.equal(calls.length, 2);
});

test('getPopupCatalogue caches within TTL, refetches after it elapses', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { data: { rows: [POPUP_701], paginations: { last_page: 1, total: 1 } } }; };
  await getPopupCatalogue(fakeSite(), { now: 1000, ttlMs: 5000, fetchImpl });
  await getPopupCatalogue(fakeSite(), { now: 2000, ttlMs: 5000, fetchImpl });
  assert.equal(calls, 1, 'second call within TTL reuses the cache');
  await getPopupCatalogue(fakeSite(), { now: 7000, ttlMs: 5000, fetchImpl });
  assert.equal(calls, 2, 'call after TTL elapses refetches');
});

test('getPopupCatalogue on fetch failure returns complete:false and does not cache the failure', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) throw new Error('BO temporarily unreachable');
    return { data: { rows: [POPUP_701], paginations: { last_page: 1, total: 1 } } };
  };
  const failed = await getPopupCatalogue(fakeSite(), { now: 1000, fetchImpl });
  assert.equal(failed.complete, false);
  const recovered = await getPopupCatalogue(fakeSite(), { now: 1001, fetchImpl });
  assert.equal(recovered.complete, true);
  assert.equal(calls, 2);
});

// ── resolveDialogBodiesForPromotion: happy path + locale extraction ─────

test('resolveDialogBodiesForPromotion extracts localized bodies + titles from a real captured popup shape', () => {
  const catalogue = catalogueFrom([POPUP_701]);
  const result = resolveDialogBodiesForPromotion({
    dialogLinks: [{ id: 714, promotion_id: 1178, popup_id: 701 }],
    promotionId: 1178,
    catalogue,
  });
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(result.matchedPopupIds, [701]);
  assert.deepEqual(result.localesDeclared, ['SG_EN', 'SG_ZH']);
  assert.match(result.dialogBodyByLocale.SG_EN, /How to Apply/);
  assert.match(result.dialogBodyByLocale.SG_ZH, /如何申请/);
  assert.equal(result.dialogTitleByLocale.SG_EN, 'Deposit 200 Get 61');
  assert.equal(result.dialogTitleByLocale.SG_ZH, '存200送61');
  // Language bucket collapses SG_EN -> EN (first-writer-wins, same convention as MT/name resolution).
  assert.match(result.dialogBody.EN, /How to Apply/);
});

// ── identity rejection: never attribute a body to the wrong promotion ───

test('resolveDialogBodiesForPromotion rejects a link whose promotion_id disagrees (stale/cross-wired)', () => {
  const catalogue = catalogueFrom([POPUP_701]);
  const result = resolveDialogBodiesForPromotion({
    dialogLinks: [{ id: 714, promotion_id: 9999, popup_id: 701 }], // wrong promotion_id
    promotionId: 1178,
    catalogue,
  });
  assert.deepEqual(result.matchedPopupIds, []);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].reason, 'promotion-id-mismatch');
  assert.deepEqual(result.dialogBodyByLocale, {}, 'a mismatched link must never contribute its body');
});

test('resolveDialogBodiesForPromotion rejects duplicate popup_id entries on the same link list', () => {
  const catalogue = catalogueFrom([POPUP_701]);
  const result = resolveDialogBodiesForPromotion({
    dialogLinks: [
      { id: 714, promotion_id: 1178, popup_id: 701 },
      { id: 715, promotion_id: 1178, popup_id: 701 }, // duplicate
    ],
    promotionId: 1178,
    catalogue,
  });
  assert.deepEqual(result.matchedPopupIds, [701]);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].reason, 'duplicate-popup-id');
});

test('resolveDialogBodiesForPromotion distinguishes popup-id-not-found from catalogue-incomplete', () => {
  const completeCatalogue = catalogueFrom([POPUP_701]);
  const r1 = resolveDialogBodiesForPromotion({
    dialogLinks: [{ id: 1, promotion_id: 1, popup_id: 555 }], promotionId: 1, catalogue: completeCatalogue,
  });
  assert.equal(r1.rejected[0].reason, 'popup-id-not-found');

  const incompleteCatalogue = { source: 'api:/api/bo/popups', complete: false, byId: new Map() };
  const r2 = resolveDialogBodiesForPromotion({
    dialogLinks: [{ id: 1, promotion_id: 1, popup_id: 555 }], promotionId: 1, catalogue: incompleteCatalogue,
  });
  assert.equal(r2.rejected[0].reason, 'catalogue-incomplete', 'a known-incomplete catalogue must be distinguishable from a genuinely absent popup');
});

test('resolveDialogBodiesForPromotion rejects a popup belonging to a different merchant when merchantId is asserted', () => {
  const catalogue = catalogueFrom([POPUP_800_OTHER_MERCHANT]);
  const result = resolveDialogBodiesForPromotion({
    dialogLinks: [{ id: 1, promotion_id: 1, popup_id: 800 }],
    promotionId: 1,
    catalogue,
    merchantId: 1, // popup.site_id is 99
  });
  assert.equal(result.rejected[0].reason, 'merchant-mismatch');
  assert.deepEqual(result.dialogBodyByLocale, {});
});

test('resolveDialogBodiesForPromotion without merchantId never triggers the merchant check (QP2 conservative default)', () => {
  const catalogue = catalogueFrom([POPUP_800_OTHER_MERCHANT]);
  const result = resolveDialogBodiesForPromotion({
    dialogLinks: [{ id: 1, promotion_id: 1, popup_id: 800 }], promotionId: 1, catalogue,
  });
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(result.matchedPopupIds, [800]);
});

test('resolveDialogBodiesForPromotion with no links or no catalogue returns empty without throwing', () => {
  assert.deepEqual(resolveDialogBodiesForPromotion({}).dialogBodyByLocale, {});
  assert.deepEqual(resolveDialogBodiesForPromotion({ dialogLinks: [{ popup_id: 1 }] }).rejected[0].reason, 'popup-id-not-found');
});

// ── content/domain check — reuses the proven MT foreign-domain detector ──

test('checkDialogBodyDomains flags a foreign brand domain hardcoded into a dialog CTA link (QPRO)', () => {
  const domainToBrand = new Map([['sibling-brand.com', 'QPRO2'], ['own-brand.com', 'QPRO1']]);
  const findings = checkDialogBodyDomains({
    dialogTitleByLocale: { MY_EN: 'Deposit Bonus' },
    dialogBodyByLocale: { MY_EN: 'Click here' },
    ctaLinksByLocale: { MY_EN: ['https://sibling-brand.com/member/deposit'] },
  }, { brand: 'QPRO1', platform: 'qpro', domainToBrand });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, 'foreign-tnc-domain');
  assert.match(findings[0].message, /sibling-brand\.com/);
});

test('checkDialogBodyDomains does not false-positive on the promo\'s own domain or an unlisted domain', () => {
  const domainToBrand = new Map([['own-brand.com', 'QPRO1']]);
  const findings = checkDialogBodyDomains({
    dialogTitleByLocale: { MY_EN: 'Deposit Bonus' },
    dialogBodyByLocale: { MY_EN: 'Visit https://own-brand.com/promo or https://unrelated-random-site.example' },
    ctaLinksByLocale: {},
  }, { brand: 'QPRO1', platform: 'qpro', domainToBrand });
  assert.deepEqual(findings, []);
});

test('checkDialogBodyDomains flags ANY literal directory domain on QP2 (shared BO must use :url placeholder)', () => {
  const domainToBrand = new Map([['qp2a-brand.com', 'QP2A']]);
  const findings = checkDialogBodyDomains({
    dialogTitleByLocale: {},
    dialogBodyByLocale: { EN: 'Visit https://qp2a-brand.com/deposit' },
    ctaLinksByLocale: {},
  }, { brand: 'QP2A', platform: 'qp2', domainToBrand });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, 'qp2-literal-domain');
});

// ── adapter integration ──────────────────────────────────────────────────

test('liveFromQpro populates dialogBody/dialogBodyByLocale/dialogTitleByLocale end-to-end when a popup catalogue is supplied', () => {
  const catalogue = { popups: catalogueFrom([POPUP_701]) };
  const liveState = {
    list_row: {
      id: 1178, code: 'P999', bonus_type: 'Deposit - Reload',
      dialog_popup_list: [{ id: 714, promotion_id: 1178, popup_id: 701 }],
    },
    detail: {},
  };
  const c = liveFromQpro(liveState, { brand: 'QPRO1', catalogue });
  assert.match(c.content.dialogBodyByLocale.SG_EN, /How to Apply/);
  assert.equal(c.content.dialogTitleByLocale.SG_ZH, '存200送61');
  assert.deepEqual(c.content.dialogEvidence.matchedPopupIds, [701]);
  assert.deepEqual(c.content.dialogEvidence.rejected, []);
  assert.ok(c.content.localesDeclared.includes('SG_EN') && c.content.localesDeclared.includes('SG_ZH'));
});

test('liveFromQpro leaves dialogBody empty (unchanged from pre-item-4 behavior) when no popup catalogue is supplied', () => {
  const liveState = {
    list_row: { id: 1178, code: 'P999', bonus_type: 'Deposit - Reload', dialog_popup_list: [{ id: 714, promotion_id: 1178, popup_id: 701 }] },
    detail: {},
  };
  const c = liveFromQpro(liveState, { brand: 'QPRO1' });
  assert.deepEqual(c.content.dialogBody, {});
  assert.deepEqual(c.content.dialogBodyByLocale, {});
});

test('liveFromQp2 populates dialog bodies end-to-end and unions dialog locales into localesDeclared alongside promo-name locales', () => {
  const catalogue = { popups: catalogueFrom([POPUP_701]) };
  const liveState = {
    list_row: {
      id: 1178, code: 'P998', bonus_type: 'Free Spin',
      dialog_popup_list: [{ id: 714, promotion_id: 1178, popup_id: 701 }],
    },
    detail: {
      promotion_name_list: [{ locale: 'MY_EN', promotion_name: 'Test Promo' }],
    },
  };
  const c = liveFromQp2(liveState, { brand: 'QP2A', catalogue });
  assert.match(c.content.dialogBodyByLocale.SG_EN, /How to Apply/);
  // Union: MY_EN (from promo name) + SG_EN/SG_ZH (from dialog) all present, no duplicates.
  assert.deepEqual(c.content.localesDeclared, ['MY_EN', 'SG_EN', 'SG_ZH']);
});
