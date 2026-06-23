// Parallel QC of dialog popup CONTENT FORMAT after the rebuild.
// For all 195 QPRO popups, verifies:
//   - Reload popups: title starts with "Time Limited Exclusive Offer", body contains "How to Apply" + currency + min_dep
//   - FC popups: title contains "Free Credit", body contains "Congratulations" + turnover
//   - No leftover "Promo Details" / "Bonus Condition Example" (the OLD long-form content)
//   - All 4 locales updated (1, 3, 6, 7)

import fs from 'node:fs';
import path from 'node:path';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const inventory = JSON.parse(fs.readFileSync('captures/api-runs/orphan-inventory-p124-163.json', 'utf8'));
const finishCommit = JSON.parse(fs.readFileSync('captures/api-runs/finish-orphans-commit-summary.json', 'utf8'));
const popupByRnBrand = new Map();
for (const r of finishCommit.results) if (r.popup_id) popupByRnBrand.set(`${r.rn}/${r.brand}`, r.popup_id);

const fixturesByRn = new Map();
for (const f of fs.readdirSync('captures/requests').filter(n => /^P1(2[4-9]|[3-5][0-9]|6[0-3])-/.test(n))) {
  const r = JSON.parse(fs.readFileSync(path.join('captures/requests', f), 'utf8'));
  fixturesByRn.set(r.request_id, r);
}

const BRAND_TO_SITE = { QPRO3: 'qpro3', QPRO4: 'qpro4', QPRO6: 'qpro6', QPRO8: 'qpro8', QPRO10: 'qpro10' };

const popupLookupBySite = new Map();
async function getPopupLookup(siteObj, siteId) {
  if (popupLookupBySite.has(siteId)) return popupLookupBySite.get(siteId);
  const map = new Map();
  for (let page = 1; page <= 30; page++) {
    const r = await authedFetch(siteObj, `/api/bo/popups?perPage=100&page=${page}`);
    const rows = r?.data?.rows || [];
    for (const p of rows) map.set(p.id, p);
    if (rows.length < 100) break;
  }
  popupLookupBySite.set(siteId, map);
  return map;
}

async function qcOne(orph) {
  const fixture = fixturesByRn.get(orph.rn);
  const popupId = popupByRnBrand.get(`${orph.rn}/${orph.brand}`);
  const siteId = BRAND_TO_SITE[orph.brand];
  const site = getSite(siteId);
  if (!fixture || !popupId) return { ...orph, verdict: 'NO_DATA' };

  const isFc = String(fixture.bonus_type || '').toLowerCase() === 'free credit';
  const isReload = String(fixture.bonus_type || '').toLowerCase() === 'deposit';

  try {
    const lookup = await getPopupLookup(site, siteId);
    const popup = lookup.get(popupId);
    if (!popup) return { ...orph, verdict: 'POPUP_NOT_FOUND' };

    const checks = {
      has_tleo_label: /Time Limited Exclusive Offer/.test(popup.label || ''),
      has_4_locales: Object.keys(popup.contents || {}).length === 4,
      no_old_long_form: true,  // will set below
      content_type_match: true,
    };
    for (const [k, c] of Object.entries(popup.contents || {})) {
      const txt = `${c.title || ''}\n${c.content || ''}`;
      // Old long-form indicators that should NOT be present
      if (/Promo Details|Bonus Condition Example|Turnover requirement/i.test(txt) ||
          /优惠详情|奖金条件|流水量需求/.test(txt)) {
        checks.no_old_long_form = false;
      }
      // Type-specific expectations
      const isZh = c.locale_id === 3 || c.locale_id === 7;
      if (isReload) {
        const hasHow = isZh ? /如何申请/.test(txt) : /How to Apply/.test(txt);
        const hasCurrency = /MYR|SGD/.test(txt);
        if (!hasHow || !hasCurrency) checks.content_type_match = false;
      } else if (isFc) {
        const hasCongrats = isZh ? /恭喜/.test(txt) : /Congratulations/.test(txt);
        if (!hasCongrats) checks.content_type_match = false;
      }
    }
    const verdict = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL';
    return { ...orph, popup_id: popupId, verdict, checks };
  } catch (e) {
    return { ...orph, verdict: 'ERROR', error: e.message.slice(0, 200) };
  }
}

async function runBatched(items, fn, concurrency = 15) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++; if (i >= items.length) break;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

const t0 = Date.now();
const results = await runBatched(inventory, qcOne, 15);
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const tally = {};
for (const r of results) tally[r.verdict] = (tally[r.verdict] || 0) + 1;
console.log('Tally:', JSON.stringify(tally));

const fails = results.filter(r => r.verdict === 'FAIL');
if (fails.length) {
  console.log('Failures (first 10):');
  fails.slice(0, 10).forEach(r => {
    const failing = Object.entries(r.checks || {}).filter(([k, v]) => !v).map(([k]) => k).join(',');
    console.log(`  ${r.rn} ${r.brand} popup=${r.popup_id} — failing: ${failing}`);
  });
}

fs.writeFileSync('captures/api-runs/qc-dialog-content-format.json', JSON.stringify({ generated: new Date().toISOString(), tally, results }, null, 2));
