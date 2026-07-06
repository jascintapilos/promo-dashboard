/**
 * Deduplicate CRM Assignment Log by removing earlier duplicate rows.
 * Key = Date+Brand+Region+CRMTool+SegmentName. Keeps LAST occurrence (newest batch).
 * Usage: node bin/_dedup-crm-log.mjs [--commit]
 */
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const COMMIT = flags.commit === true;

const SHEET_ID = getOpsSheetId();
const TAB = 'CRM Assignment Log';

const c = await getSheetsClient();

console.log('Reading CRM Assignment Log...');
const resp = await c.sheets.spreadsheets.values.get({
  spreadsheetId: SHEET_ID,
  range: `'${TAB}'!A:F`,
  valueRenderOption: 'UNFORMATTED_VALUE',
});
const rows = resp.data.values || [];
const [header, ...dataRows] = rows;
console.log(`Total data rows: ${dataRows.length}`);

// Build key map — last occurrence wins (keep newest batch)
const lastSeen = new Map(); // key → row index (0-based in dataRows)
for (let i = 0; i < dataRows.length; i++) {
  const r = dataRows[i];
  const key = [r[0]||'', r[1]||'', r[2]||'', r[3]||'', r[4]||''].join('|||');
  lastSeen.set(key, i);
}

// Mark rows to delete = any row that is NOT the last occurrence of its key
const toDelete = []; // sheet row numbers (1-based, header=row1)
for (let i = 0; i < dataRows.length; i++) {
  const r = dataRows[i];
  const key = [r[0]||'', r[1]||'', r[2]||'', r[3]||'', r[4]||''].join('|||');
  if (lastSeen.get(key) !== i) {
    toDelete.push(i + 2); // +1 for header, +1 for 1-based
  }
}

// Count by CRM tool
const toolDist = {};
toDelete.forEach(rowNum => {
  const r = dataRows[rowNum - 2];
  const t = r[3] || '(blank)';
  toolDist[t] = (toolDist[t] || 0) + 1;
});

console.log(`\nDuplicate rows to delete: ${toDelete.length}`);
Object.entries(toolDist).forEach(([t, n]) => console.log(`  ${String(n).padStart(5)}  ${t}`));

if (toDelete.length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}

if (!COMMIT) {
  console.log('\nDRY RUN — re-run with --commit to delete.');
  process.exit(0);
}

// Get sheet GID
const metaResp = await c.sheets.spreadsheets.get({
  spreadsheetId: SHEET_ID,
  fields: 'sheets.properties(sheetId,title)',
});
const gid = metaResp.data.sheets.find(s => s.properties.title === TAB).properties.sheetId;

// Delete from bottom to top to preserve row numbers
toDelete.sort((a, b) => b - a);
const requests = toDelete.map(rowNum => ({
  deleteDimension: {
    range: { sheetId: gid, dimension: 'ROWS', startIndex: rowNum - 1, endIndex: rowNum },
  },
}));

// Batch in chunks of 500 to avoid request size limits
const CHUNK = 500;
for (let i = 0; i < requests.length; i += CHUNK) {
  await c.sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests: requests.slice(i, i + CHUNK) },
  });
  console.log(`Deleted rows ${i + 1}–${Math.min(i + CHUNK, requests.length)} of ${requests.length}...`);
}

console.log(`\n✅ Deleted ${toDelete.length} duplicate rows from CRM Assignment Log.`);
