#!/usr/bin/env node
// Deep QC: category + game-provider restriction on QPRO TLEO promos.
// Read-only. Same convention confirmed from the promo request sheet
// (Apr 2026 r64-132, May 2026 r125-164, col M) and already verified on WS1:
//   _LC token           -> category = LIVE CASINO only (id 2)
//   no token on reload  -> category = SLOTS only (id 3)  [NOT all-games]
//   FT_TLEO_FC* codes   -> category = LIVE CASINO + SLOTS (ids 2 and 3)
//
// Checks per promo (feedback-category-and-provider-must-match):
//   C1  promotion_category ids exactly match expected set
//   P1  game_provider_ids non-empty when category-restricted (empty = all
//       providers allowed = restriction not actually enforced)
//   B1  blacklist_id is set (category exclusions rely on a blacklist template)
//
// Covers all 51 TLEO codes x 5 QPRO brands (QPRO3/4/6/8/10) = 255 promos.
//
//   node bin/_deep-qc-qpro-tleo-category.mjs

import { listSites } from '../src/sites.js';
import { getAllPromotions, authedFetch } from '../src/api-client.js';

const BRANDS = ['qpro3', 'qpro4', 'qpro6', 'qpro8', 'qpro10'];
const CAT = { LC: 2, SLOTS: 3 };

function expectedCategories(code) {
  if (/TLEO_FC\d/i.test(code)) return [CAT.LC, CAT.SLOTS]; // FC: Slots + LC
  if (/_LC(_|$)/i.test(code)) return [CAT.LC];
  return [CAT.SLOTS]; // no-token reload: Slots only
}

const sites = listSites().filter((s) => BRANDS.includes(s.id));
let totalPass = 0, totalFail = 0;
const allFindings = [];

for (const site of sites) {
  const all = await getAllPromotions(site);
  const rows = Array.isArray(all) ? all : (all?.data?.rows || all?.rows || []);
  const tleo = rows.filter((p) => /TLEO/i.test(p.code || ''));
  console.log(`\n${'━'.repeat(70)}\n  ${site.id} — ${tleo.length} TLEO promos\n${'━'.repeat(70)}`);

  let pass = 0, fail = 0;
  for (const p of tleo.sort((a, b) => a.code.localeCompare(b.code))) {
    const issues = [];
    try {
      const det = await authedFetch(site, `/api/bo/promotion/${p.id}`);
      const row = det.data.rows;
      const liveCats = (row.promotion_category || []).map((c) => c.category_id).sort();
      const expected = expectedCategories(p.code).slice().sort();
      const providerIds = row.game_provider_ids || [];

      // C1
      const catMatch = liveCats.length === expected.length && liveCats.every((c, i) => c === expected[i]);
      if (!catMatch) {
        const names = (ids) => ids.map((id) => (id === CAT.LC ? 'LC' : id === CAT.SLOTS ? 'SLOTS' : id)).join('+') || 'NONE';
        issues.push(`C1: category=[${names(liveCats)}] expected=[${names(expected)}]`);
      }
      // P1
      if (providerIds.length === 0) issues.push('P1: game_provider_ids is EMPTY — category restriction not enforced (all providers allowed)');
      // B1
      if (!row.blacklist_id) issues.push('B1: no blacklist_id set');

      if (issues.length) {
        fail++;
        console.log(`  ✗ ${p.code} (id=${p.id})`);
        issues.forEach((i) => console.log(`      ${i}`));
        allFindings.push({ site: site.id, code: p.code, id: p.id, issues });
      } else {
        pass++;
      }
    } catch (e) {
      fail++;
      console.log(`  ✗ ${p.code}: ERROR ${(e.message || e).slice(0, 100)}`);
      allFindings.push({ site: site.id, code: p.code, id: p.id, issues: [`ERROR: ${e.message || e}`] });
    }
  }
  console.log(`\n  ${site.id}: PASS=${pass}  FAIL=${fail}`);
  totalPass += pass;
  totalFail += fail;
}

console.log(`\n${'═'.repeat(70)}\nTotal across 5 QPRO brands: PASS=${totalPass}  FAIL=${totalFail}`);
if (allFindings.length) {
  console.log('\nFindings summary (grouped by code):');
  const byCode = new Map();
  allFindings.forEach((f) => { (byCode.get(f.code) || byCode.set(f.code, []).get(f.code)).push(f.site); });
  for (const [code, sitesHit] of byCode) console.log(`  ${code}: broken on [${sitesHit.join(', ')}]`);
}
