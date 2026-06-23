// Write col A "Status" for P124-P163 rows.
// Rules (per memory feedback_status_column_qc_is_operator_only):
//   - "QC" / "QC Completed" are operator-only → never overwrite
//   - Saved rows → "Created"
//   - P132 → leave alone (already explained via col W note); col A untouched
//
// Read-before-write: fetches current col A, only updates rows that don't
// already have an operator-set status.
//
// Run: node bin/_writeback-status-p124-163.mjs [--commit]

import fs from 'node:fs';
import {
  getSheetsClient, resolveCurrentMonthTab, readHeader,
  detectColumnMapFromHeader, colIndexToLetter, getSpreadsheetId, a1Range,
} from '../src/sheets-client.js';

const commit = process.argv.includes('--commit');
const dir = 'captures/requests';
const files = fs.readdirSync(dir).filter(f => /^P1(2[4-9]|[3-5][0-9]|6[0-3])-/.test(f)).sort();

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

// Read current col A for the target rows
const sortedRows = files.map(f => JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'))).sort((a, b) => a.source_line - b.source_line);
const firstRow = sortedRows[0].source_line;
const lastRow = sortedRows[sortedRows.length - 1].source_line;
const range = `${tabName}!${statusColLetter}${firstRow}:${statusColLetter}${lastRow}`;
console.log(`Reading current values from ${range}...`);
const current = await client.sheets.spreadsheets.values.get({ spreadsheetId: getSpreadsheetId(), range });
const currentValues = current.data.values || [];
console.log(`  ${currentValues.length} cells read`);

// Build write set
const data = [];
const plan = [];
const QC_LIKE = /^qc(\s*completed)?$/i;

for (const r of sortedRows) {
  const cellIdx = r.source_line - firstRow;
  const currentValue = (currentValues[cellIdx]?.[0] || '').trim();
  let newValue = null;
  let reason = null;
  if (r.request_id === 'P132') {
    reason = 'P132 not saved — col A left untouched';
  } else if (QC_LIKE.test(currentValue)) {
    reason = `operator status "${currentValue}" preserved`;
  } else {
    newValue = 'Created';
    reason = currentValue ? `overwriting "${currentValue}" → "Created"` : 'setting "Created" (was blank)';
  }
  plan.push({ rn: r.request_id, row: r.source_line, current: currentValue, newValue, reason });
  if (newValue !== null) {
    data.push({ range: a1Range(tabName, `${statusColLetter}${r.source_line}`), values: [[newValue]] });
  }
}

console.log(`\nPlan: ${data.length} cells will update, ${plan.length - data.length} skipped`);
console.log('Per-row:');
plan.forEach(p => console.log(`  ${p.rn} row=${p.row} curr="${p.current}" → ${p.newValue ?? 'SKIP'}  (${p.reason})`));

if (!commit) {
  console.log('\nDRY-RUN — pass --commit to send.');
  process.exit(0);
}

if (data.length === 0) {
  console.log('\nNothing to write.');
  process.exit(0);
}

const t0 = Date.now();
const res = await client.sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: getSpreadsheetId(),
  requestBody: { valueInputOption: 'USER_ENTERED', data },
});
const dur = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n✓ batchUpdate completed in ${dur}s`);
console.log(`  totalUpdatedCells: ${res.data.totalUpdatedCells}`);
console.log(`  totalUpdatedRows:  ${res.data.totalUpdatedRows}`);
