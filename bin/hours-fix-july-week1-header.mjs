import { getSheetsClient, getSpreadsheetId } from '../src/sheets-client.js';

const FIRST_DATA_ROW = 3;
const DENOM = 40;
const TAB = 'July 2026';

const c = await getSheetsClient();
const spreadsheetId = getSpreadsheetId();

// Clear the tab first
await c.sheets.spreadsheets.values.clear({
  spreadsheetId,
  range: `'${TAB}'!A1:H40`,
});
console.log('✓ Cleared existing data.');

const dataRow = (date, task, hours, rowNum, remark = '') => [
  date, task, '', hours,
  `=SUM($D$${FIRST_DATA_ROW}:D${rowNum})`,
  `=${DENOM}-E${rowNum}`,
  `=(E${rowNum}/${DENOM})*100`,
  remark,
];

const rows = [
  // R1: header (matches June 2026)
  ['Date', 'Task/Name', 'BO', 'Duration (hrs)', 'Cumulative Hours', 'Remaining Hours (40 - Cumulative)', '% of Utilisation =(Cumulative Hours/40)*100', 'Remarks'],
  // R2: week marker
  ['WEEK 1', '', '', '', '', '', '', ''],
  // Mon 06/07 — 8h (data starts R3, FIRST_DATA_ROW=3)
  dataRow('06/07/2026', '#promotions-team — Weekly report dashboard verification, banner data bug fix, WY update', 1.5, 3),
  dataRow('', '#ba-promo — P012 canary (Gaby), WS1 QC (Wen+Alysa), P013–P016 TLEO codes, recurring config fix', 1.5, 4),
  dataRow('', 'Kasturi DM — QC task assignment, BO password resets, training zoom', 1.5, 5),
  dataRow('', 'Gaby DM — WS1 FT customer journey discussion (evening zoom)', 1, 6),
  dataRow('', '#qp2-tech-support — Sports category promo bug investigation + incident resolution', 0.5, 7),
  dataRow('', 'Claude Automation — promo session work', 2, 8),
  // Tue 07/07 — 8h
  dataRow('07/07/2026', 'ID Weekly Meeting', 1, 9),
  dataRow('', 'Sales Weekly Meeting - MY', 1, 10),
  dataRow('', 'Kasturi DM + training — RDP troubleshooting, BO platform intro sessions 1 & 2 (zoom x2)', 2, 11),
  dataRow('', '#promotions-team + #ba-promo — OKR Q2 collection, promo code convention RET/REL (WY), Gaby FT probe guidance', 1, 12),
  dataRow('', 'WY DM — Promo Value Creation deck planning', 0.5, 13),
  dataRow('', 'Claude Automation — promo session work', 2.5, 14),
  // Wed 08/07 — 7.5h
  dataRow('08/07/2026', 'Kasturi training — BO platform intro session 3 (morning zoom)', 1, 15),
  dataRow('', 'Sales QA - Weekly Meeting', 1, 16),
  dataRow('', 'WY DM — Promo Value Creation deck preparation + review zoom', 1, 17),
  dataRow('', 'Promotions Executive — Zoom interview with Leong Jin Wen (WY, recruitment)', 1, 18),
  dataRow('', '#promotions-team — OKR follow-up, Kasturi BO access reset, WS1 guidance delegation (Wen)', 1, 19),
  dataRow('', 'Claude Automation — promo session work', 2.5, 20),
  // Thu 09/07 — 7h
  dataRow('09/07/2026', 'OKR Q2 scoring — 1:1 calls (Gaby 10m, Bangun 10m, Wen 30m, Alysa 15m)', 1, 21),
  dataRow('', 'Biweekly Tech (Aiodin) Planning Meeting', 1, 22),
  dataRow('', 'Monthly Promotions Meeting', 1, 23),
  dataRow('', '#ba-promo + #ba-design — campaign objective column (Claudia), automation issues, Kasturi promo training', 1, 24),
  dataRow('', '#hr-promotions + WY DM — Promotions Executive candidate criteria, strategic discussion', 0.5, 25),
  dataRow('', 'Claude Automation — promo session work', 2.5, 26),
  // Fri 10/07 — 8.5h
  dataRow('10/07/2026', 'Weekly catch up (WY + team: Boon Inn, Elyssa, Menhua, Gaby, Bangun, Kasturi)', 1, 27),
  dataRow('', '#ba-promo — P036–P060 canary batch (Gaby), P026–P035 QC delegation, ongoing QC oversight (through 7pm)', 2.5, 28),
  dataRow('', 'VM Slot for Catch Ups (Shyam, Mimi, WY)', 1, 29),
  dataRow('', 'WY DM — team management: Alysa banner automation progress, OKR submission, promo strategy', 1, 30),
  dataRow('', 'Kasturi DM + #ba-promo — ClickUp access setup (Joel W), credential admin', 0.5, 31),
  dataRow('', 'Claude Automation — promo session work (token limit hit mid-day; promo_testbot memory + skill update noted)', 2, 32),
  dataRow('', 'Claude Automation — Work hours tracker Week 1 update (6–10 Jul) via connected apps', 0.5, 33),
];

const batchData = rows.map((rowData, i) => ({
  range: `'${TAB}'!A${i + 1}:H${i + 1}`,
  values: [rowData],
}));

const resp = await c.sheets.spreadsheets.values.batchUpdate({
  spreadsheetId,
  requestBody: { valueInputOption: 'USER_ENTERED', data: batchData },
});
console.log(`✓ ${resp.data.totalUpdatedCells} cells written across ${resp.data.totalUpdatedRanges} ranges.`);
