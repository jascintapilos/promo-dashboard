/**
 * Rebuild the BO-direct Promo Operations Hub data as a flat, long-format table.
 *
 *   period | platform | brand | metric | count | meta(json)
 *
 * Periods can be:
 *   YTD         — running year-to-date total
 *   2026-01..05 — monthly buckets
 *   W01..W19    — weekly report windows (Mon-Fri unless otherwise)
 *
 * The Apps Script reads this Data tab and groups/filters server-side.
 */
import { getSheetsClient } from '../src/sheets-client.js';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const SHEET_ID = flags['sheet-id'] || '1ceJuO2moCKaLf3Uk3EK3DCFgxLXKNCmib6B1wqZLOSQ';

// ── Period catalog (used by dashboard's date filter) ─────────────────────────
const PERIODS = {
  YTD:        { from: '2026-01-01', to: '2026-05-31', label: 'YTD 2026' },
  '2026-01':  { from: '2026-01-01', to: '2026-01-31', label: 'Jan 2026' },
  '2026-02':  { from: '2026-02-01', to: '2026-02-28', label: 'Feb 2026' },
  '2026-03':  { from: '2026-03-01', to: '2026-03-31', label: 'Mar 2026' },
  '2026-04':  { from: '2026-04-01', to: '2026-04-30', label: 'Apr 2026' },
  '2026-05':  { from: '2026-05-01', to: '2026-05-31', label: 'May 2026' },
  W01: { from: '2026-01-02', to: '2026-01-09', label: 'W01 02/01–09/01' },
  W02: { from: '2026-01-12', to: '2026-01-16', label: 'W02 12/01–16/01' },
  W03: { from: '2026-01-19', to: '2026-01-23', label: 'W03 19/01–23/01' },
  W04: { from: '2026-01-26', to: '2026-01-30', label: 'W04 26/01–30/01' },
  W05: { from: '2026-02-02', to: '2026-02-06', label: 'W05 02/02–06/02' },
  W06: { from: '2026-02-09', to: '2026-02-13', label: 'W06 09/02–13/02' },
  W07: { from: '2026-02-16', to: '2026-02-20', label: 'W07 16/02–20/02' },
  W08: { from: '2026-02-23', to: '2026-02-27', label: 'W08 23/02–27/02' },
  W09: { from: '2026-03-02', to: '2026-03-06', label: 'W09 02/03–06/03' },
  W10: { from: '2026-03-09', to: '2026-03-13', label: 'W10 09/03–13/03' },
  W11: { from: '2026-03-16', to: '2026-03-20', label: 'W11 16/03–20/03' },
  W12: { from: '2026-03-23', to: '2026-03-27', label: 'W12 23/03–27/03' },
  W13: { from: '2026-03-30', to: '2026-04-03', label: 'W13 30/03–03/04' },
  W14: { from: '2026-04-06', to: '2026-04-10', label: 'W14 06/04–10/04' },
  W15: { from: '2026-04-13', to: '2026-04-17', label: 'W15 13/04–17/04' },
  W16: { from: '2026-04-20', to: '2026-04-24', label: 'W16 20/04–24/04' },
  W17: { from: '2026-04-27', to: '2026-05-01', label: 'W17 27/04–01/05' },
  W18: { from: '2026-05-04', to: '2026-05-08', label: 'W18 04/05–08/05' },
  W19: { from: '2026-05-11', to: '2026-05-18', label: 'W19 11/05–18/05' },
  '2026-Q1': { from: '2026-01-01', to: '2026-03-31', label: 'Q1 2026 (Jan–Mar)' },
  '2026-Q2': { from: '2026-04-01', to: '2026-06-30', label: 'Q2 2026 (Apr–Jun)' },
};

// ── YTD totals per brand (already gathered) ──────────────────────────────────
const QPRO_PROMOS = {
  QPRO1: 181, QPRO2: 123, QPRO3: 77, QPRO4: 45, QPRO5: 43, QPRO6: 67,
  QPRO7: 45,  QPRO8: 100, QPRO9: 52, QPRO10: 41, QPRO11: 2, QPRO12: 9,
  QPRO13: 2,  QPRO14: 2,  QPRO15: 38, QPRO16: 28, QPRO17: 8,
};
// QP2 per-merchant YTD raw counts (BO `created_at` filtered to 2026, before TEST_ exclusion).
// Multi-merchant promos share one code across merchants — these counts treat each
// merchant deployment as separate work since the team configures + tests per merchant.
const QP2_PROMOS_PER_BRAND = {
  QP2A: 320,  // IBC22
  QP2B: 280,  // KING333
  QP2C: 216,  // ACE66
  QP2D: 274,  // SPADE66
};
const QP2_PROMOS_UNIQUE_DEDUPED = 412; // unique codes across all 4 merchants (real, TEST_ excluded)

// WS1 V3 IGMP per-kiosk: YTD + monthly + breakdown by promo type
const WS1_IGMP_PROMOS = {
  'WS1-MY': { ytd: 199, months: { '2026-01': 86, '2026-02': 21, '2026-03': 18, '2026-04': 59, '2026-05': 15 },
              byType: { Bonus: 53, FreeCredit: 59, FreeSpin: 87 }, modified: 0 },
  'WS1-SG': { ytd: 175, months: { '2026-01': 74, '2026-02': 11, '2026-03': 18, '2026-04': 58, '2026-05': 14 },
              byType: { Bonus: 53, FreeCredit: 47, FreeSpin: 75 }, modified: 0 },
  'WS1-ID': { ytd: 0, months: {}, byType: {}, modified: 18 },
  'WS1-TH': { ytd: 0, months: {}, byType: {}, modified: 17 },
  'WS1-KH': { ytd: 0, months: {}, byType: {}, modified: 13 },
  'WS2':    { ytd: 63, months: { '2026-01': 20, '2026-02': 1, '2026-03': 1, '2026-04': 0, '2026-05': 41 },
              byType: { Bonus: 35, FreeCredit: 18, FreeSpin: 10 }, modified: 10 },
};

// Top creators across WS1 V3 IGMP (YTD combined)
const WS1_TOP_CREATORS = { elyssa: 313, alysa: 41, wen_promo: 12, admin_waiyip: 7, joelwan: 1, Jeevan: 1 };

// QPRO + QP2 combined promos per WEEK (from count-promos-ytd.mjs TEST_-excluded output)
const QPRO_QP2_WEEKLY_PROMOS = {
  W01: 39, W02: 73, W03: 105, W04: 235,
  W05: 38, W06: 85, W07:   2, W08:  68,
  W09: 19, W10: 65, W11:  20, W12:  11,
  W13:  3, W14: 58, W15:  70, W16:  49,
  W17: 46, W18: 164, W19: 93,
};
// Roll up weekly → monthly for QPRO+QP2 (best-effort mapping by week's primary month)
const QPRO_QP2_MONTHLY_PROMOS = {
  '2026-01': 39 + 73 + 105 + 235,      // 452
  '2026-02': 38 + 85 + 2 + 68,         // 193
  '2026-03': 19 + 65 + 20 + 11,        // 115
  '2026-04': 3 + 58 + 70 + 49 + 46,    // 226  (W17 mostly April)
  '2026-05': 164 + 93,                 // 257
};

// QPRO YTD banners per brand
const QPRO_BANNERS = {
  QPRO1: 15, QPRO2: 10, QPRO3: 10, QPRO4: 10, QPRO5: 10, QPRO6: 9,
  QPRO7: 11, QPRO8: 12, QPRO9: 11, QPRO10: 11, QPRO11: 0, QPRO12: 8,
  QPRO13: 0, QPRO14: 0, QPRO15: 6,  QPRO16: 6,  QPRO17: 6,
};
// Banners on QP2 are also shared (same banner across merchants). 28 de-duped unique;
// approximate per-merchant split = 28/4 = 7 each. Re-query for accuracy later.
const QP2_BANNERS_PER_BRAND = { QP2A: 7, QP2B: 7, QP2C: 7, QP2D: 7 };

// WS1 V3 IGMP banners per kiosk: 9.1.1 (Homepage) + 9.1.2 (Promotion-page) + monthly
const WS1_IGMP_BANNERS = {
  'WS1-MY': { p911: 71, p912: 39, months911: { '2026-01': 26, '2026-02': 12, '2026-03': 13, '2026-04': 16, '2026-05': 4 } },
  'WS1-SG': { p911: 20, p912: 13, months911: { '2026-01': 10, '2026-02': 4,  '2026-03': 4,  '2026-04': 2,  '2026-05': 0 } },
  'WS1-ID': { p911: 56, p912: 31, months911: {} },
  'WS1-TH': { p911: 57, p912: 31, months911: {} },
  'WS1-KH': { p911: 52, p912: 30, months911: {} },
  'WS2':    { p911: 0,  p912: 0,  months911: {} },
};

// V4 CMS (Directus) per-carousel YTD banners.
// Brand label uses project name (WS1/WS2) + region, not the in-CMS brand name.
// Irrelevant game-specific carousels (4d, togel, Seamless) are excluded.
const WS1_CMS_BANNERS = {
  'WS1-MY': 36,
  'WS1-TH': 29,
  'WS1-ID': 28,
  'WS1-KH': 27,
  'WS1-SG': 10,
};
const WS2_CMS_BANNERS = { 'WS2-MY': 31 };

// Dashboard's own YTD claims (from existing Apps Script dashboard)
const DASHBOARD_CLAIMS = { promo: 1641, banner: 221, game: 487, crm: 1438 };

// Utilization hours per person per month (from Work Hours Utilization Trackers Drive folder)
const UTILIZATION = {
  Jascinta: { '2026-01': 130.4,  '2026-02': 96.4,  '2026-03': 97.4,  '2026-04': 156.36, '2026-05': 83.6 },
  Elyssa:   { '2026-01': 120.1,  '2026-02': 95.2,  '2026-03': 108.9, '2026-04': 126.6,  '2026-05': 59.1 },
  Alysa:    { '2026-01': 151.25, '2026-02': 93.75, '2026-03': 95.05, '2026-04': 51.9,   '2026-05': 0 },
  Wen:      { '2026-01': 0,      '2026-02': 18.5,  '2026-03': 78.09, '2026-04': 126.54, '2026-05': 71.75 },
  Michelle: { '2026-01': 148.74, '2026-02': 114,   '2026-03': 0,     '2026-04': 0,      '2026-05': 0 },
  Gaby:     { '2026-01': 0,      '2026-02': 0,     '2026-03': 0,     '2026-04': 0,      '2026-05': 27.4 },
  Bangun:   { '2026-01': 0,      '2026-02': 0,     '2026-03': 0,     '2026-04': 0,      '2026-05': 17.5 },
};

// ── Build flat rows ──────────────────────────────────────────────────────────
const rows = [];
function row(period, platform, brand, metric, count, meta = {}) {
  rows.push([period, platform, brand, metric, count, JSON.stringify(meta)]);
}

// ─── PROMOS ───
// QPRO per-brand YTD
for (const [b, n] of Object.entries(QPRO_PROMOS)) row('YTD', 'QPRO', b, 'promo', n);
for (const [b, n] of Object.entries(QP2_PROMOS_PER_BRAND))
  row('YTD', 'QP2', b, 'promo', n, { note: 'raw per-merchant; multi-merchant codes counted per deployment' });

// QPRO+QP2 combined per-week + per-month + quarterly
for (const [w, n] of Object.entries(QPRO_QP2_WEEKLY_PROMOS)) row(w, 'QPRO+QP2', 'QPRO+QP2 combined', 'promo', n);
for (const [m, n] of Object.entries(QPRO_QP2_MONTHLY_PROMOS)) row(m, 'QPRO+QP2', 'QPRO+QP2 combined', 'promo', n);
const QPRO_QP2_Q = {
  '2026-Q1': (QPRO_QP2_MONTHLY_PROMOS['2026-01']||0) + (QPRO_QP2_MONTHLY_PROMOS['2026-02']||0) + (QPRO_QP2_MONTHLY_PROMOS['2026-03']||0),
  '2026-Q2': (QPRO_QP2_MONTHLY_PROMOS['2026-04']||0) + (QPRO_QP2_MONTHLY_PROMOS['2026-05']||0),
};
for (const [q, n] of Object.entries(QPRO_QP2_Q)) row(q, 'QPRO+QP2', 'QPRO+QP2 combined', 'promo', n);

// WS1 IGMP per-kiosk YTD + monthly + quarterly
for (const [k, d] of Object.entries(WS1_IGMP_PROMOS)) {
  const platform = k.startsWith('WS2') ? 'WS2' : 'WS1';
  row('YTD', platform, k, 'promo', d.ytd, { ...d.byType, modified: d.modified });
  for (const [m, n] of Object.entries(d.months || {})) row(m, platform, k, 'promo', n);
  // Quarterly rollups
  const q1 = (d.months?.['2026-01']||0) + (d.months?.['2026-02']||0) + (d.months?.['2026-03']||0);
  const q2 = (d.months?.['2026-04']||0) + (d.months?.['2026-05']||0);
  if (q1) row('2026-Q1', platform, k, 'promo', q1);
  if (q2) row('2026-Q2', platform, k, 'promo', q2);
}

// ─── BANNERS (split into homepage + promo-page subtypes) ───
// QPRO per-brand YTD — all are homepage carousel banners
for (const [b, n] of Object.entries(QPRO_BANNERS)) row('YTD', 'QPRO', b, 'banner-homepage', n);
for (const [b, n] of Object.entries(QP2_BANNERS_PER_BRAND))
  row('YTD', 'QP2', b, 'banner-homepage', n, { note: 'approx — needs per-merchant query for accuracy' });

// WS1 IGMP per-kiosk YTD + monthly + quarterly — split 9.1.1 vs 9.1.2
for (const [k, d] of Object.entries(WS1_IGMP_BANNERS)) {
  const platform = k.startsWith('WS2') ? 'WS2' : 'WS1';
  if (d.p911) row('YTD', platform, k, 'banner-homepage',  d.p911, { source: 'IGMP 9.1.1' });
  if (d.p912) row('YTD', platform, k, 'banner-promo-page', d.p912, { source: 'IGMP 9.1.2' });
  for (const [m, n] of Object.entries(d.months911 || {})) {
    if (n) row(m, platform, k, 'banner-homepage', n, { source: 'IGMP 9.1.1' });
  }
  const q1 = (d.months911?.['2026-01']||0) + (d.months911?.['2026-02']||0) + (d.months911?.['2026-03']||0);
  const q2 = (d.months911?.['2026-04']||0) + (d.months911?.['2026-05']||0);
  if (q1) row('2026-Q1', platform, k, 'banner-homepage', q1, { source: 'IGMP 9.1.1' });
  if (q2) row('2026-Q2', platform, k, 'banner-homepage', q2, { source: 'IGMP 9.1.1' });
}

// V4 CMS banners — all are homepage carousels
for (const [c, n] of Object.entries(WS1_CMS_BANNERS)) row('YTD', 'WS1-CMS', c, 'banner-homepage', n);
for (const [c, n] of Object.entries(WS2_CMS_BANNERS)) row('YTD', 'WS2-CMS', c, 'banner-homepage', n);

// ─── DASHBOARD claims (YTD only) ───
for (const [m, n] of Object.entries(DASHBOARD_CLAIMS)) {
  row('YTD', 'Dashboard', 'Dashboard manual sheets', m, n, { source: 'apps-script-dashboard' });
}

// ─── Top creators (YTD only) ───
for (const [c, n] of Object.entries(WS1_TOP_CREATORS)) row('YTD', 'WS1', c, 'creator-promo', n);

// ─── Utilization hours (per person + team total + team avg per period) ───
const UTIL_MONTHS = ['2026-01','2026-02','2026-03','2026-04','2026-05'];
for (const [person, months] of Object.entries(UTILIZATION)) {
  const ytd = Object.values(months).reduce((a, b) => a + b, 0);
  if (ytd) row('YTD', 'Utilization', person, 'utilization-hours', +ytd.toFixed(2));
  for (const [m, h] of Object.entries(months)) {
    if (h) row(m, 'Utilization', person, 'utilization-hours', +h.toFixed(2));
  }
  const q1 = (months['2026-01']||0) + (months['2026-02']||0) + (months['2026-03']||0);
  const q2 = (months['2026-04']||0) + (months['2026-05']||0);
  if (q1) row('2026-Q1', 'Utilization', person, 'utilization-hours', +q1.toFixed(2));
  if (q2) row('2026-Q2', 'Utilization', person, 'utilization-hours', +q2.toFixed(2));
}
// Team total + average per period (people = those with hours that period)
function teamStats(predicate) {
  const totals = UTIL_MONTHS.map(m => Object.values(UTILIZATION).reduce((s, p) => s + (predicate(p, m) ? p[m] : 0), 0));
  return totals;
}
for (const m of UTIL_MONTHS) {
  const hrs = Object.values(UTILIZATION).map(p => p[m]).filter(h => h > 0);
  if (!hrs.length) continue;
  const total = hrs.reduce((a, b) => a + b, 0);
  const avg = total / hrs.length;
  row(m, 'Utilization', 'TEAM TOTAL',   'utilization-hours', +total.toFixed(2), { headcount_active: hrs.length });
  row(m, 'Utilization', 'TEAM AVERAGE', 'utilization-hours', +avg.toFixed(2), { headcount_active: hrs.length });
}
// Quarterly + YTD team stats
for (const [pKey, pMonths] of [['2026-Q1', ['2026-01','2026-02','2026-03']],
                                ['2026-Q2', ['2026-04','2026-05']],
                                ['YTD',     UTIL_MONTHS]]) {
  const personTotals = Object.entries(UTILIZATION)
    .map(([n, p]) => pMonths.reduce((s, m) => s + (p[m] || 0), 0))
    .filter(h => h > 0);
  if (!personTotals.length) continue;
  const total = personTotals.reduce((a, b) => a + b, 0);
  const avg = total / personTotals.length;
  row(pKey, 'Utilization', 'TEAM TOTAL',   'utilization-hours', +total.toFixed(2), { headcount_active: personTotals.length });
  row(pKey, 'Utilization', 'TEAM AVERAGE', 'utilization-hours', +avg.toFixed(2), { headcount_active: personTotals.length });
}

// ── Write Data + PeriodIndex tabs ────────────────────────────────────────────
const { sheets } = await getSheetsClient();

async function ensureTab(name) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties' });
  if (!meta.data.sheets.some(s => s.properties.title === name)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: name } } }] },
    });
  }
}

await ensureTab('Data');
await ensureTab('PeriodIndex');

// Data
await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: 'Data!A:F' });
await sheets.spreadsheets.values.update({
  spreadsheetId: SHEET_ID, range: 'Data!A1', valueInputOption: 'RAW',
  requestBody: { values: [['period','platform','brand','metric','count','meta'], ...rows] },
});

// PeriodIndex (period → from/to/label/group)
const periodRows = [['period','from','to','label','group']];
for (const [p, d] of Object.entries(PERIODS)) {
  const group = p === 'YTD' ? 'YTD' : p.startsWith('W') ? 'Weekly' : p.includes('-Q') ? 'Quarterly' : 'Monthly';
  periodRows.push([p, d.from, d.to, d.label, group]);
}
await sheets.spreadsheets.values.clear({ spreadsheetId: SHEET_ID, range: 'PeriodIndex!A:E' });
await sheets.spreadsheets.values.update({
  spreadsheetId: SHEET_ID, range: 'PeriodIndex!A1', valueInputOption: 'RAW',
  requestBody: { values: periodRows },
});

console.log(`Wrote ${rows.length} data rows + ${periodRows.length - 1} period entries.`);
const byPeriod = {}; for (const r of rows) byPeriod[r[0]] = (byPeriod[r[0]] || 0) + 1;
console.log('Rows by period:', byPeriod);
