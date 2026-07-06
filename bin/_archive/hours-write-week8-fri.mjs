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
  // Fri 26/06
  { row: 99,  data: dataRow('26/06/2026', 'Weekly team catch up', 1, 99) },
  { row: 100, data: dataRow('', 'FS config error — investigation + pre-qc subagent fix (reward type validation)', 1.5, 100) },
  { row: 101, data: dataRow('', '#ba-promo P143-P151 FS issue — recreate codes, QC direction (Alysa, Wen)', 1, 101) },
  { row: 102, data: dataRow('', 'VM Slot Catch Up', 1, 102) },
  { row: 103, data: dataRow('', 'Dashboard fix + verification with Alysa', 0.5, 103) },
  { row: 104, data: dataRow('', 'Agent rules + campaign objective dropdown update (#ba-promo)', 0.5, 104) },
  { row: 105, data: dataRow('', 'Claude Automation — promo session work', 2, 105) },
  { row: 106, data: dataRow('', 'Slack coordination — #promotions-team, #ba-promo, WY DM, #ops-teamleads', 0.5, 106) },
  { row: 107, data: dataRow('', 'Claude Automation — Work hours tracker Week 8 update (22–26 Jun) via connected apps', 0.5, 107) },
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
