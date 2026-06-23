#!/usr/bin/env node
import { getSheetsClient, getSpreadsheetId, resolveCurrentMonthTab, readHeader, detectColumnMapFromHeader, a1Range } from '../src/sheets-client.js';

const client = await getSheetsClient();
const tab = await resolveCurrentMonthTab(client, new Date());
console.log('Tab:', tab);
const header = await readHeader(client, tab);
const colMap = detectColumnMapFromHeader(header);

console.log('\nColumn map:');
for (const [k,v] of Object.entries(colMap)) {
  if (v !== undefined) console.log(`  ${k}: col ${v} (${String.fromCharCode(65+v)})`);
}

const range = a1Range(tab, 'A2:Z500');
const res = await client.sheets.spreadsheets.values.get({
  spreadsheetId: getSpreadsheetId(),
  range,
  valueRenderOption: 'UNFORMATTED_VALUE',
});
const rows = res.data.values || [];

const targets = new Set(['P085','P086','P087','P088','P112','P113','P114','P115']);
const reqNumCol = colMap.request_number; // col D = index 3
const statusCol = colMap.status;         // col A = index 0
console.log('\nTarget rows (request_number col=' + reqNumCol + ', status col=' + statusCol + '):');
for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  const handle = String(row[reqNumCol] || '').trim();
  if (targets.has(handle)) {
    console.log(`  Row ${i+2}: status="${row[statusCol]}" | handle="${handle}" | all=[${row.slice(0,26).join(' | ')}]`);
  }
}
