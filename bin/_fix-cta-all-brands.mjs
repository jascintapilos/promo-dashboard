// Force unified CTA pattern across ALL popups for P124-P163 codes on:
//   QP2D (ibc22 m=4), QPRO2, QPRO3, QPRO4, QPRO6, QPRO8, QPRO10
//
// Unified rule:
//   CTA1 (EN): CLAIM NOW → /member/reward
//   CTA1 (ZH): 立即领取   → /member/reward
//   CTA2 (EN): READ MORE  → /member/message
//   CTA2 (ZH): 阅读更多   → /member/message
//
// Preserves title + content (already correct from prior fixes).
// Default = dry-run; pass --commit to send PUTs.

import fs from 'node:fs';
import path from 'node:path';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const commit = process.argv.includes('--commit');

const probe = JSON.parse(fs.readFileSync('captures/api-runs/qp2d-sheet-probe-v2.json', 'utf8'));
const fixturesByRn = new Map();
for (const f of fs.readdirSync('captures/requests').filter(n => /^P1(2[4-9]|[3-5][0-9]|6[0-3])-/.test(n))) {
  const r = JSON.parse(fs.readFileSync(path.join('captures/requests', f), 'utf8'));
  fixturesByRn.set(r.request_id, r);
}
const P_CODES = new Set([...fixturesByRn.values()].map(r => r.promo_code));

const TARGETS = [
  { key: 'QP2D',   site: 'ibc22',  merchantId: 4 },
  { key: 'QPRO2',  site: 'qpro2'  },
  { key: 'QPRO3',  site: 'qpro3'  },
  { key: 'QPRO4',  site: 'qpro4'  },
  { key: 'QPRO6',  site: 'qpro6'  },
  { key: 'QPRO8',  site: 'qpro8'  },
  { key: 'QPRO10', site: 'qpro10' },
];

const LOCALE_IS_ZH = (id) => id === 3 || id === 7;
const fmtDate = (iso) => iso ? String(iso).replace(/T/, ' ').replace(/\.\d+Z?$/, '').slice(0, 19) : null;

const popupLookupBySite = new Map();
async function getPopupLookup(siteObj, siteId, merchantId) {
  const key = `${siteId}:${merchantId ?? 'none'}`;
  if (popupLookupBySite.has(key)) return popupLookupBySite.get(key);
  const map = new Map();
  for (let page = 1; page <= 30; page++) {
    const params = new URLSearchParams({ perPage: '100', page: String(page) });
    if (merchantId != null) params.set('site_id', String(merchantId));
    const r = await authedFetch(siteObj, `/api/bo/popups?${params}`);
    const rows = r?.data?.rows || [];
    for (const p of rows) map.set(p.id, p);
    if (rows.length < 100) break;
  }
  popupLookupBySite.set(key, map);
  return map;
}

// Inventory: every (target, code) where present
const items = [];
for (const r of probe.results) {
  if (!P_CODES.has(r.code)) continue;
  for (const t of TARGETS) {
    const data = r[t.key];
    if (!data?.present) continue;
    items.push({ target: t.key, site: t.site, merchantId: t.merchantId, code: r.code, promotion_id: data.id });
  }
}
console.log(`Inventory: ${items.length} popups across ${TARGETS.length} brands × ${P_CODES.size} codes`);
console.log(`Mode: ${commit ? 'LIVE (--commit)' : 'DRY-RUN'}`);

async function fixOne(item) {
  const siteObj = getSite(item.site);
  try {
    // Resolve popup_id via promotion listing
    const params = new URLSearchParams({ code: item.code, perPage: '5' });
    if (item.merchantId != null) params.set('merchant_id', String(item.merchantId));
    const r = await authedFetch(siteObj, `/api/bo/promotion?${params}`);
    const row = (r?.data?.rows || []).find(x => x.code === item.code);
    if (!row) return { ...item, action: 'PROMO_NOT_FOUND' };
    const dpl = row.dialog_popup_list;
    let popupId = null;
    if (Array.isArray(dpl) && dpl.length) popupId = dpl[0].popup_id;
    else if (dpl && typeof dpl === 'object') popupId = Object.values(dpl)[0]?.popup_id;
    if (!popupId) return { ...item, action: 'NO_POPUP_LINKED' };

    const lookup = await getPopupLookup(siteObj, item.site, item.merchantId);
    const popup = lookup.get(popupId);
    if (!popup) return { ...item, action: 'POPUP_NOT_IN_LISTING', popup_id: popupId };

    // Check if all CTAs already correct
    let needsUpdate = false;
    for (const [k, c] of Object.entries(popup.contents || {})) {
      const isZh = LOCALE_IS_ZH(c.locale_id);
      const wantCta1Text = isZh ? '立即领取' : 'CLAIM NOW';
      const wantCta1Link = '/member/reward';
      const wantCta2Text = isZh ? '阅读更多' : 'READ MORE';
      const wantCta2Link = '/member/message';
      if (c.cta_button_text_1 !== wantCta1Text || c.cta_button_link_1 !== wantCta1Link
          || c.cta_button_text_2 !== wantCta2Text || c.cta_button_link_2 !== wantCta2Link) {
        needsUpdate = true;
        break;
      }
    }
    if (!needsUpdate) return { ...item, popup_id: popupId, action: 'ALREADY_CORRECT' };

    // Build new contents — keep title + content, only override CTAs
    const newContents = {};
    for (const [k, c] of Object.entries(popup.contents || {})) {
      const isZh = LOCALE_IS_ZH(c.locale_id);
      newContents[k] = {
        ...c,
        cta_button_type: 2,
        cta_button_text_1: isZh ? '立即领取' : 'CLAIM NOW',
        cta_button_link_1: '/member/reward',
        cta_button_text_2: isZh ? '阅读更多' : 'READ MORE',
        cta_button_link_2: '/member/message',
      };
    }
    const body = {
      id: popup.id, code: popup.code, status: popup.status, platform: popup.platform,
      position: popup.position, session: popup.session,
      start_date: fmtDate(popup.start_date), end_date: fmtDate(popup.end_date),
      location: popup.location, affiliates_visibility: popup.affiliates_visibility,
      always_pop: popup.always_pop, label: popup.label,
      contents: newContents,
    };
    if (item.merchantId != null) body.site_id = item.merchantId;

    if (!commit) return { ...item, popup_id: popupId, action: 'DRY_RUN_PUT' };
    const res = await authedFetch(siteObj, `/api/bo/popups/${popupId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { ...item, popup_id: popupId, action: 'UPDATED', response_ok: !!res?.success };
  } catch (e) {
    return { ...item, action: 'FAILED', error: e.message.slice(0, 200) };
  }
}

async function runBatched(items, fn, concurrency = 12) {
  const results = new Array(items.length);
  let next = 0, done = 0;
  async function worker() {
    while (true) {
      const i = next++; if (i >= items.length) break;
      results[i] = await fn(items[i]);
      done++;
      if (done % 30 === 0) process.stderr.write(`  ${done}/${items.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

const t0 = Date.now();
const results = await runBatched(items, fixOne, 12);
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const tally = {};
const byBrand = {};
for (const r of results) {
  tally[r.action] = (tally[r.action] || 0) + 1;
  byBrand[r.target] = byBrand[r.target] || {};
  byBrand[r.target][r.action] = (byBrand[r.target][r.action] || 0) + 1;
}
console.log('Tally:', JSON.stringify(tally));
console.log('Per-brand:');
for (const [b, t] of Object.entries(byBrand)) console.log(`  ${b}: ${JSON.stringify(t)}`);

const fails = results.filter(r => r.action === 'FAILED');
if (fails.length) {
  console.log('Failures (first 5):');
  fails.slice(0, 5).forEach(r => console.log(`  ${r.target} ${r.code} popup=${r.popup_id} — ${r.error}`));
}

fs.writeFileSync(`captures/api-runs/cta-fix-all-brands-${commit ? 'commit' : 'dryrun'}.json`,
  JSON.stringify({ generated: new Date().toISOString(), results, tally, byBrand }, null, 2));
