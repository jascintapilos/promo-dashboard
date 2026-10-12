#!/usr/bin/env node
// Item 7 (collector Phase 3): 27-brand acceptance run.
//
//   node bin/qc-acceptance-run.mjs                  # full run: health + comparisons
//   node bin/qc-acceptance-run.mjs --health-only     # skip comparisons
//   node bin/qc-acceptance-run.mjs --compare-only     # skip health sweep
//   node bin/qc-acceptance-run.mjs --cases-per-brand=2
//
// Read-only throughout: fetchPromoSnapshot / getBrandHealth / compare-flow
// only ever GET. Never writes captures, never saves/activates/PUTs anything
// on any BO. Uses runComparisonWithSheetsFallback (item 5) so a candidate
// with no local bundle/request still gets a chance at a real sheet-sourced
// expectation before falling back to NO_APPROVED_SOURCE_FIXTURE.
//
// What this proves, per the item 7 brief:
//   - connectivity + evidence-completeness for all 27 brands (Phase A)
//   - genuine approved-source comparisons wherever candidates exist,
//     covering Deposit/Free Credit/Free Spin per platform family (Phase B)
//   - at least one live PASS and one live FAIL on QPRO, QP2 and IGMP
//   - WS1_ID/TH/KH marked NO_APPROVED_SOURCE_FIXTURE while still proving
//     collector completeness (Phase C)

import { loadQcBrandConfig, resolveBrandRuntime } from '../src/qc-dashboard/brand-config.js';
import { getBrandHealth } from '../src/qc-dashboard/health.js';
import { fetchPromoSnapshot } from '../src/qc-dashboard/fetch-promo.js';
import { runComparisonWithSheetsFallback, snapshotToLiveState } from '../src/qc-dashboard/compare-flow.js';
import { resolveExpectedSourceFromSheet } from '../src/qc-dashboard/sheets-fallback.js';
import { liveFromPlatform } from '../src/qc-dashboard/canonical/index.js';
import { readonlyIgmpPost } from '../src/qc-dashboard/readonly-client.js';
import { buildInventory, COVERAGE } from './qc-acceptance-inventory.mjs';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const doHealth = flags['compare-only'] !== true;
const doCompare = flags['health-only'] !== true;
const casesPerBrand = Number(flags['cases-per-brand'] || 3);

function pad(s, n) { return String(s ?? '').padEnd(n); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function runHealthSweep(brands) {
  console.log('='.repeat(104));
  console.log('PHASE A — connectivity + evidence-completeness, all 27 brands');
  console.log('='.repeat(104));
  console.log(pad('BRAND', 10), pad('CONNECTIVITY', 16), pad('OVERALL', 14), 'EVIDENCE');
  const health = {};
  for (const b of brands) {
    const h = await getBrandHealth(b.id);
    health[b.id] = h;
    let evidenceStr;
    if (h.evidence == null) evidenceStr = '-';
    else if (h.evidence.applicable === false) evidenceStr = `n/a (${h.evidence.reason})`;
    else {
      const parts = ['categories', 'providers', 'popups'].map((k) => {
        const e = h.evidence[k];
        if (!e) return `${k}=?`;
        const errNote = e.error ? ` [${String(e.error).split('\n')[0].slice(0, 50)}]` : '';
        return `${k}=${e.complete}${errNote}`;
      });
      evidenceStr = parts.join(' ');
    }
    console.log(pad(b.id, 10), pad(h.connectivity, 16), pad(h.overall, 14), evidenceStr);
  }
  const summary = Object.values(health).reduce((acc, h) => {
    acc[h.overall] = (acc[h.overall] || 0) + 1;
    return acc;
  }, {});
  console.log('');
  console.log('Connectivity/overall-state summary:', JSON.stringify(summary));
  return health;
}

function selectComparisonCases(inventory) {
  const cases = [];
  for (const entry of inventory) {
    if (entry.coverage === COVERAGE.NO_APPROVED_SOURCE_FIXTURE) continue;
    const seenBuckets = new Set();
    for (const cand of entry.candidates) {
      if (seenBuckets.size >= casesPerBrand) break;
      if (cand.bonusBucket === 'OTHER' || seenBuckets.has(cand.bonusBucket)) continue;
      seenBuckets.add(cand.bonusBucket);
      cases.push({ brand: entry.brand, platform: entry.platform, code: cand.promoCode, handle: cand.handle, bonusBucket: cand.bonusBucket, sourceType: cand.sourceType });
    }
  }
  return cases;
}

async function runOneComparison(c) {
  const snap = await fetchPromoSnapshot({ brand: c.brand, code: c.code });
  if (snap.error) return { ...c, outcome: 'FETCH_ERROR', detail: snap.detail || snap.error };
  if (snap.notFound) return { ...c, outcome: 'NOT_FOUND_LIVE', detail: 'code not present on live BO (bundle may predate an archive/rename)' };
  const r = await runComparisonWithSheetsFallback({ brand: c.brand, code: c.code, handle: c.handle, snapshot: snap });
  if (r.status === 'skip') return { ...c, outcome: `SKIP:${r.code}`, detail: r.reason };
  return { ...c, outcome: r.verdict, detail: (r.findings || []).slice(0, 2).map((f) => f.message).join(' | '), expectedSourceType: r.expectedSource?.sourceType };
}

async function runComparisons(inventory) {
  console.log('');
  console.log('='.repeat(104));
  console.log('PHASE B — genuine approved-source comparisons (representative sample, up to', casesPerBrand, 'per brand)');
  console.log('='.repeat(104));
  const cases = selectComparisonCases(inventory);
  console.log(`selected ${cases.length} cases across ${new Set(cases.map((c) => c.brand)).size} brands`);
  console.log('');
  console.log(pad('BRAND', 10), pad('PLATFORM', 9), pad('BONUS', 13), pad('VERDICT', 16), 'CODE / DETAIL');
  const results = [];
  for (const c of cases) {
    const r = await runOneComparison(c);
    results.push(r);
    console.log(pad(r.brand, 10), pad(r.platform, 9), pad(r.bonusBucket, 13), pad(r.outcome, 16), `${r.code}${r.detail ? ' — ' + String(r.detail).slice(0, 90) : ''}`);
  }
  console.log('');
  const byOutcome = results.reduce((acc, r) => { acc[r.outcome] = (acc[r.outcome] || 0) + 1; return acc; }, {});
  console.log('Outcome summary:', JSON.stringify(byOutcome));

  console.log('');
  console.log('Live PASS/FAIL demonstration per platform family:');
  for (const platform of ['qpro', 'qp2', 'igmp']) {
    const forPlatform = results.filter((r) => r.platform === platform);
    const pass = forPlatform.find((r) => r.outcome === 'SAFE');
    const fail = forPlatform.find((r) => r.outcome === 'NOT_SAFE');
    console.log(`  ${platform.padEnd(6)} PASS example: ${pass ? `${pass.brand} ${pass.code}` : 'none found in this sample'}`);
    console.log(`  ${platform.padEnd(6)} FAIL example: ${fail ? `${fail.brand} ${fail.code}` : 'none found in this sample'}`);
  }
  return results;
}

// Discover any real, currently-live promo code on an IGMP site — used only
// as a collector-completeness probe when no approved-source candidate
// exists at all, so there is nothing meaningful to compare against. Verified
// param shape (bin/canary-api-igmp.js): query string carries pagination,
// body carries the (all-blank = unfiltered) filter object.
async function discoverLiveIgmpCode(siteId) {
  const r = await readonlyIgmpPost(siteId, '/PM/GetPromotionsList?pageNum=1&rowPerPage=50', {
    PromotionCode: '', PromotionName: '', PromotionType: '', IsActive: '', IsPublished: '',
  });
  const rows = r?.data ?? [];
  // Prefer a Deposit/FreeCredit/FreeSpin example if one is on the first
  // page; otherwise take whatever is live (still proves the collector
  // works end-to-end — bonusType correctly resolves to OTHER rather than
  // guessing when the promo type isn't one of the three modeled ones).
  const preferred = rows.find((row) => /deposit|bonus|freecredit|free credit|freespin|free spin/i.test(row.PromotionType || ''));
  return (preferred || rows[0])?.PromotionCode || null;
}

async function runNoFixtureBrands(inventory) {
  console.log('');
  console.log('='.repeat(104));
  console.log('PHASE C — NO_APPROVED_SOURCE_FIXTURE brands: collector completeness without a comparison');
  console.log('='.repeat(104));
  const noFixture = inventory.filter((e) => e.coverage === COVERAGE.NO_APPROVED_SOURCE_FIXTURE);
  for (const entry of noFixture) {
    const runtime = resolveBrandRuntime(entry.brand);
    let code = null;
    try {
      if (runtime.platform === 'igmp') code = await discoverLiveIgmpCode(runtime.siteId);
    } catch (e) {
      console.log(`  ${entry.brand} (${entry.platform}) — NO_APPROVED_SOURCE_FIXTURE; live-code discovery failed: ${e.message.slice(0, 100)}`);
      continue;
    }
    if (!code) {
      console.log(`  ${entry.brand} (${entry.platform}) — NO_APPROVED_SOURCE_FIXTURE; no live promotion found to probe the collector with`);
      continue;
    }
    const snap = await fetchPromoSnapshot({ brand: entry.brand, code });
    if (snap.error || snap.notFound) {
      console.log(`  ${entry.brand} (${entry.platform}) — NO_APPROVED_SOURCE_FIXTURE; collector probe on ${code} failed: ${snap.detail || snap.error}`);
      continue;
    }
    const liveState = snapshotToLiveState(snap, runtime.platform);
    const canonical = liveFromPlatform(runtime.platform, liveState, { brand: entry.brand });
    const sheetSrc = await resolveExpectedSourceFromSheet({ brand: entry.brand, code, monthsToSearch: 1 }).catch(() => null);
    console.log(`  ${entry.brand} (${entry.platform}) — NO_APPROVED_SOURCE_FIXTURE confirmed (local: not-found, sheet: ${sheetSrc?.sourceType || 'not-found'}). Collector proof on live code "${code}": promoCode=${canonical.identity.promoCode} bonusType=${canonical.identity.bonusType} isActive=${canonical.schedule.isActive} — canonical produced cleanly, ready for comparison the moment an approved source exists.`);
  }
  return noFixture.map((e) => e.brand);
}

async function main() {
  const brands = loadQcBrandConfig();
  const { rows: inventory, summary } = buildInventory();
  console.log(`Acceptance-candidate inventory: ${summary.totalBrands} brands, ${summary.withBundle} HAS_BUNDLE, ${summary.requestOnly} HAS_REQUEST_ONLY, ${summary.noFixture} NO_APPROVED_SOURCE_FIXTURE`);
  console.log('');

  let health = null;
  if (doHealth) health = await runHealthSweep(brands);

  let comparisons = null;
  if (doCompare) comparisons = await runComparisons(inventory);

  await runNoFixtureBrands(inventory);

  console.log('');
  console.log('='.repeat(104));
  console.log('DONE');
  console.log('='.repeat(104));
}

main().catch((e) => { console.error('acceptance run failed:', e.stack || e.message); process.exit(1); });
