#!/usr/bin/env node
// Probe May 2026 + Guideline formatting so we can mirror styling.
import {
  getSheetsClient,
  getSpreadsheetId,
} from '../src/sheets-client.js';

const client = await getSheetsClient();
const ssid = getSpreadsheetId();

const res = await client.sheets.spreadsheets.get({
  spreadsheetId: ssid,
  ranges: ["'May 2026'!A1:Y2", "'Guideline'!A1:Y2"],
  fields: 'sheets(properties(sheetId,title,gridProperties),data(rowMetadata(pixelSize),columnMetadata(pixelSize),rowData(values(userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,borders)))))',
});

for (const s of res.data.sheets || []) {
  console.log(`\n━━━━━━ ${s.properties.title} (sheetId=${s.properties.sheetId}) ━━━━━━`);
  console.log(`  rows=${s.properties.gridProperties.rowCount} cols=${s.properties.gridProperties.columnCount} frozenRows=${s.properties.gridProperties.frozenRowCount || 0} frozenCols=${s.properties.gridProperties.frozenColumnCount || 0}`);
  const data = s.data?.[0];
  if (!data) continue;

  console.log('\n  Column widths (px):');
  (data.columnMetadata || []).forEach((c, i) => {
    const col = String.fromCharCode(65 + i);
    console.log(`    ${col}: ${c.pixelSize}`);
  });

  console.log('\n  Row heights (px):');
  (data.rowMetadata || []).forEach((r, i) => {
    console.log(`    R${i + 1}: ${r.pixelSize}`);
  });

  console.log('\n  Header (R1) cell formats (first 3 + last 1):');
  const headerCells = data.rowData?.[0]?.values || [];
  [0, 1, 2, headerCells.length - 1].forEach((i) => {
    const c = headerCells[i];
    if (!c) return;
    console.log(`    Col ${String.fromCharCode(65 + i)}: ${JSON.stringify(c.userEnteredFormat, null, 2).split('\n').join('\n      ')}`);
  });

  console.log('\n  Data row (R2) format (first cell):');
  const r2 = data.rowData?.[1]?.values?.[0];
  if (r2) console.log(`    ${JSON.stringify(r2.userEnteredFormat, null, 2).split('\n').join('\n    ')}`);
}
