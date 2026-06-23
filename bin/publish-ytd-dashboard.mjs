/**
 * Publish a YTD 2026 dashboard as a Google Sheet with BO-direct numbers.
 * Uses the existing Sheets API OAuth (spreadsheets scope).
 *
 * One-shot: creates the sheet, writes the data, returns the shareable URL.
 */
import { getSheetsClient } from '../src/sheets-client.js';

const TITLE = `Promo Team YTD 2026 — BO-direct Dashboard (${new Date().toISOString().slice(0, 10)})`;

// ── Data from the May 19 BO-direct run ──────────────────────────────────────
const PROMOS = [
  ['Platform', 'Count', 'Note'],
  ['QPRO 1–17 (real, TEST_ excluded)', 863, '162 TEST_ excluded'],
  ['QP2 (de-duped real)', 412, '73 TEST_ excluded; 4 merchants share BO'],
  ['WS1 V3 IGMP — MY', 199, 'Bonus=53, FC=59, FS=87'],
  ['WS1 V3 IGMP — SG', 175, 'Bonus=53, FC=47, FS=75'],
  ['WS1 V3 IGMP — ID', 0, '+18 modified-in-2026'],
  ['WS1 V3 IGMP — TH', 0, '+17 modified-in-2026'],
  ['WS1 V3 IGMP — KH', 0, '+13 modified-in-2026'],
  ['WS2 V3 IGMP', 63, 'Bonus=35, FC=18, FS=10'],
  ['', '', ''],
  ['TOTAL created', 1712, '+58 modifications across V3 IGMP'],
];

const BANNERS = [
  ['Platform', 'Count', 'Source'],
  ['QPRO 1–17 (BO API)', 135, '/api/bo/banner'],
  ['QP2 (de-duped)', 28, '/api/bo/banner, multi-merchant'],
  ['WS1 V3 IGMP — MY (9.1.1 + 9.1.2)', 110, 'SPM/GetBanners + PM/GetPromotionBanners'],
  ['WS1 V3 IGMP — SG', 33, ''],
  ['WS1 V3 IGMP — ID', 87, ''],
  ['WS1 V3 IGMP — TH', 88, ''],
  ['WS1 V3 IGMP — KH', 82, ''],
  ['WS2 V3 IGMP', 0, 'WS2 banners are in V4 CMS only'],
  ['WS1 V4 CMS', 142, 'Directus /items/UICarousel'],
  ['WS2 V4 CMS', 31, 'Directus /items/UICarousel'],
  ['', '', ''],
  ['TOTAL', 736, ''],
];

const SUMMARY = [
  ['Metric', 'Dashboard (manual sheets)', 'BO reality', 'Variance', 'Variance %'],
  ['Promo Codes (YTD created)', 1641, 1712, 71, '+4%'],
  ['Banners', 221, 736, 515, '+233%'],
  ['New Games', 487, 'TBD', '-', '- (no BO source)'],
  ['CRM Assignments', 1438, 'TBD', '-', '- (Smartico API not built)'],
];

const CONTRIBUTORS = [
  ['Creator (WS1 V3 IGMP, all kiosks)', 'Promos'],
  ['elyssa', 313],
  ['alysa', 41],
  ['wen_promo', 12],
  ['admin_waiyip', 7],
  ['joelwan', 1],
  ['Jeevan', 1],
];

const NOTES = [
  ['Notes'],
  [`Generated: ${new Date().toISOString()}`],
  ['Source: BO-direct API queries (QPRO + QP2 + WS1 IGMP + WS2 IGMP + V4 CMS Directus).'],
  [''],
  ['Methodology:'],
  ['• Promos: created_at filter ≥ 2026-01-01. TEST_* codes excluded.'],
  ['• QP2: de-duplicated by code across 4 merchants on ibc22.'],
  ['• WS1 V3 IGMP: walked sorted-by-id-desc, called per-type detail endpoint for LogTimeStamp.'],
  ['• Banners: BO created_at where available; V4 CMS uses image.startDate (no creation date exposed).'],
  ['• V4 CMS YTD = banners with images.startDate in 2026.'],
  [''],
  ['Known gaps:'],
  ['• WS1 V3 IGMP MY was account-locked early in the day; now unlocked, count is accurate.'],
  ['• Smartico CRM client not built — CRM YTD still pulled from manually-filled weekly sheets.'],
  ['• New Games has no BO source — staff self-reports into weekly sheets only.'],
  ['• Utilization (staff hours) — staff self-report only.'],
];

// ── Create the spreadsheet ──────────────────────────────────────────────────
const { sheets } = await getSheetsClient();

console.log(`Creating: ${TITLE} ...`);
const create = await sheets.spreadsheets.create({
  requestBody: {
    properties: { title: TITLE },
    sheets: [
      { properties: { title: 'Summary',      gridProperties: { rowCount: 50, columnCount: 6 } } },
      { properties: { title: 'Promo Codes',  gridProperties: { rowCount: 50, columnCount: 4 } } },
      { properties: { title: 'Banners',      gridProperties: { rowCount: 50, columnCount: 4 } } },
      { properties: { title: 'Top Creators', gridProperties: { rowCount: 20, columnCount: 3 } } },
      { properties: { title: 'Notes',        gridProperties: { rowCount: 30, columnCount: 2 } } },
    ],
  },
  fields: 'spreadsheetId,spreadsheetUrl,sheets.properties',
});

const id = create.data.spreadsheetId;
const url = create.data.spreadsheetUrl;
console.log(`Created spreadsheet: ${url}`);

// ── Write content ──────────────────────────────────────────────────────────
async function writeTab(name, rows) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${name}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });
}

await writeTab('Summary', [
  [TITLE], [''],
  ...SUMMARY,
]);
await writeTab('Promo Codes', PROMOS);
await writeTab('Banners', BANNERS);
await writeTab('Top Creators', CONTRIBUTORS);
await writeTab('Notes', NOTES);

// ── Format header rows (bold) on Summary, Promo Codes, Banners ─────────────
const headerFormatRequests = [];
const sheetMap = {};
for (const s of create.data.sheets) sheetMap[s.properties.title] = s.properties.sheetId;
for (const tab of ['Summary', 'Promo Codes', 'Banners', 'Top Creators', 'Notes']) {
  headerFormatRequests.push({
    repeatCell: {
      range: { sheetId: sheetMap[tab], startRowIndex: 0, endRowIndex: 1 },
      cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.85, green: 0.92, blue: 1 } } },
      fields: 'userEnteredFormat(textFormat,backgroundColor)',
    },
  });
}
await sheets.spreadsheets.batchUpdate({
  spreadsheetId: id,
  requestBody: { requests: headerFormatRequests },
});

console.log('\n══════════════════════════════════════════════════════════════════');
console.log(' Dashboard published.');
console.log('══════════════════════════════════════════════════════════════════');
console.log(`\n  ${url}\n`);
console.log('  Tabs: Summary | Promo Codes | Banners | Top Creators | Notes\n');
