/**
 * One-off: create the 'Manual Entry (CRM)' tab in the Weekly Report sheet
 * and write a header row matching CRM Assignment Log column layout.
 *
 * Usage:
 *   node bin/_create-manual-entry-crm-tab.mjs
 */
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';

const { sheets } = await getSheetsClient();
const OPS_ID = getOpsSheetId();
const TAB = 'Manual Entry (CRM)';

const HEADER = ['Date', 'Brand', 'Region', 'CRM Tool', 'Segment Name', 'Created By'];

// 1. Check if tab already exists
const meta = await sheets.spreadsheets.get({
  spreadsheetId: OPS_ID,
  fields: 'sheets.properties.title',
});
const tabExists = meta.data.sheets.some(s => s.properties.title === TAB);

if (tabExists) {
  console.log(`Tab '${TAB}' already exists — nothing to do.`);
  process.exit(0);
}

// 2. Create tab
await sheets.spreadsheets.batchUpdate({
  spreadsheetId: OPS_ID,
  requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
});
console.log(`Created tab '${TAB}'.`);

// 3. Write header row
await sheets.spreadsheets.values.update({
  spreadsheetId: OPS_ID,
  range: `'${TAB}'!A1`,
  valueInputOption: 'RAW',
  requestBody: { values: [HEADER] },
});
console.log(`Header written: ${HEADER.join(' | ')}`);
console.log(`\n✅ Done. Operators can now add CRM rows to '${TAB}' — pull scripts will never clear it.`);
