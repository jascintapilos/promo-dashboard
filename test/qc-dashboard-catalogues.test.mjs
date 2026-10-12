// Collector item 2 tests — authoritative category/provider catalogues.
//
// Fixtures below are captured, sanitized shapes from a live read-only probe
// against QPRO1 / QPRO11 / QP2(ibc22) on 2026-08-10 (id/code/name/type/
// position only — nothing site-identifying beyond the catalogue itself).
// This is the evidence CG=CRASH, CK=CRICKET, FS=FISHING, ES=E-SPORTS,
// LT=LOTTERY, AR=ARCADE, PK=POKER actually resolve to on the live BO.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCategoryCatalogue, getProviderCatalogue, resolveCategoryCode,
  checkProviderCodesAgainstCatalogue, resetCatalogueCache, canonicalizeCatalogueName,
} from '../src/qc-dashboard/canonical/catalogues.js';
import { categoriesFromShortCodesDetailed } from '../src/qc-dashboard/canonical/listing-row-fields.js';
import { liveFromQpro } from '../src/qc-dashboard/canonical/qpro-adapter.js';
import { liveFromQp2 } from '../src/qc-dashboard/canonical/qp2-adapter.js';

// Sanitized capture — QPRO1 /api/bo/categories, 2026-08-10.
const QPRO1_CATEGORY_ROWS = [
  { id: 1, code: 'SP', name: 'SPORT', type: 1, position: 4 },
  { id: 2, code: 'LC', name: 'LIVE CASINO', type: 1, position: 3 },
  { id: 3, code: 'SL', name: 'SLOTS', type: 1, position: 2 },
  { id: 4, code: 'ES', name: 'E-SPORTS', type: 1, position: 5 },
  { id: 5, code: 'FS', name: 'FISHING', type: 1, position: 6 },
  { id: 6, code: 'LT', name: 'LOTTERY', type: 1, position: 7 },
  { id: 7, code: 'NEW', name: 'NEW MEMBER', type: 2, position: 8 },
  { id: 8, code: 'VIP', name: 'VIP', type: 2, position: 9 },
  { id: 9, code: 'EVENT', name: 'EVENT', type: 2, position: 10 },
  { id: 10, code: 'PK', name: 'POKER', type: 1, position: 11 },
  { id: 11, code: 'WIN', name: 'WINNER', type: 2, position: 12 },
  { id: 12, code: 'LT2', name: 'LOTTERY2', type: 1, position: 13 },
  { id: 13, code: 'CF', name: 'COCK FIGHT', type: 1, position: 14 },
  { id: 14, code: 'CG', name: 'CRASH', type: 1, position: 15 },
  { id: 15, code: 'TB', name: 'TABLE', type: 1, position: 16 },
  { id: 16, code: 'AR', name: 'ARCADE', type: 1, position: 17 },
  { id: 17, code: 'CK', name: 'CRICKET', type: 1, position: 18 },
  { id: 18, code: 'ALL', name: 'SHOW ALL', type: 2, position: 19 },
];

// Sanitized capture — QPRO1 /api/bo/gameprovider (compact — id/code/name only).
const QPRO1_PROVIDER_ROWS = [
  { id: 95, code: 'AP', name: 'AdvantPlay' },
  { id: 19, code: 'AB', name: 'Allbet' },
  { id: 65, code: 'AVI', name: 'Aviatrix' },
  { id: 24, code: 'BG', name: 'Big Gaming' },
  { id: 72, code: 'BOOM', name: 'Booming Game' },
];

function fakeSite(id = 'qpro1') { return { id }; }

test.beforeEach(() => resetCatalogueCache());

// ── getCategoryCatalogue / getProviderCatalogue ─────────────────────────

test('getCategoryCatalogue resolves byCode from the live fetch and tags source', async () => {
  const catalogue = await getCategoryCatalogue(fakeSite(), {
    now: 1000,
    fetchImpl: async () => QPRO1_CATEGORY_ROWS,
  });
  assert.equal(catalogue.complete, true);
  assert.equal(catalogue.source, 'api:/api/bo/categories');
  assert.equal(catalogue.siteId, 'qpro1');
  assert.equal(catalogue.byCode.CG, 'CRASH');
  assert.equal(catalogue.byCode.CK, 'CRICKET');
  assert.equal(catalogue.byCode.FS, 'FISHING');
  assert.equal(catalogue.byCode.ES, 'E-SPORTS');
});

test('getCategoryCatalogue caches within the TTL — fetchImpl called once', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return QPRO1_CATEGORY_ROWS; };
  await getCategoryCatalogue(fakeSite(), { now: 1000, ttlMs: 5000, fetchImpl });
  await getCategoryCatalogue(fakeSite(), { now: 2000, ttlMs: 5000, fetchImpl });
  assert.equal(calls, 1, 'second call within TTL must reuse the cached catalogue');
});

test('getCategoryCatalogue refetches once the TTL has elapsed ("cache briefly")', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return QPRO1_CATEGORY_ROWS; };
  await getCategoryCatalogue(fakeSite(), { now: 1000, ttlMs: 5000, fetchImpl });
  await getCategoryCatalogue(fakeSite(), { now: 7000, ttlMs: 5000, fetchImpl });
  assert.equal(calls, 2, 'a call after the TTL window must refetch, not serve a stale entry forever');
});

test('getCategoryCatalogue on fetch failure returns complete:false and does not cache the failure', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) throw new Error('BO temporarily unreachable');
    return QPRO1_CATEGORY_ROWS;
  };
  const failed = await getCategoryCatalogue(fakeSite(), { now: 1000, ttlMs: 5000, fetchImpl });
  assert.equal(failed.complete, false);
  assert.deepEqual(failed.byCode, {});
  assert.match(failed.error, /BO temporarily unreachable/);

  const recovered = await getCategoryCatalogue(fakeSite(), { now: 1001, ttlMs: 5000, fetchImpl });
  assert.equal(recovered.complete, true, 'a transient failure must not freeze a permanent empty catalogue into the TTL window');
  assert.equal(calls, 2);
});

test('getProviderCatalogue resolves byCode and tags source', async () => {
  const catalogue = await getProviderCatalogue(fakeSite(), {
    now: 1000,
    fetchImpl: async () => ({ rows: QPRO1_PROVIDER_ROWS }),
  });
  assert.equal(catalogue.complete, true);
  assert.equal(catalogue.source, 'api:/api/bo/gameprovider');
  assert.equal(catalogue.byCode.AP, 'AdvantPlay');
  assert.equal(catalogue.byCode.AVI, 'Aviatrix');
});

// ── resolveCategoryCode ──────────────────────────────────────────────────

test('resolveCategoryCode resolves CG/CK/FS/ES from the live catalogue (the previously-unmapped codes)', async () => {
  const catalogue = await getCategoryCatalogue(fakeSite(), { now: 1000, fetchImpl: async () => QPRO1_CATEGORY_ROWS });
  assert.equal(resolveCategoryCode(catalogue, 'CG'), 'CRASH');
  assert.equal(resolveCategoryCode(catalogue, 'CK'), 'CRICKET');
  assert.equal(resolveCategoryCode(catalogue, 'FS'), 'FISHING');
  assert.equal(resolveCategoryCode(catalogue, 'ES'), 'E_SPORTS');
  assert.equal(resolveCategoryCode(catalogue, 'LT'), 'LOTTERY');
  assert.equal(resolveCategoryCode(catalogue, 'AR'), 'ARCADE');
  assert.equal(resolveCategoryCode(catalogue, 'PK'), 'POKER');
});

test('resolveCategoryCode reconciles the SP->"SPORT" catalogue quirk to the established "SPORTS" token', async () => {
  const catalogue = await getCategoryCatalogue(fakeSite(), { now: 1000, fetchImpl: async () => QPRO1_CATEGORY_ROWS });
  assert.equal(resolveCategoryCode(catalogue, 'SP'), 'SPORTS');
});

test('resolveCategoryCode returns null (never a guess) for FH — a previously-invented code with no live evidence', async () => {
  const catalogue = await getCategoryCatalogue(fakeSite(), { now: 1000, fetchImpl: async () => QPRO1_CATEGORY_ROWS });
  assert.equal(resolveCategoryCode(catalogue, 'FH'), null);
});

test('resolveCategoryCode returns null for an unknown future code and for a missing/incomplete catalogue', () => {
  assert.equal(resolveCategoryCode(null, 'SL'), null);
  assert.equal(resolveCategoryCode({ byCode: {} }, 'ZZ'), null);
});

test('canonicalizeCatalogueName performs lossless formatting only, never an interpretive guess', () => {
  assert.equal(canonicalizeCatalogueName('COCK FIGHT'), 'COCK_FIGHT');
  assert.equal(canonicalizeCatalogueName('E-SPORTS'), 'E_SPORTS');
  assert.equal(canonicalizeCatalogueName(null), null);
});

// ── checkProviderCodesAgainstCatalogue ───────────────────────────────────

test('checkProviderCodesAgainstCatalogue flags codes the catalogue does not recognise', async () => {
  const catalogue = await getProviderCatalogue(fakeSite(), { now: 1000, fetchImpl: async () => ({ rows: QPRO1_PROVIDER_ROWS }) });
  const result = checkProviderCodesAgainstCatalogue(catalogue, ['AP', 'AVI', 'ZZZ']);
  assert.equal(result.checked, true);
  assert.deepEqual(result.unknownCodes, ['ZZZ']);
  assert.equal(result.catalogueComplete, true);
});

test('checkProviderCodesAgainstCatalogue reports checked:false when the catalogue itself is incomplete', () => {
  const result = checkProviderCodesAgainstCatalogue({ complete: false, byCode: {} }, ['AP']);
  assert.equal(result.checked, false);
  assert.deepEqual(result.unknownCodes, []);
  assert.equal(result.catalogueComplete, false);
});

// ── categoriesFromShortCodesDetailed with a live catalogue ──────────────

test('categoriesFromShortCodesDetailed resolves CG, CK, ES, FS via catalogue where Phase 2.5 left them unmapped', async () => {
  const catalogue = await getCategoryCatalogue(fakeSite(), { now: 1000, fetchImpl: async () => QPRO1_CATEGORY_ROWS });
  const r = categoriesFromShortCodesDetailed('CG, CK, ES, FS, LC, SL, SP', { catalogue });
  assert.deepEqual(r.unmapped, [], 'every code in this string is now resolvable via the live catalogue');
  assert.equal(r.complete, true);
  assert.deepEqual(r.categories, ['CRASH', 'CRICKET', 'E_SPORTS', 'FISHING', 'LIVE_CASINO', 'SLOTS', 'SPORTS'].sort());
  assert.equal(r.catalogue.source, 'api:/api/bo/categories');
});

test('categoriesFromShortCodesDetailed still preserves FH and a genuine unknown code as unmapped even with a full catalogue', async () => {
  const catalogue = await getCategoryCatalogue(fakeSite(), { now: 1000, fetchImpl: async () => QPRO1_CATEGORY_ROWS });
  const r = categoriesFromShortCodesDetailed('SL, FH, ZZ', { catalogue });
  assert.deepEqual(r.unmapped, ['FH', 'ZZ']);
  assert.equal(r.complete, false);
  assert.ok(r.categories.includes('FH') && r.categories.includes('ZZ'), 'unmapped codes stay visible verbatim, never dropped');
});

test('categoriesFromShortCodesDetailed falls back to the static verified map when no catalogue is supplied', () => {
  const r = categoriesFromShortCodesDetailed('SL, LC, SP');
  assert.deepEqual(r.categories, ['LIVE_CASINO', 'SLOTS', 'SPORTS']);
  assert.equal(r.catalogue, null);
});

test('categoriesFromShortCodesDetailed falls back to the static map for codes an incomplete catalogue could not cover', () => {
  const r = categoriesFromShortCodesDetailed('SL, LC, CG', { catalogue: { complete: false, byCode: {} } });
  assert.deepEqual(r.categories, ['CG', 'LIVE_CASINO', 'SLOTS']);
  assert.deepEqual(r.unmapped, ['CG'], 'an incomplete catalogue must not silently invent CG — it stays unmapped');
});

// ── adapter integration: qpro-adapter / qp2-adapter actually use the catalogue ──

test('liveFromQpro resolves previously-unmapped category codes end-to-end when a catalogue is supplied', async () => {
  const catalogue = { categories: await getCategoryCatalogue(fakeSite('qpro1'), { now: 1000, fetchImpl: async () => QPRO1_CATEGORY_ROWS }) };
  const liveState = {
    list_row: { code: 'P999', category: 'CG, CK', bonus_type: 'Deposit - Reload' },
    detail: {},
  };
  const c = liveFromQpro(liveState, { brand: 'QPRO1', catalogue });
  assert.deepEqual(c.scope.categories, ['CRASH', 'CRICKET']);
  assert.equal(c.scope.categoriesEvidence.complete, true);
  assert.deepEqual(c.scope.categoriesEvidence.unmapped, []);
});

test('liveFromQpro without a catalogue preserves unmapped codes verbatim (no regression from Phase 2.5)', () => {
  const liveState = {
    list_row: { code: 'P999', category: 'CG, CK', bonus_type: 'Deposit - Reload' },
    detail: {},
  };
  const c = liveFromQpro(liveState, { brand: 'QPRO1' });
  assert.deepEqual(c.scope.categories, ['CG', 'CK']);
  assert.equal(c.scope.categoriesEvidence.complete, false);
  assert.deepEqual(c.scope.categoriesEvidence.unmapped, ['CG', 'CK']);
});

test('liveFromQpro flags an unrecognised provider code via gameProviderCodesEvidence without affecting scope.gameProviderCodes', async () => {
  const catalogue = { providers: await getProviderCatalogue(fakeSite('qpro1'), { now: 1000, fetchImpl: async () => ({ rows: QPRO1_PROVIDER_ROWS }) }) };
  const liveState = {
    list_row: { code: 'P999', game_provider: 'AP, ZZZ', bonus_type: 'Deposit - Reload' },
    detail: {},
  };
  const c = liveFromQpro(liveState, { brand: 'QPRO1', catalogue });
  assert.deepEqual(c.scope.gameProviderCodes, ['AP', 'ZZZ'], 'the compared field itself is untouched by the catalogue check');
  assert.equal(c.scope.gameProviderCodesEvidence.checked, true);
  assert.deepEqual(c.scope.gameProviderCodesEvidence.unknownCodes, ['ZZZ']);
  assert.equal(c.scope.gameProviderCodesSource, 'listing-row', 'detail/target were empty — listing-row string is the fallback of last resort');
});

test('Gap-closure item 3: liveFromQpro/liveFromQp2 never let the broader listing-row provider string leak in when detail already has the promo\'s real (narrower) scope', () => {
  // Real live evidence (2026-08-10): detail.game_provider_codes and row.game_provider
  // disagree — row is broader (site-wide availability), detail is the promo's own scope.
  const liveState = {
    list_row: { code: 'P999', bonus_type: 'Deposit - Reload', game_provider: 'AG, BG, PP2, PP, SBO, GXW' },
    detail: { game_provider_codes: ['AG', 'BG', 'PP2'] },
  };
  const qpro = liveFromQpro(liveState, { brand: 'QPRO1' });
  assert.deepEqual(qpro.scope.gameProviderCodes, ['AG', 'BG', 'PP2']);
  assert.equal(qpro.scope.gameProviderCodesSource, 'detail');

  const qp2 = liveFromQp2(liveState, { brand: 'QP2A' });
  assert.deepEqual(qp2.scope.gameProviderCodes, ['AG', 'BG', 'PP2']);
  assert.equal(qp2.scope.gameProviderCodesSource, 'detail');
});

test('liveFromQp2 resolves previously-unmapped category codes end-to-end when a catalogue is supplied', async () => {
  const catalogue = { categories: await getCategoryCatalogue(fakeSite('ibc22'), { now: 1000, fetchImpl: async () => QPRO1_CATEGORY_ROWS }) };
  const liveState = {
    list_row: { code: 'P998', category: 'ES, FS', bonus_type: 'Free Spin' },
    detail: {},
  };
  const c = liveFromQp2(liveState, { brand: 'QP2A', catalogue });
  assert.deepEqual(c.scope.categories, ['E_SPORTS', 'FISHING']);
  assert.equal(c.scope.categoriesEvidence.complete, true);
});

test('newCanonical() default scope evidence assumes nothing unresolved (expected-side default)', async () => {
  const { newCanonical } = await import('../src/qc-dashboard/canonical/canonical-model.js');
  const c = newCanonical();
  assert.deepEqual(c.scope.categoriesEvidence, { unmapped: [], complete: true, catalogue: null });
  assert.equal(c.scope.gameProviderCodesEvidence.checked, false);
});
