import { getSheetsClient, getSpreadsheetId } from '../src/sheets-client.js';

const FIRST_DATA_ROW = 109;
const DENOM = 32;
const TAB = 'June 2026';

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
  { row: 140, data: dataRow('', 'Gaby DM — extended coaching: WS1 Promotion Suite, promo code QA, API/playwright guidance, memory setup', 1.5, 140) },
  { row: 141, data: dataRow('', '#promotions-team + #ops-teamleads — evening coordination, promo name fix', 1, 141) },
];

const batchData = updates.map(({ row, data: rowData }) => ({
  range: `'${TAB}'!A${row}:H${row}`,
  values: [rowData],
}));

const resp = await c.sheets.spreadsheets.values.batchUpdate({
  spreadsheetId,
  requestBody: { valueInputOption: 'USER_ENTERED', data: batchData },
});
console.log(`✓ ${resp.data.totalUpdatedCells} cells updated.`);
