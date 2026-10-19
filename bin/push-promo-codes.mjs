#!/usr/bin/env node
// Hourly Promo Codes refresh (VDI): read the CEE / Sales / CRM code sheets, check
// every code against BO (READ-ONLY active-list calls via fetchAllLiveCodes — no
// PUT, no activate, no deactivate), and write the result to the "Promo Codes" tab
// of the Ops sheet (PromoOps Data). The dashboard reads that tab directly — there
// is no upload route and no key. See docs/plans/promo-codes-tab.md.
//
//   node bin/push-promo-codes.mjs             read sheets + BO, write the Ops sheet tab
//   node bin/push-promo-codes.mjs --dry-run   read sheets + BO, print counts, write tmp/promo-codes-dry-run.json only
//
// WS1/WS2 sessions expire: when one of those sites fails, bin/refresh-igmp-sessions.mjs
// (promo_testbot) is run ONCE and the BO check retried — so the testbot only logs in
// when a session is actually dead, not every hour.
// A failed run records the failure in "Promo Codes Status" and keeps the last good list.
// Exit 0 on success, 1 on failure.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';
import { fetchAllLiveCodes } from '../src/live-codes.js';
import { QPRO_BRANDS, QP2_MERCHANTS, IGMP_SITES } from '../src/brand-ids.js';
import { PROMO_CODE_SOURCES, PARSERS, applyBoStatus } from '../src/qc-dashboard/promo-codes-parse.js';
import { writeGoodRun, writeFailedRun } from '../src/qc-dashboard/promo-codes-sheet.js';

// The sites refresh-igmp-sessions.mjs can log back into.
const REFRESHABLE_IGMP = new Set(['WS1_MY', 'WS1_SG', 'WS2']);

async function readSources(sheets) {
  const rows = [];
  const sources = {};
  for (const { source, spreadsheetId, tab } of PROMO_CODE_SOURCES) {
    const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tab}'!A:Z` });
    const parsed = PARSERS[source](r.data.values || []);
    if (!parsed.length) throw new Error(`${source} sheet "${tab}" returned no codes`);
    sources[source] = parsed.length;
    rows.push(...parsed);
  }
  return { rows, sources };
}

// IGMP site errors are labelled "WS1_MY/MY"; the BO key is the part before "/".
const keyOf = (e) => String(e.brand).split('/')[0];

async function listLiveCodes({ refreshIgmp }) {
  let result = await fetchAllLiveCodes();
  const dead = result.siteErrors.map(keyOf).filter((k) => REFRESHABLE_IGMP.has(k));
  if (refreshIgmp && dead.length) {
    console.log(`  WS1/WS2 session problem (${dead.join(', ')}) — refreshing sessions once and retrying`);
    const r = spawnSync(process.execPath, ['bin/refresh-igmp-sessions.mjs'], { stdio: 'ignore', timeout: 4 * 60_000 });
    if (r.status !== 0) console.log(`  session refresh exited ${r.status ?? 'timeout'} — affected brands will show "Not checked"`);
    result = await fetchAllLiveCodes();
  }
  return result;
}

async function checkBo(rows, opts) {
  const { codes, siteErrors } = await listLiveCodes(opts);
  const failed = new Set(siteErrors.map(keyOf));
  const allKeys = [...QPRO_BRANDS.map((b) => b.brand), ...QP2_MERCHANTS.map((b) => b.brand), ...IGMP_SITES.map((s) => s.brand)];
  const checkedBrands = allKeys.filter((k) => !failed.has(k));
  const allBrandKeys = [...QPRO_BRANDS.map((b) => b.brand), ...QP2_MERCHANTS.map((b) => b.brand)];
  return {
    rows: applyBoStatus(rows, { liveCodes: codes, checkedBrands, igmpSites: IGMP_SITES, allBrandKeys }),
    siteErrors: siteErrors.map((e) => ({ brand: keyOf(e), message: e.message })),
    liveCount: codes.length,
  };
}

function summarise(rows, sources, siteErrors, liveCount) {
  const live = rows.filter((r) => Object.values(r.bo).includes('active')).length;
  const mm = rows.filter((r) => r.mismatch.length).length;
  console.log(`  sheets: CEE ${sources.CEE} · Sales ${sources.Sales} · CRM ${sources.CRM} → ${rows.length} rows`);
  console.log(`  BO: ${liveCount} active codes listed · ${live} rows active on ≥1 brand · ${mm} mismatches`);
  if (siteErrors.length) console.log(`  not checked this run: ${siteErrors.map((e) => e.brand).join(', ')}`);
}

export async function pushPromoCodes({ dryRun = false, refreshIgmp = !dryRun } = {}) {
  const pulledAt = new Date().toISOString();
  const { sheets } = await getSheetsClient();
  const opsSheetId = dryRun ? null : getOpsSheetId();
  try {
    const { rows: sheetRows, sources } = await readSources(sheets);
    const { rows, siteErrors, liveCount } = await checkBo(sheetRows, { refreshIgmp });
    const boCheckedAt = new Date().toISOString();
    summarise(rows, sources, siteErrors, liveCount);
    const payload = { pulledAt, boCheckedAt, rows, sources, siteErrors, detail: '' };
    if (dryRun) {
      mkdirSync('tmp', { recursive: true });
      writeFileSync('tmp/promo-codes-dry-run.json', JSON.stringify(payload, null, 2));
      console.log('  dry run — nothing written to the Ops sheet; wrote tmp/promo-codes-dry-run.json');
      return { ok: true };
    }
    await writeGoodRun(sheets, opsSheetId, payload);
    console.log(`  ✓ wrote ${rows.length} rows to the "Promo Codes" tab`);
    return { ok: true };
  } catch (e) {
    console.error(`  ✖ promo codes refresh failed: ${e.message}`);
    if (!dryRun) {
      try { await writeFailedRun(sheets, opsSheetId, { pulledAt, detail: e.message.slice(0, 500) }); }
      catch (e2) { console.error(`  ✖ could not record the failure in the sheet: ${e2.message}`); }
    }
    return { ok: false, error: e.message };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // process.exitCode, not process.exit(): exiting with sockets still open trips a
  // libuv assert on Windows (exit 127).
  try {
    const r = await pushPromoCodes({ dryRun: process.argv.includes('--dry-run') });
    process.exitCode = r.ok ? 0 : 1;
  } catch (e) {
    console.error(`  ✖ ${e.message}`);
    process.exitCode = 1;
  }
}
