/**
 * Read all 2026 weekly report spreadsheets and count rows per tab.
 *
 * Two formats in the wild:
 *   OLD (W01–W12 approx): summary grid — brand rows in col A, counts in col B,
 *                          "Total" row gives the week total.
 *                          Tab names: "Promo Code", "Banner", "Games"
 *   NEW (W13+ approx):    raw log — one row per entry (date | code | brand | …)
 *                          Tab names: "Promo Code Log", "Banner Log",
 *                                     "CRM Assignment Log", "New Games"
 *
 * Usage:
 *   node bin/read-weekly-reports.mjs
 *   node bin/read-weekly-reports.mjs --brand WS1
 *   node bin/read-weekly-reports.mjs --json
 */
import { getSheetsClient } from '../src/sheets-client.js';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const jsonMode    = flags.json  === true;
const brandFilter = flags.brand ? String(flags.brand).toUpperCase() : null;
const SLEEP_MS    = 1200; // stay well within Sheets API read quota

// ── All 2026 reports ──────────────────────────────────────────────────────
const REPORTS = [
  { id: '1heB6YZ_y9xPVzn6o1dRxWEq-2QE7kCr66yJfrlDbRJU', label: 'W01 02/01–09/01', month: 'Jan' },
  { id: '1mEucWPTgGs0xxx0cf8cc1FQDxUUKotvqDw9NAkEourg',  label: 'W02 12/01–16/01', month: 'Jan' },
  { id: '1A2GK8bIywSsXpltSznh0Cn1vGOrhof7OT7WOUQAzh24',  label: 'W03 19/01–23/01', month: 'Jan' },
  { id: '1nbqwgfOw0dcA1ozDSDGayGfo5Fb2M2r6ym7SqFsCTC4',  label: 'W04 26/01–30/01', month: 'Jan' },
  { id: '15CCSfHZpNlCMJ7U9eTvP6axTGadtyV_QyiLfcotzPsA',  label: 'W05 02/02–06/02', month: 'Feb' },
  { id: '1NHqkVuJ0qM_01JX9orkicpqJ4nkLYFJyR2MmZuMB3a8',  label: 'W06 09/02–13/02', month: 'Feb' },
  { id: '1nkaGo6WWhI2MJu2_d0E5QHRZ8hqxFHmwxFrkbjwJmNg',  label: 'W07 16/02–20/02', month: 'Feb' },
  { id: '1IBAAJ46_kVWaUvWsnTntX5Yb9HWqkrY7VCIIiuTYLvw',  label: 'W08 23/02–27/02', month: 'Feb' },
  { id: '1KX2BgJ1cG4kUn_5et1-dO-nZobBanyClJeDoXgM4Rt4',  label: 'W09 02/03–06/03', month: 'Mar' },
  { id: '1w7c9yOJvjwGYOA85kpy2hj4yVcV4MymVBlrmp-wEzNo',  label: 'W10 09/03–13/03', month: 'Mar' },
  { id: '14vI1cIQ_me1AxjHl6Uj-C_lZrYiC12kRmb3jLlTDpl0',  label: 'W11 16/03–20/03', month: 'Mar' },
  { id: '10qpjewOwFybDXjTxdVfS0UBj4M0RcgNbjrqXP91q7AU',   label: 'W12 23/03–27/03', month: 'Mar' },
  { id: '1urVhlKaQx2WU_e_UipM7EQemOKDcxyi2qT3eMPSorGQ',  label: 'W13 30/03–03/04', month: 'Apr' },
  { id: '1lmNeS3fd7avNUJ-n2QIWDI2EwctN8r-cmMXOq6mIu-0',  label: 'W14 06/04–10/04', month: 'Apr' },
  { id: '1KJmtzp_DC_0CYB_hyDfTfQCsjFBbvIoMtuKXunIX3NU',  label: 'W15 13/04–17/04', month: 'Apr' },
  { id: '1kXIWMlx0ISs8mzGxaPDSbSp9ElbxsMukgKFXG8L1Oo4',  label: 'W16 20/04–24/04', month: 'Apr' },
  { id: '1pSg21Py11ysI8sMXtA0c7kE-1mXFsESbcUSDQLrywz0',  label: 'W17 27/04–01/05', month: 'May' },
  { id: '1mRuxCO-u-O7l3dLrLYFmbCtavfSJ0JS6sE0EsXtT7Ng',  label: 'W18 04/05–08/05', month: 'May' },
  { id: '1x9KsG9yAlhKTP_-fWW_euvTs3Ry8bNyWqn2h_uLRUM8',  label: 'W19 11/05–18/05', month: 'May' },
];

// Patterns tried in priority order; first match wins
const TAB_PATTERNS = {
  promos:  ['promo code log', 'promo code', 'promo'],
  banners: ['banner log', 'banner'],
  crm:     ['crm assignment', 'crm'],
  games:   ['new games', 'games'],
};

function findTab(sheetMeta, patterns) {
  for (const pat of patterns) {
    const found = sheetMeta.find(s => s.title.toLowerCase().includes(pat));
    if (found) return found.title;
  }
  return null;
}

/**
 * "Summary grid" = old-format tabs that have brand rows + a "Total" row.
 * Anything else (contains "log", or is a games tab) → raw log row count.
 */
function isSummaryGrid(tabTitle) {
  if (!tabTitle) return false;
  const lower = tabTitle.toLowerCase();
  if (lower.includes('log')) return false;
  return lower.includes('promo code') || lower.includes('banner');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function readAllRows(sheets, spreadsheetId, tabTitle) {
  const range = `'${tabTitle}'!A1:J2000`;
  const resp  = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return resp.data.values || [];
}

// Old format: find row where col A = "Total", return col B as int
function extractTotalRow(rows) {
  const row = rows.find(r => r && String(r[0] || '').trim().toLowerCase() === 'total');
  if (!row) return 0;
  const n = parseInt(String(row[1] || '0').replace(/,/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

// Old format + brand filter: sum rows whose col A label contains brandFilter
function extractBrandTotal(rows, brand) {
  let sum = 0;
  for (const r of rows) {
    if (!r || !r[0]) continue;
    if (String(r[0]).trim().toUpperCase().includes(brand)) {
      const n = parseInt(String(r[1] || '0').replace(/,/g, ''), 10);
      if (!isNaN(n)) sum += n;
    }
  }
  return sum;
}

// New format: count non-empty data rows after the header
function countLogRows(rows, brandColIdx) {
  const data = rows.slice(1);
  if (!brandFilter || brandColIdx == null) {
    return data.filter(r => r && r.some(c => c && String(c).trim())).length;
  }
  return data.filter(r => {
    if (!r || !r.some(c => c)) return false;
    return String(r[brandColIdx] || '').trim().toUpperCase().includes(brandFilter);
  }).length;
}

function detectBrandCol(rows) {
  const header = rows[0] || [];
  const idx = header.findIndex(h => /brand/i.test(String(h)));
  return idx >= 0 ? idx : 2; // default col C
}

async function getCount(sheets, spreadsheetId, tabTitle) {
  if (!tabTitle) return 0;
  const rows = await readAllRows(sheets, spreadsheetId, tabTitle);

  if (isSummaryGrid(tabTitle)) {
    return brandFilter
      ? extractBrandTotal(rows, brandFilter)
      : extractTotalRow(rows);
  }

  // Raw log format
  return countLogRows(rows, detectBrandCol(rows));
}

// ── Main ─────────────────────────────────────────────────────────────────────

const client = await getSheetsClient();
const { sheets } = client;

const results = [];
let grandPromos = 0, grandBanners = 0, grandCrm = 0, grandGames = 0;
const monthTotals = {};

console.log(`Reading ${REPORTS.length} spreadsheets${brandFilter ? ` (brand: ${brandFilter})` : ''}...\n`);

for (const rpt of REPORTS) {
  process.stdout.write(`  ${rpt.label} `);
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: rpt.id,
      fields: 'sheets.properties',
    });
    const sheetMeta = meta.data.sheets.map(s => ({ title: s.properties.title }));

    const promoTab  = findTab(sheetMeta, TAB_PATTERNS.promos);
    const bannerTab = findTab(sheetMeta, TAB_PATTERNS.banners);
    const crmTab    = findTab(sheetMeta, TAB_PATTERNS.crm);
    const gamesTab  = findTab(sheetMeta, TAB_PATTERNS.games);

    // Games tab is always row-per-game regardless of format name
    const gamesCount = gamesTab
      ? countLogRows(await readAllRows(sheets, rpt.id, gamesTab), null)
      : 0;

    const [promos, banners, crm] = await Promise.all([
      getCount(sheets, rpt.id, promoTab),
      getCount(sheets, rpt.id, bannerTab),
      getCount(sheets, rpt.id, crmTab),
    ]);

    results.push({ ...rpt, promos, banners, crm, games: gamesCount,
      _tabs: { promoTab, bannerTab, crmTab, gamesTab } });
    grandPromos  += promos;
    grandBanners += banners;
    grandCrm     += crm;
    grandGames   += gamesCount;

    if (!monthTotals[rpt.month]) monthTotals[rpt.month] = { promos: 0, banners: 0, crm: 0, games: 0 };
    monthTotals[rpt.month].promos  += promos;
    monthTotals[rpt.month].banners += banners;
    monthTotals[rpt.month].crm     += crm;
    monthTotals[rpt.month].games   += gamesCount;

    const fmt = isSummaryGrid(promoTab) ? '[grid]' : '[log]';
    process.stdout.write(`${fmt} → promos=${promos} banners=${banners} crm=${crm} games=${gamesCount}\n`);
  } catch (err) {
    process.stdout.write(`→ ERROR: ${err.message.substring(0, 80)}\n`);
    results.push({ ...rpt, promos: 0, banners: 0, crm: 0, games: 0, error: err.message });
  }

  await sleep(SLEEP_MS);
}

if (jsonMode) {
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

// ── Weekly table ──────────────────────────────────────────────────────────
console.log('\n');
console.log('┌──────────────────────────────────┬────────┬─────────┬───────┬──────┐');
console.log('│ Week                             │ Promos │ Banners │ Games │ CRM  │');
console.log('├──────────────────────────────────┼────────┼─────────┼───────┼──────┤');
let prevMonth = '';
for (const r of results) {
  if (r.month !== prevMonth) {
    if (prevMonth) {
      const m = monthTotals[prevMonth];
      console.log(`│ ${'  ↳ ' + prevMonth + ' subtotal'.padEnd(30)} │ ${String(m.promos).padStart(6)} │ ${String(m.banners).padStart(7)} │ ${String(m.games).padStart(5)} │ ${String(m.crm).padStart(4)} │`);
      console.log('├──────────────────────────────────┼────────┼─────────┼───────┼──────┤');
    }
    prevMonth = r.month;
  }
  const flag = r.error ? ' !' : '';
  console.log(`│ ${(r.label + flag).padEnd(32)} │ ${String(r.promos).padStart(6)} │ ${String(r.banners).padStart(7)} │ ${String(r.games).padStart(5)} │ ${String(r.crm).padStart(4)} │`);
}
if (prevMonth) {
  const m = monthTotals[prevMonth];
  console.log(`│ ${'  ↳ ' + prevMonth + ' subtotal'.padEnd(30)} │ ${String(m.promos).padStart(6)} │ ${String(m.banners).padStart(7)} │ ${String(m.games).padStart(5)} │ ${String(m.crm).padStart(4)} │`);
}
console.log('├──────────────────────────────────┼────────┼─────────┼───────┼──────┤');
console.log(`│ ${'TOTAL (from 19 weekly logs)'.padEnd(32)} │ ${String(grandPromos).padStart(6)} │ ${String(grandBanners).padStart(7)} │ ${String(grandGames).padStart(5)} │ ${String(grandCrm).padStart(4)} │`);
console.log('└──────────────────────────────────┴────────┴─────────┴───────┴──────┘');

console.log('\nDashboard YTD totals (authoritative, Jan 1 – May 18):');
console.log('  Promo Codes : 1,641');
console.log('  Banners     :   221');
console.log('  New Games   :   487');
console.log('  CRM         : 1,438');
