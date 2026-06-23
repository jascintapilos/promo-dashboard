/**
 * One-time migration: inserts a "Uploaded Date" (upload date) column at position A
 * in the Banner Log sheet. All existing columns shift right by one;
 * existing rows get a blank Date cell. Pull scripts will populate going forward.
 *
 * Usage:
 *   node bin/insert-banner-date-column.mjs          # dry run
 *   node bin/insert-banner-date-column.mjs --write  # apply
 */
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const WRITE = flags.write === true;

const SHEET_ID   = getOpsSheetId();
const BANNER_TAB = 'Banner Log';

const { sheets } = await getSheetsClient();

// Check current A1 — idempotent
const hdrRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${BANNER_TAB}'!A1` });
const a1 = ((hdrRes.data.values || [['']])[0][0] || '').trim();
if (/^date$/i.test(a1)) {
  console.log('Column A already "Uploaded Date" — nothing to do.');
  process.exit(0);
}
console.log(`Current A1 = "${a1}"  →  will insert "Uploaded Date" column at A (existing columns shift right)`);
if (!WRITE) {
  console.log('\nDRY RUN — re-run with --write to apply.');
  process.exit(0);
}

// Resolve numeric sheetId needed for insertDimension
const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties' });
const sheetGid = meta.data.sheets.find(s => s.properties.title === BANNER_TAB)?.properties.sheetId;
if (sheetGid == null) { console.error(`Sheet "${BANNER_TAB}" not found.`); process.exit(1); }

// Insert one blank column at index 0
await sheets.spreadsheets.batchUpdate({
  spreadsheetId: SHEET_ID,
  requestBody: {
    requests: [{
      insertDimension: {
        range: { sheetId: sheetGid, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
        inheritFromBefore: false,
      },
    }],
  },
});

// Write "Uploaded Date" header into the new A1
await sheets.spreadsheets.values.update({
  spreadsheetId: SHEET_ID,
  range: `'${BANNER_TAB}'!A1`,
  valueInputOption: 'USER_ENTERED',
  requestBody: { values: [['Date']] },
});

console.log('✅  Inserted "Uploaded Date" column at A. Existing rows have blank Date; pull scripts will populate going forward.');
