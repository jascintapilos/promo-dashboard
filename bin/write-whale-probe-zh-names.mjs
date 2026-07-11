// Write ZH promotion names for P176-P179 to column Y of the July 2026 tab.
import { getSheetsClient, getSpreadsheetId } from '../src/sheets-client.js';

const client = await getSheetsClient();
const { sheets } = client;

const updates = [
  { range: "'July 2026'!Y62", values: [['免费彩金 88']] },
  { range: "'July 2026'!Y63", values: [['免费彩金 118']] },
  { range: "'July 2026'!Y64", values: [['免费彩金 138']] },
  { range: "'July 2026'!Y65", values: [['免费彩金 148']] },
];

const res = await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: getSpreadsheetId(),
  requestBody: { valueInputOption: 'USER_ENTERED', data: updates },
});
console.log(`Updated ${res.data.totalUpdatedCells} cells`);
updates.forEach((u) => console.log(`  ${u.range}: ${u.values[0][0]}`));
