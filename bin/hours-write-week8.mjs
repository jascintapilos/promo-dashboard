import { getSheetsClient, getSpreadsheetId } from '../src/sheets-client.js';

const FIRST_DATA_ROW = 71;
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
  { row: 70, data: ['WEEK 8', '', '', '', '', '', '', ''] },
  // Mon 22/06
  { row: 71, data: dataRow('22/06/2026', 'BA Standup', 1, 71) },
  { row: 72, data: dataRow('', 'Wen weekly catchup', 1, 72) },
  { row: 73, data: dataRow('', 'Thomas', 0.5, 73) },
  { row: 74, data: dataRow('', 'CEE', 1, 74) },
  { row: 75, data: dataRow('', 'WY DM — weekly report delivery, dashboard demo, CRM log review', 1, 75) },
  { row: 76, data: dataRow('', 'Claude Automation — promo canary session work', 2.5, 76) },
  // Tue 23/06
  { row: 77, data: dataRow('23/06/2026', 'Catch up with Tomei (WY, Aiodin)', 1, 77) },
  { row: 78, data: dataRow('', 'ID Weekly Meeting', 1, 78) },
  { row: 79, data: dataRow('', 'Sales MY weekly meeting', 1, 79) },
  { row: 80, data: dataRow('', 'WY/Jascinta catchup — OKR review', 1, 80) },
  { row: 81, data: dataRow('', 'Gaby onboarding — RDP setup, Claude install + Zoom walkthrough', 2, 81) },
  { row: 82, data: dataRow('', 'Claude Automation — promo session work', 1.5, 82) },
  { row: 83, data: dataRow('', 'Slack coordination — #ba-promo (new provider), WY DM', 0.5, 83) },
  // Wed 24/06
  { row: 84, data: dataRow('24/06/2026', 'Gaby OKR mid review (WY, Gaby)', 1, 84) },
  { row: 85, data: dataRow('', 'Sales QA weekly meeting', 1, 85) },
  { row: 86, data: dataRow('', 'Bangun OKR mid review (WY, Bangun)', 1, 86) },
  { row: 87, data: dataRow('', 'Ops meeting (WY, Joel Wan)', 1, 87) },
  { row: 88, data: dataRow('', 'Headcount discussion', 0.5, 88) },
  { row: 89, data: dataRow('', 'Gaby support — bot credentials, Claude setup guide, Slack follow-up', 1, 89) },
  { row: 90, data: dataRow('', 'WY DM — IPP course enrollment, meeting logistics', 0.5, 90) },
  { row: 91, data: dataRow('', 'Claude Automation — session work', 1.5, 91) },
  // Thu 25/06
  { row: 92, data: dataRow('25/06/2026', 'Gaby Claude training — task execution walkthrough (#promotions-team)', 1.5, 92) },
  { row: 93, data: dataRow('', 'WY DM — meeting rescheduling/logistics', 0.5, 93) },
  { row: 94, data: dataRow('', 'Biweekly Tech (Aiodin) Planning Meeting', 1, 94) },
  { row: 95, data: dataRow('', 'Sales TH/KH/ID weekly meeting', 1, 95) },
  { row: 96, data: dataRow('', 'WY/Team Announcement', 1, 96) },
  { row: 97, data: dataRow('', 'Claude Automation — promo session work', 1, 97) },
  { row: 98, data: dataRow('', 'Claude Automation — Work hours tracker Week 8 update (22–25 Jun) via connected apps', 0.5, 98) },
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
