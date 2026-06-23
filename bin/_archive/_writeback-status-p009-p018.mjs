// Write col A "Status" = "Created" for P009-P018 (WCF campaign).
// Run: node bin/_writeback-status-p009-p018.mjs [--commit]

import {
  getSheetsClient, resolveCurrentMonthTab, readHeader,
  detectColumnMapFromHeader, colIndexToLetter, getSpreadsheetId, a1Range,
} from '../src/sheets-client.js';

const commit = process.argv.includes('--commit');

// P009-P018 source_lines (verified post-ingest 2026-06-15)
const rows = [
  { id: 'P009', row: 10 },
  { id: 'P010', row: 11 },
  { id: 'P011', row: 12 },
  { id: 'P012', row: 13 },
  { id: 'P013', row: 14 },
  { id: 'P014', row: 15 },
  { id: 'P015', row: 16 },
  { id: 'P016', row: 17 },
  { id: 'P017', row: 18 },
  { id: 'P018', row: 19 },
];

const client = await getSheetsClient();
const tabName = await resolveCurrentMonthTab(client);
const header = await readHeader(client, tabName);
const colMap = detectColumnMapFromHeader(header);
const statusCol = colMap.status;
if (statusCol == null) {
  console.error('No "status" column found in sheet header. Keys:', Object.keys(colMap));
  process.exit(3);
}
const statusColLetter = colIndexToLetter(statusCol);
console.log(`Tab: ${tabName}`);
console.log(`Status column: ${statusColLetter}`);
console.log(`Mode: ${commit ? 'LIVE (--commit)' : 'DRY-RUN'}`);

// Read current status values for rows 10-19
const range = `${tabName}!${statusColLetter}${rows[0].row}:${statusColLetter}${rows[rows.length - 1].row}`;
const current = await client.sheets.spreadsheets.values.get({ spreadsheetId: getSpreadsheetId(), range });
const currentValues = current.data.values || [];

const QC_LIKE = /^qc(\s*completed)?$/i;
const data = [];
const plan = [];

for (const { id, row } of rows) {
  const cellIdx = row - rows[0].row;
  const currentValue = (currentValues[cellIdx]?.[0] || '').trim();
  let newValue = null;
  let reason = null;
  if (QC_LIKE.test(currentValue)) {
    reason = `operator status "${currentValue}" preserved`;
  } else {
    newValue = 'QC Completed';
    reason = currentValue ? `overwriting "${currentValue}" → "QC Completed"` : 'setting "QC Completed" (was blank)';
  }
  plan.push({ id, row, current: currentValue, newValue, reason });
  if (newValue !== null) {
    data.push({ range: a1Range(tabName, `${statusColLetter}${row}`), values: [[newValue]] });
  }
}

console.log(`\nPlan: ${data.length} cells will update, ${plan.length - data.length} skipped`);
plan.forEach(p => console.log(`  ${p.id} row=${p.row} curr="${p.current}" → ${p.newValue ?? 'SKIP'}  (${p.reason})`));

if (!commit) { console.log('\nDRY-RUN — pass --commit to send.'); process.exit(0); }
if (data.length === 0) { console.log('\nNothing to write.'); process.exit(0); }

const t0 = Date.now();
const res = await client.sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: getSpreadsheetId(),
  requestBody: { valueInputOption: 'USER_ENTERED', data },
});
const dur = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n✓ batchUpdate completed in ${dur}s`);
console.log(`  totalUpdatedCells: ${res.data.totalUpdatedCells}`);
