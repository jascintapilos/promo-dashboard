import { getSheetsClient, getSpreadsheetId } from '../src/sheets-client.js';
const client = await getSheetsClient();
const { sheets } = client;

// Read wider range to catch where data actually landed
const res = await sheets.spreadsheets.values.get({
  spreadsheetId: getSpreadsheetId(),
  range: "'July 2026'!A178:AX192",
  valueRenderOption: 'UNFORMATTED_VALUE',
});
const rows = res.data.values || [];
rows.forEach((r, i) => {
  const rowNum = 178 + i;
  const nonempty = r.map((v, j) => v !== '' && v != null ? `[${j}]${v}` : null).filter(Boolean);
  if (nonempty.length) console.log(`Row ${rowNum}: ${nonempty.slice(0, 6).join(' | ')}`);
  else console.log(`Row ${rowNum}: (empty)`);
});
