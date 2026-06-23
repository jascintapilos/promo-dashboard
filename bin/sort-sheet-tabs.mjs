/**
 * Sort all Weekly Report tabs by Date descending so the latest data
 * always appears at the top. Run after all nightly pulls complete.
 *
 * Usage:
 *   node bin/sort-sheet-tabs.mjs
 */
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';

const { sheets } = await getSheetsClient();
const ID = getOpsSheetId();

// Tabs to sort and which column (0-based) holds the date
const TABS = [
  { name: 'Promo Code Log',        dateCol: 0 },  // Date  DD/MM/YYYY
  { name: 'Banner Log',            dateCol: 0 },  // Start DD/MM/YYYY
  { name: 'CRM Assignment Log',    dateCol: 0 },  // Date  YYYY-MM-DD
  { name: 'Manual Entry (CRM)',    dateCol: 0 },  // Date  manual
  { name: 'New Games',             dateCol: 0 },  // Date  DD/MM/YYYY
];

// Resolve tab name → numeric sheetId (required by sortRange API)
const meta = await sheets.spreadsheets.get({
  spreadsheetId: ID,
  fields: 'sheets(properties(title,sheetId))',
});
const sheetIdMap = {};
for (const s of meta.data.sheets || []) {
  sheetIdMap[s.properties.title] = s.properties.sheetId;
}

console.log('\nSorting tabs by date descending…');

for (const { name, dateCol } of TABS) {
  const sheetId = sheetIdMap[name];
  if (sheetId == null) { console.log(`  ${name.padEnd(25)} — tab not found, skipped`); continue; }

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: ID,
      requestBody: {
        requests: [{
          sortRange: {
            range: {
              sheetId,
              startRowIndex: 1,   // skip header row
              startColumnIndex: 0,
              endColumnIndex: 26,  // A–Z
            },
            sortSpecs: [{ dimensionIndex: dateCol, sortOrder: 'DESCENDING' }],
          },
        }],
      },
    });
    console.log(`  ${name.padEnd(25)} ✓`);
  } catch (e) {
    console.log(`  ${name.padEnd(25)} ERROR: ${e.message.slice(0, 60)}`);
  }
}

console.log('\nDone.');
