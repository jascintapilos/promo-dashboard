import { getSheetsClient, getSpreadsheetId } from '../src/sheets-client.js';

const FIRST_DATA_ROW = 46;
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
  { row: 45, data: ['WEEK 7', '', '', '', '', '', '', ''] },
  // Mon 15/06
  { row: 46, data: dataRow('15/06/2026', 'BA x PROMO standup', 0.5, 46) },
  { row: 47, data: dataRow('', 'WY Zoom catchup', 0.5, 47) },
  { row: 48, data: dataRow('', 'Slack coordination — #promotions-team, #ba-promo', 1, 48) },
  { row: 49, data: dataRow('', 'Claude Automation — promo canary runs, P### saves, QC', 6, 49) },
  // Tue 16/06
  { row: 50, data: dataRow('16/06/2026', 'ID Weekly', 1, 50) },
  { row: 51, data: dataRow('', 'Sales MY meeting', 0.5, 51) },
  { row: 52, data: dataRow('', 'Clickhouse meeting', 0.5, 52) },
  { row: 53, data: dataRow('', 'Slack coordination — #promotions-team, team comms', 1, 53) },
  { row: 54, data: dataRow('', 'Claude Automation — promo canary runs, session work', 5, 54) },
  // Wed 17/06 (PH — worked)
  { row: 55, data: dataRow('17/06/2026', 'Claude Automation — promo work', 5, 55, 'PH') },
  { row: 56, data: dataRow('', 'Promotions Team + [Sales] Leaders Slack/TG comms', 1, 56, 'PH') },
  // Thu 18/06 (6 rows — incl. overtime)
  { row: 57, data: dataRow('18/06/2026', 'Sales TH/KH/ID standup', 0.5, 57) },
  { row: 58, data: dataRow('', '#promotions-team task follow-up + Gaby DM (promo content)', 0.5, 58) },
  { row: 59, data: dataRow('', 'WY sync — Shyam meeting debrief', 0.5, 59) },
  { row: 60, data: dataRow('', 'Claude Automation — promo canary runs, session work', 3, 60) },
  { row: 61, data: dataRow('', '[Sales] Leaders comms + Bangun SOP guidance (Slack/TG)', 1, 61) },
  { row: 62, data: dataRow('', 'Dashboard — weekly report dashboard development (overtime, 21:47 onwards)', 1, 62) },
  // Fri 19/06 (7 rows — incl. morning dashboard continuation)
  { row: 63, data: dataRow('19/06/2026', 'Dashboard — weekly report dashboard development (morning continuation)', 1.5, 63) },
  { row: 64, data: dataRow('', 'Weekly team catchup', 1, 64) },
  { row: 65, data: dataRow('', 'VM Slot meeting', 0.5, 65) },
  { row: 66, data: dataRow('', 'Betby Demo', 0.5, 66) },
  { row: 67, data: dataRow('', 'Slack coordination', 0.5, 67) },
  { row: 68, data: dataRow('', 'Claude Automation — promo canary work', 3, 68) },
  { row: 69, data: dataRow('', 'Claude Automation — Work hours tracker Week 7 update (15–19 Jun) via connected apps', 0.5, 69) },
];

const batchData = updates.map(({ row, data: rowData }) => ({
  range: `'${TAB}'!A${row}:H${row}`,
  values: [rowData],
}));

const resp = await c.sheets.spreadsheets.values.batchUpdate({
  spreadsheetId,
  requestBody: {
    valueInputOption: 'USER_ENTERED',
    data: batchData,
  },
});
console.log(`✓ ${resp.data.totalUpdatedCells} cells updated across ${resp.data.totalUpdatedRanges} ranges.`);

console.log('Done — R45-R67 written. Expected total: 33.5h (83.75%)');
