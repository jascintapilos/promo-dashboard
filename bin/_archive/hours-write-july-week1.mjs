import { getSheetsClient, getSpreadsheetId } from '../src/sheets-client.js';

const FIRST_DATA_ROW = 2;
const DENOM = 40;
const TAB = 'July 2026';

const c = await getSheetsClient();
const spreadsheetId = getSpreadsheetId();

// Create the tab first
await c.sheets.spreadsheets.batchUpdate({
  spreadsheetId,
  requestBody: {
    requests: [{ addSheet: { properties: { title: TAB } } }],
  },
});
console.log(`✓ Tab "${TAB}" created.`);

const dataRow = (date, task, hours, rowNum, remark = '') => [
  date, task, '', hours,
  `=SUM($D$${FIRST_DATA_ROW}:D${rowNum})`,
  `=${DENOM}-E${rowNum}`,
  `=(E${rowNum}/${DENOM})*100`,
  remark,
];

const updates = [
  { row: 1,  data: ['WEEK 1', '', '', '', '', '', '', ''] },
  // Mon 06/07 — 8h
  { row: 2,  data: dataRow('06/07/2026', '#promotions-team — Weekly report dashboard verification, banner data bug fix, WY update', 1.5, 2) },
  { row: 3,  data: dataRow('', '#ba-promo — P012 canary (Gaby), WS1 QC (Wen+Alysa), P013–P016 TLEO codes, recurring config fix', 1.5, 3) },
  { row: 4,  data: dataRow('', 'Kasturi DM — QC task assignment, BO password resets, training zoom', 1.5, 4) },
  { row: 5,  data: dataRow('', 'Gaby DM — WS1 FT customer journey discussion (evening zoom)', 1, 5) },
  { row: 6,  data: dataRow('', '#qp2-tech-support — Sports category promo bug investigation + incident resolution', 0.5, 6) },
  { row: 7,  data: dataRow('', 'Claude Automation — promo session work', 2, 7) },
  // Tue 07/07 — 8h
  { row: 8,  data: dataRow('07/07/2026', 'ID Weekly Meeting', 1, 8) },
  { row: 9,  data: dataRow('', 'Sales Weekly Meeting - MY', 1, 9) },
  { row: 10, data: dataRow('', 'Kasturi DM + training — RDP troubleshooting, BO platform intro sessions 1 & 2 (zoom x2)', 2, 10) },
  { row: 11, data: dataRow('', '#promotions-team + #ba-promo — OKR Q2 collection, promo code convention RET/REL (WY), Gaby FT probe guidance', 1, 11) },
  { row: 12, data: dataRow('', 'WY DM — Promo Value Creation deck planning', 0.5, 12) },
  { row: 13, data: dataRow('', 'Claude Automation — promo session work', 2.5, 13) },
  // Wed 08/07 — 7.5h
  { row: 14, data: dataRow('08/07/2026', 'Kasturi training — BO platform intro session 3 (morning zoom)', 1, 14) },
  { row: 15, data: dataRow('', 'Sales QA - Weekly Meeting', 1, 15) },
  { row: 16, data: dataRow('', 'WY DM — Promo Value Creation deck preparation + review zoom', 1, 16) },
  { row: 17, data: dataRow('', 'Promotions Executive — Zoom interview with Leong Jin Wen (WY, recruitment)', 1, 17) },
  { row: 18, data: dataRow('', '#promotions-team — OKR follow-up, Kasturi BO access reset, WS1 guidance delegation (Wen)', 1, 18) },
  { row: 19, data: dataRow('', 'Claude Automation — promo session work', 2.5, 19) },
  // Thu 09/07 — 7h
  { row: 20, data: dataRow('09/07/2026', 'OKR Q2 scoring — 1:1 calls (Gaby 10m, Bangun 10m, Wen 30m, Alysa 15m)', 1, 20) },
  { row: 21, data: dataRow('', 'Biweekly Tech (Aiodin) Planning Meeting', 1, 21) },
  { row: 22, data: dataRow('', 'Monthly Promotions Meeting', 1, 22) },
  { row: 23, data: dataRow('', '#ba-promo + #ba-design — campaign objective column (Claudia), automation issues, Kasturi promo training', 1, 23) },
  { row: 24, data: dataRow('', '#hr-promotions + WY DM — Promotions Executive candidate criteria, strategic discussion', 0.5, 24) },
  { row: 25, data: dataRow('', 'Claude Automation — promo session work', 2.5, 25) },
  // Fri 10/07 — 8.5h
  { row: 26, data: dataRow('10/07/2026', 'Weekly catch up (WY + team: Boon Inn, Elyssa, Menhua, Gaby, Bangun, Kasturi)', 1, 26) },
  { row: 27, data: dataRow('', '#ba-promo — P036–P060 canary batch (Gaby), P026–P035 QC delegation, ongoing QC oversight (through 7pm)', 2.5, 27) },
  { row: 28, data: dataRow('', 'VM Slot for Catch Ups (Shyam, Mimi, WY)', 1, 28) },
  { row: 29, data: dataRow('', 'WY DM — team management: Alysa banner automation progress, OKR submission, promo strategy', 1, 29) },
  { row: 30, data: dataRow('', 'Kasturi DM + #ba-promo — ClickUp access setup (Joel W), credential admin', 0.5, 30) },
  { row: 31, data: dataRow('', 'Claude Automation — promo session work (token limit hit mid-day; promo_testbot memory + skill update noted)', 2, 31) },
  { row: 32, data: dataRow('', 'Claude Automation — Work hours tracker Week 1 update (6–10 Jul) via connected apps', 0.5, 32) },
];

const batchData = updates.map(({ row, data: rowData }) => ({
  range: `'${TAB}'!A${row}:H${row}`,
  values: [rowData],
}));

const resp = await c.sheets.spreadsheets.values.batchUpdate({
  spreadsheetId,
  requestBody: { valueInputOption: 'USER_ENTERED', data: batchData },
});
console.log(`✓ ${resp.data.totalUpdatedCells} cells written across ${resp.data.totalUpdatedRanges} ranges.`);
