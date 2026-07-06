import { getSheetsClient, getSpreadsheetId } from '../src/sheets-client.js';

const FIRST_DATA_ROW = 109;
const TAB = 'June 2026';

const c = await getSheetsClient();
const spreadsheetId = getSpreadsheetId();

const dataRow = (date, task, hours, rowNum, remark = '') => [
  date, task, '', hours,
  `=SUM($D$${FIRST_DATA_ROW}:D${rowNum})`,
  `=40-E${rowNum}`,
  `=(E${rowNum}/40)*100`,
  remark,
];

const updates = [
  { row: 108, data: ['WEEK 9', '', '', '', '', '', '', ''] },
  // Mon 29/06 — MC, 2h
  { row: 109, data: dataRow('29/06/2026', 'Dashboard — weekly report dashboard fix + CRM data verification', 2, 109, 'MC') },
  // Tue 30/06 — 8h
  { row: 110, data: dataRow('30/06/2026', 'Wen Probation Review (WY, Boon Inn)', 1, 110) },
  { row: 111, data: dataRow('', 'ID Weekly Meeting', 1, 111) },
  { row: 112, data: dataRow('', 'Alysa GitHub + Claude Code setup support (#promotions-team)', 0.5, 112) },
  { row: 113, data: dataRow('', 'Sales MY weekly meeting', 1, 113) },
  { row: 114, data: dataRow('', 'Kevin Catch up (WY, Kevin Teh)', 1, 114) },
  { row: 115, data: dataRow('', 'Wen DM — probation feedback memo + follow-up', 0.5, 115) },
  { row: 116, data: dataRow('', 'Gaby DM — promo config QA, coaching, skill update guidance', 1, 116) },
  { row: 117, data: dataRow('', 'Claude Automation — promo session work', 2, 117) },
  // Wed 01/07 — 7h
  { row: 118, data: dataRow('01/07/2026', 'Sales QA weekly meeting', 1, 118) },
  { row: 119, data: dataRow('', 'Job Briefing Session (Kasturi candidate)', 0.5, 119) },
  { row: 120, data: dataRow('', 'Alysa Claude Code training — banner skills, install-skills, git pull', 1.5, 120) },
  { row: 121, data: dataRow('', 'WY DM coordination', 0.5, 121) },
  { row: 122, data: dataRow('', 'Kasturi DM + Tools Setup session', 1, 122) },
  { row: 123, data: dataRow('', 'Gaby DM — P173 test review + coaching', 0.5, 123) },
  { row: 124, data: dataRow('', 'Claude Automation — promo session work', 2, 124) },
  // Thu 02/07 — 7.5h
  { row: 125, data: dataRow('02/07/2026', 'Kasturi training — BO platform intro (session 1)', 1, 125) },
  { row: 126, data: dataRow('', 'Wen DM — preventative action doc review', 0.5, 126) },
  { row: 127, data: dataRow('', 'Shyam Catch Up (WY + Shyam)', 1, 127) },
  { row: 128, data: dataRow('', 'Sales TH/KH/ID weekly meeting', 1, 128) },
  { row: 129, data: dataRow('', 'Kasturi training — BO platform intro (session 2)', 0.5, 129) },
  { row: 130, data: dataRow('', 'Biweekly Tech (PureIS) Planning Meeting', 1, 130) },
  { row: 131, data: dataRow('', 'Gaby + WY DM — promo issues, townhall slides, Kasturi BO setup', 1, 131) },
  { row: 132, data: dataRow('', 'Claude Automation — promo session work', 1.5, 132) },
  // Fri 03/07 — 4h
  { row: 133, data: dataRow('03/07/2026', 'Weekly team catch up', 1, 133) },
  { row: 134, data: dataRow('', 'Townhall slide — first draft to WY, team communications', 0.5, 134) },
  { row: 135, data: dataRow('', '#ba-promo — value per spin error, P005-P009 MT/dialog update', 0.5, 135) },
  { row: 136, data: dataRow('', 'Kasturi onboarding coordination (delegated training to Wen)', 0.5, 136) },
  { row: 137, data: dataRow('', 'Gaby DM — promo skill update, WS1 Promotion Suite guidance', 0.5, 137) },
  { row: 138, data: dataRow('', 'Claude Automation — Work hours tracker Week 9 update (29 Jun–3 Jul) via connected apps', 0.5, 138) },
  { row: 139, data: dataRow('', 'Claude Automation — promo session work', 0.5, 139) },
];

const batchData = updates.map(({ row, data: rowData }) => ({
  range: `'${TAB}'!A${row}:H${row}`,
  values: [rowData],
}));

const resp = await c.sheets.spreadsheets.values.batchUpdate({
  spreadsheetId,
  requestBody: { valueInputOption: 'USER_ENTERED', data: batchData },
});
console.log(`✓ ${resp.data.totalUpdatedCells} cells updated across ${resp.data.totalUpdatedRanges} ranges.`);
