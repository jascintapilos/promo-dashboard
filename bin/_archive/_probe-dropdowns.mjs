#!/usr/bin/env node
// Probe data validation (dropdowns) on cols D and G of Guideline + May 2026.
import {
  getSheetsClient,
  getSpreadsheetId,
} from '../src/sheets-client.js';

const client = await getSheetsClient();
const ssid = getSpreadsheetId();

const res = await client.sheets.spreadsheets.get({
  spreadsheetId: ssid,
  ranges: ["'Guideline'!A1:Y10", "'May 2026'!A1:Y10"],
  fields: 'sheets(properties(sheetId,title),data(rowData(values(userEnteredValue,dataValidation))))',
});

for (const s of res.data.sheets || []) {
  console.log(`\n━━━━━━ ${s.properties.title} ━━━━━━`);
  const rows = s.data?.[0]?.rowData || [];
  // For each row, check col D (index 3) and col G (index 6)
  rows.forEach((r, ri) => {
    const d = r.values?.[3];
    const g = r.values?.[6];
    const dVal = d?.userEnteredValue?.stringValue ?? d?.userEnteredValue?.numberValue ?? '';
    const gVal = g?.userEnteredValue?.stringValue ?? g?.userEnteredValue?.numberValue ?? '';
    const dDV = d?.dataValidation ? JSON.stringify(d.dataValidation) : '(none)';
    const gDV = g?.dataValidation ? JSON.stringify(g.dataValidation) : '(none)';
    console.log(`R${ri + 1}:`);
    console.log(`  D="${dVal}" | dataValidation=${dDV}`);
    console.log(`  G="${gVal}" | dataValidation=${gDV}`);
  });
}
