/**
 * Sort all Weekly Report tabs by Date descending so the latest data
 * always appears at the top. Run after all nightly pulls complete.
 *
 * Tabs using DD/MM/YYYY dates are sorted client-side (JS parse + write-back)
 * because the Sheets sortRange API uses lexicographic order which puts
 * "31/01/2026" after "02/02/2026" — definitively wrong.
 * Tabs using ISO dates (YYYY-MM-DD) use the fast API sort path.
 *
 * Usage:
 *   node bin/sort-sheet-tabs.mjs
 */
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';

const { sheets } = await getSheetsClient();
const ID = getOpsSheetId();

// dateFormat: 'dmy' = DD/MM/YYYY text → client-side sort (correct)
//             'iso' = YYYY-MM-DD, or a real numeric/date-typed cell →
//                     native API sort (lex/numeric order = correct either way)
//
// Banner Log holds a genuine DATE-typed value in col A (see
// src/sheet-date-format.js) — routing it through the 'dmy' client-side path
// would read the FORMATTED display string and write it back with RAW,
// permanently flattening the real date into inert text. Native sortRange
// only reorders rows; it never rewrites cell values, so it's safe for both
// real dates and lexicographically-sortable ISO text.
const TABS = [
  { name: 'Promo Code Log',        dateCol: 0, dateFormat: 'dmy' },
  { name: 'Banner Log',            dateCol: 0, dateFormat: 'iso' },
  { name: 'CRM Assignment Log',    dateCol: 0, dateFormat: 'iso' },
  { name: 'Manual Entry (CRM)',    dateCol: 0, dateFormat: 'dmy' },
  { name: 'Manual Entry (Promo)',  dateCol: 0, dateFormat: 'dmy' },
  { name: 'Manual Entry (Banner)', dateCol: 0, dateFormat: 'dmy' },
  { name: 'New Games',             dateCol: 0, dateFormat: 'dmy' },
  { name: 'Adhoc Tasks',           dateCol: 0, dateFormat: 'iso' },
];

// Parse DD/MM/YYYY → Date. Falls back to ISO parse for manually typed dates.
function parseDMY(s) {
  const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

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

for (const { name, dateCol, dateFormat } of TABS) {
  const sheetId = sheetIdMap[name];
  if (sheetId == null) { console.log(`  ${name.padEnd(30)} — tab not found, skipped`); continue; }

  try {
    if (dateFormat === 'iso') {
      // Fast path: Sheets API sort (lexicographic = correct for YYYY-MM-DD)
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: ID,
        requestBody: {
          requests: [{
            sortRange: {
              range: {
                sheetId,
                startRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: 26,
              },
              sortSpecs: [{ dimensionIndex: dateCol, sortOrder: 'DESCENDING' }],
            },
          }],
        },
      });
    } else {
      // Client-side sort: read → parse DD/MM/YYYY → sort → write back
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: ID,
        range: `'${name}'!A:Z`,
      });
      const rows = res.data.values || [];
      if (rows.length < 2) { console.log(`  ${name.padEnd(30)} ✓ (empty)`); continue; }
      const header = rows[0];
      const data = rows.slice(1).filter(r => r && r.length);
      if (!data.length) { console.log(`  ${name.padEnd(30)} ✓ (no data rows)`); continue; }
      data.sort((a, b) => {
        const da = parseDMY(a[dateCol]), db = parseDMY(b[dateCol]);
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return db - da;
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: ID,
        range: `'${name}'!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [header, ...data] },
      });
    }
    console.log(`  ${name.padEnd(30)} ✓`);
  } catch (e) {
    console.log(`  ${name.padEnd(30)} ERROR: ${e.message.slice(0, 60)}`);
  }
}

console.log('\nDone.');
