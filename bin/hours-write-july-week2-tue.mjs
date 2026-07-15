import { getSheetsClient, getSpreadsheetId } from '../src/sheets-client.js';

const FIRST_DATA_ROW = 35;
const DENOM = 40;
const TAB = 'July 2026';

const c = await getSheetsClient();
const spreadsheetId = getSpreadsheetId();

const dataRow = (date, task, hours, rowNum, remark = '') => [
  date, task, '', hours,
  `=SUM($D$${FIRST_DATA_ROW}:D${rowNum})`,
  `=${DENOM}-E${rowNum}`,
  `=(E${rowNum}/${DENOM})*100`,
  remark,
];

const updates = [
  { row: 41, data: dataRow('14/07/2026', 'Kasturi Zoom — BO training planning, CMS/iGMP access walkthrough', 0.5, 41) },
  { row: 42, data: dataRow('', 'ID Weekly Meeting (Zoom)', 0.5, 42) },
  { row: 43, data: dataRow('', '#ba-promo — P079-P080 (self) + P081-P086 (Gaby) delegation; Alysa bonus calc clarification; WY WS1 Promotion Suite query; Claudia mid-month codes; Gaby canary guidance (Claude limit → new session)', 2, 43) },
  { row: 44, data: dataRow('', 'Wen DM + WY DM — Kasturi training schedule, morning check-in', 0.5, 44) },
  { row: 45, data: dataRow('', 'Sales Weekly Meeting - MY (Zoom)', 1, 45) },
  { row: 46, data: dataRow('', 'Claude Automation — P079-P080 canary (weekly limit hit, new session); July tab formatting + utilization tracker update', 2.5, 46) },
];

const batchData = updates.map(({ row, data: rowData }) => ({
  range: `'${TAB}'!A${row}:H${row}`,
  values: [rowData],
}));

const resp = await c.sheets.spreadsheets.values.batchUpdate({
  spreadsheetId,
  requestBody: { valueInputOption: 'USER_ENTERED', data: batchData },
});
console.log(`✓ ${resp.data.totalUpdatedCells} cells written (R41–R46).`);
