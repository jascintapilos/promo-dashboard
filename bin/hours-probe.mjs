#!/usr/bin/env node
// Ad-hoc probe of the Work Hours Utilization sheet.
//   PROMO_SHEET_ID=<id> node bin/hours-probe.mjs                 # list tabs+gids
//   PROMO_SHEET_ID=<id> node bin/hours-probe.mjs --tab='May 2026' --rows=50

import { parseArgs } from './_args.js';
import { getSheetsClient, getSpreadsheetId } from '../src/sheets-client.js';

const { flags } = parseArgs(process.argv.slice(2));
const wantTab = flags.tab;
const rows = Number(flags.rows || 60);
const startRow = Number(flags.start || 1);

const c = await getSheetsClient();
const meta = await c.sheets.spreadsheets.get({
  spreadsheetId: getSpreadsheetId(),
  fields: 'sheets.properties(sheetId,title,gridProperties)',
});
const tabs = meta.data.sheets.map((s) => s.properties);

if (!wantTab) {
  console.log('Tabs (name → gid → rows×cols):');
  for (const t of tabs) {
    const gp = t.gridProperties || {};
    console.log(`  ${t.title.padEnd(20)} ${String(t.sheetId).padEnd(12)} ${gp.rowCount}×${gp.columnCount}`);
  }
  process.exit(0);
}

// Read first N rows of the chosen tab
const range = `'${wantTab.replace(/'/g, "\\'")}'!A${startRow}:Z${startRow + rows - 1}`;
const res = await c.sheets.spreadsheets.values.get({
  spreadsheetId: getSpreadsheetId(),
  range,
  valueRenderOption: flags.formula ? 'FORMULA' : 'UNFORMATTED_VALUE',
  dateTimeRenderOption: 'FORMATTED_STRING',
});
const values = res.data.values || [];
console.log(`Tab "${wantTab}" — first ${values.length} rows:`);
for (let i = 0; i < values.length; i++) {
  const row = values[i];
  if (!row || row.every((c) => c === '' || c == null)) {
    console.log(`  R${i + 1}: (empty)`);
    continue;
  }
  console.log(`  R${String(startRow + i).padStart(3)}: ${JSON.stringify(row)}`);
}
