// Compare column layout of an existing row (P064 at row 65) vs our new rows (P069 at row 70).
import { getSheetsClient, getSpreadsheetId, listTabs } from '../src/sheets-client.js';
const client = await getSheetsClient();
const tabs = await listTabs(client);
const tab = tabs.find(t => /july\s*2026/i.test(t.name));

// Also grab the header row to see column names
const h = await client.sheets.spreadsheets.values.get({
  spreadsheetId: getSpreadsheetId(),
  range: `'${tab.name}'!A1:AH1`,
  valueRenderOption: 'FORMATTED_VALUE',
});
const header = h.data.values?.[0] || [];

const r = await client.sheets.spreadsheets.values.get({
  spreadsheetId: getSpreadsheetId(),
  range: `'${tab.name}'!A65:AH70`,
  valueRenderOption: 'UNFORMATTED_VALUE',
});
const rows = r.data.values || [];
rows.forEach((row, i) => {
  const rowNum = 65 + i;
  const pid = row[3] || '';
  if (!pid) { console.log(`Row ${rowNum}: (empty)`); return; }
  console.log(`\nRow ${rowNum} (${pid}):`);
  row.forEach((v, j) => {
    if (v !== '' && v != null) {
      const colLetter = j < 26 ? String.fromCharCode(65+j) : 'A'+String.fromCharCode(65+j-26);
      const hdr = header[j] ? header[j].toString().replace(/\n/g,' ').slice(0,40) : '';
      console.log(`  [${j}/${colLetter}] ${hdr} → ${v}`);
    }
  });
});
