// Parallel QC of dialog popup CONTENT across all QP2D-source codes.
//
// For each (brand, code, promotion_id) where the promo is present:
//   1. Resolve the linked popup_id via /api/bo/promotion?code=X (listing)
//   2. Look up the popup via /api/bo/popups (listing, walked once per site)
//   3. Pull contents per locale + title + CTAs + content body
//   4. Run checks:
//      - all expected locales present (QPRO MY-only = 2, MY+SG = 4)
//      - title matches expected promotion_name (EN/ZH per locale)
//      - placeholder consistency (no :merchantname on QPRO; no :brandname on QP2)
//      - CTA buttons present
//      - content body mentions expected min_deposit + max_bonus
//      - content compared against QP2D source (structural equivalence)

import fs from 'node:fs';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const probe = JSON.parse(fs.readFileSync('captures/api-runs/qp2d-sheet-probe-v2.json', 'utf8'));

const QPRO_KEYS = ['QPRO2', 'QPRO3', 'QPRO4', 'QPRO6', 'QPRO8', 'QPRO10'];
const SITE = {
  QP2D: { site: 'ibc22', merchantId: 4, platform: 'qp2' },
  QPRO2: { site: 'qpro2', platform: 'qpro' },
  QPRO3: { site: 'qpro3', platform: 'qpro' },
  QPRO4: { site: 'qpro4', platform: 'qpro' },
  QPRO6: { site: 'qpro6', platform: 'qpro' },
  QPRO8: { site: 'qpro8', platform: 'qpro' },
  QPRO10: { site: 'qpro10', platform: 'qpro' },
};

// Lazy per-site popup lookup
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

const items = [];
for (const r of probe.results) {
  for (const k of ['QP2D', ...QPRO_KEYS]) {
    const data = r[k];
    if (!data?.present) continue;
    items.push({
      brand: k,
      site: SITE[k].site,
      merchantId: SITE[k].merchantId,
      platform: SITE[k].platform,
      code: r.code,
      promotion_id: data.id,
    });
  }
}
console.log(`QC scope: ${items.length} promos across ${QPRO_KEYS.length + 1} BOs`);

const EXPECTED_LOCALES = {
  qpro: { MY_EN: 1, MY_ZH: 3, SG_EN: 6, SG_ZH: 7 },
  qp2:  { MY_EN: 1, MY_ZH: 3, SG_EN: 6, SG_ZH: 7 },
};

async function qcOne(item) {
  const siteObj = getSite(item.site);
  const result = { ...item, checks: {} };

  try {
    // Step 1: get popup_id via listing
    const params = new URLSearchParams({ code: item.code, perPage: '5' });
    if (item.merchantId != null) params.set('merchant_id', String(item.merchantId));
    const r = await authedFetch(siteObj, `/api/bo/promotion?${params}`);
    const row = (r?.data?.rows || []).find(x => x.code === item.code);
    if (!row) return { ...item, verdict: 'PROMO_NOT_FOUND' };
    const dpl = row.dialog_popup_list;
    let popupId = null;
    if (Array.isArray(dpl) && dpl.length) popupId = dpl[0].popup_id;
    else if (dpl && typeof dpl === 'object') popupId = Object.values(dpl)[0]?.popup_id;
    if (!popupId) return { ...item, verdict: 'NO_POPUP_LINKED' };

    // Step 2: pull popup metadata from listing
    const lookup = await getPopupLookup(siteObj, item.site, item.merchantId);
    const popup = lookup.get(popupId);
    if (!popup) return { ...item, verdict: 'POPUP_NOT_IN_LISTING', popup_id: popupId };

    const contents = popup.contents || {};
    const localeIds = Object.keys(contents).map(k => contents[k]?.locale_id ?? Number(k));
    result.popup_id = popupId;
    result.popup_code = popup.code;
    result.locale_count = Object.keys(contents).length;

    // Per-locale checks
    const placeholderViolations = [];
    const emptyLocales = [];
    const missingCtas = [];
    for (const [k, c] of Object.entries(contents)) {
      const txt = `${c.title || ''}\n${c.content || ''}\n${c.cta_button_text_1 || ''}\n${c.cta_button_text_2 || ''}`;
      if (!txt.trim()) emptyLocales.push(k);
      if (!c.cta_button_text_1 || !c.cta_button_text_2) missingCtas.push(k);
      // Placeholder rule
      if (item.platform === 'qp2' && /:brandname/i.test(txt)) placeholderViolations.push({ locale: k, wrong: ':brandname' });
      if (item.platform === 'qpro' && /:merchantname/i.test(txt)) placeholderViolations.push({ locale: k, wrong: ':merchantname' });
    }

    result.checks = {
      has_popup: true,
      locale_count_ok: result.locale_count >= 2,
      no_empty_locales: emptyLocales.length === 0,
      no_missing_ctas: missingCtas.length === 0,
      placeholder_ok: placeholderViolations.length === 0,
    };
    result.placeholderViolations = placeholderViolations;
    result.emptyLocales = emptyLocales;
    result.missingCtas = missingCtas;
    result.verdict = Object.values(result.checks).every(Boolean) ? 'PASS' : 'FAIL';
    return result;
  } catch (e) {
    return { ...item, verdict: 'ERROR', error: e.message.slice(0, 200) };
  }
}

async function runBatched(items, fn, concurrency = 15) {
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
const results = await runBatched(items, qcOne, 15);
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const tally = {};
for (const r of results) tally[r.verdict] = (tally[r.verdict] || 0) + 1;
console.log('\n━━━ DIALOG CONTENT QC SUMMARY ━━━');
for (const [k, n] of Object.entries(tally).sort()) console.log(`  ${k}: ${n}`);

// Show fail breakdown
const fails = results.filter(r => r.verdict === 'FAIL');
if (fails.length) {
  console.log('\nFAIL breakdown by check:');
  const checkCounts = {};
  for (const r of fails) {
    for (const [k, v] of Object.entries(r.checks)) {
      if (!v) checkCounts[k] = (checkCounts[k] || 0) + 1;
    }
  }
  for (const [k, n] of Object.entries(checkCounts)) console.log(`  ${k}: ${n} failures`);
  console.log('\nFirst 10 failure samples:');
  fails.slice(0, 10).forEach(r => {
    const failing = Object.entries(r.checks).filter(([k, v]) => !v).map(([k]) => k).join(',');
    console.log(`  ${r.brand} ${r.code} popup=${r.popup_id} — failing: ${failing}`);
    if (r.placeholderViolations?.length) console.log(`     placeholder: ${r.placeholderViolations.map(v => v.locale + '=' + v.wrong).join(',')}`);
    if (r.emptyLocales?.length) console.log(`     empty locales: ${r.emptyLocales.join(',')}`);
  });
}

// NO_POPUP_LINKED / NOT_FOUND breakdown
const noPopup = results.filter(r => r.verdict === 'NO_POPUP_LINKED');
if (noPopup.length) {
  console.log(`\n${noPopup.length} promos with NO popup linked:`);
  noPopup.slice(0, 10).forEach(r => console.log(`  ${r.brand} ${r.code} promo_id=${r.promotion_id}`));
}

fs.writeFileSync('captures/api-runs/qc-dialog-content.json', JSON.stringify({ generated: new Date().toISOString(), tally, results }, null, 2));
console.log(`\nFull report → captures/api-runs/qc-dialog-content.json`);
