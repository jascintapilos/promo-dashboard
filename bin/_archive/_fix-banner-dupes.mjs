/**
 * Find and remove duplicate Banner Log rows for a given title pattern.
 * Usage: node bin/_fix-banner-dupes.mjs --title="Fury of Anubis" [--dry-run]
 *        node bin/_fix-banner-dupes.mjs --dry-run   (defaults to all duplicates)
 */
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const TITLE_FILTER = flags.title || '';
const DRY = flags['dry-run'] !== 'false' && flags['dry-run'] !== false && !flags.commit; // use --dry-run=false or --commit to execute

const SHEET_ID = getOpsSheetId();
const TAB = 'Banner Log';

const c = await getSheetsClient();

// Read all rows
const resp = await c.sheets.spreadsheets.values.get({
  spreadsheetId: SHEET_ID,
  range: `'${TAB}'!A:H`,
  valueRenderOption: 'UNFORMATTED_VALUE',
});
const rows = resp.data.values || [];
const [header, ...dataRows] = rows;

console.log(`Banner Log: ${dataRows.length} data rows`);

// Build dedupe key: Brand+Region+Title+Start (columns: Uploaded Date=0, Start=1, Brand=2, Region=3, Title=4, End=5, Status=6, By=7)
const COL = { uploadedDate: 0, start: 1, brand: 2, region: 3, title: 4, end: 5, status: 6, by: 7 };

// Find rows matching the title filter
const matching = dataRows
  .map((r, i) => ({ row: i + 2, title: r[COL.title] || '', brand: r[COL.brand] || '', region: r[COL.region] || '', start: r[COL.start], uploadedDate: r[COL.uploadedDate], by: r[COL.by] }))
  .filter(r => !TITLE_FILTER || r.title.toLowerCase().includes(TITLE_FILTER.toLowerCase()));

console.log(`\nRows matching "${TITLE_FILTER || 'all'}": ${matching.length}`);
if (matching.length === 0) process.exit(0);

// Group by key = Brand+Region+Title+Start
const groups = {};
for (const r of matching) {
  const key = `${r.brand}|${r.region}|${r.title}|${r.start}`;
  if (!groups[key]) groups[key] = [];
  groups[key].push(r);
}

const dupGroups = Object.entries(groups).filter(([, rows]) => rows.length > 1);
console.log(`\nDuplicate groups: ${dupGroups.length}`);

if (dupGroups.length === 0) {
  console.log('No duplicates found.');
  process.exit(0);
}

// Show duplicates
let totalToDelete = 0;
const rowsToDelete = [];
for (const [key, rows] of dupGroups) {
  const [brand, region, title, start] = key.split('|');
  console.log(`\n  ${brand} ${region} — "${title}" (start=${start})`);
  rows.forEach((r, i) => {
    const keep = i === 0;
    console.log(`    Row ${r.row}: uploaded=${r.uploadedDate} by=${r.by} ${keep ? '[KEEP]' : '[DELETE]'}`);
    if (!keep) rowsToDelete.push(r.row);
  });
  totalToDelete += rows.length - 1;
}

console.log(`\n${totalToDelete} duplicate rows to delete (keeping 1 per group).`);

if (DRY) {
  console.log('\nDRY RUN — no changes made. Re-run with --no-dry-run to delete.');
  process.exit(0);
}

// Delete duplicate rows (must delete from bottom to top to preserve row numbers)
rowsToDelete.sort((a, b) => b - a);

// Get sheet gid for batchUpdate deleteDimension
const metaResp = await c.sheets.spreadsheets.get({
  spreadsheetId: SHEET_ID,
  fields: 'sheets.properties(sheetId,title)',
});
const sheetMeta = metaResp.data.sheets.find(s => s.properties.title === TAB);
const gid = sheetMeta.properties.sheetId;

// Build deleteDimension requests
const requests = rowsToDelete.map(rowNum => ({
  deleteDimension: {
    range: {
      sheetId: gid,
      dimension: 'ROWS',
      startIndex: rowNum - 1, // 0-based
      endIndex: rowNum,       // exclusive
    },
  },
}));

await c.sheets.spreadsheets.batchUpdate({
  spreadsheetId: SHEET_ID,
  requestBody: { requests },
});

console.log(`\n✅ Deleted ${rowsToDelete.length} duplicate rows from Banner Log.`);
