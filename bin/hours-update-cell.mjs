#!/usr/bin/env node
// Update a single cell in the Work Hours tracker.
//   PROMO_SHEET_ID=<id> node bin/hours-update-cell.mjs --cell=D94 --value=1.5

import { parseArgs } from './_args.js';
import { getSheetsClient, getSpreadsheetId } from '../src/sheets-client.js';

const TAB = 'May 2026';
const { flags } = parseArgs(process.argv.slice(2));
if (!flags.cell || flags.value == null) {
  console.error('Usage: --cell=D94 --value=1.5');
  process.exit(1);
}

const c = await getSheetsClient();
const range = `'${TAB}'!${flags.cell}`;
const value = isNaN(Number(flags.value)) ? flags.value : Number(flags.value);

const resp = await c.sheets.spreadsheets.values.update({
  spreadsheetId: getSpreadsheetId(),
  range,
  valueInputOption: 'USER_ENTERED',
  requestBody: { values: [[value]] },
});
console.log(`✓ ${range} = ${value} (${resp.data.updatedCells} cell)`);
