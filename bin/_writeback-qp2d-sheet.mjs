// Writes the multi-BO list into the QP2D Promo Codes sheet.
//   Sheet1: col E (Silver) + col K (Bronze)
//   Sheet 2: col D (Silver) + col I (Bronze)
//
// Cell format per code:
//   QP2D: <code>
//   QPRO2: <code>
//   QPRO3: <code>
//   ...
//   WS1 MY: <code>
//   WS1 SG: <code>
//
// Lines for BOs that don't have the code are omitted. Lines for BOs whose
// mechanics differ from QP2D get a ✗ marker.
//
// Run: node bin/_writeback-qp2d-sheet.mjs [--commit]

import fs from 'node:fs';
import {
  getSheetsClient, getSpreadsheetId, a1Range,
} from '../src/sheets-client.js';

const commit = process.argv.includes('--commit');
const SHEET_ID = '1xnuqFBBy4tepk4tgYThv0voNhQcH3Gnyh2HUV0KRPoA';

const { map: cellMap } = JSON.parse(fs.readFileSync('captures/api-runs/qp2d-sheet-cellmap.json', 'utf8'));
const probe = JSON.parse(fs.readFileSync('captures/api-runs/qp2d-sheet-probe-v2.json', 'utf8'));
const mismatchData = JSON.parse(fs.readFileSync('captures/api-runs/qp2d-sheet-mismatches-v2.json', 'utf8'));
const mismatchesByCode = new Map();
for (const m of mismatchData.mismatches) {
  const bosWithIssues = new Set(m.issues.map(i => i.bo));
  mismatchesByCode.set(m.code, bosWithIssues);
}

const probeByCode = new Map();
for (const r of probe.results) probeByCode.set(r.code, r);

const BO_ORDER = ['QP2D', 'QPRO2', 'QPRO3', 'QPRO4', 'QPRO6', 'QPRO8', 'QPRO10', 'WS1_MY', 'WS1_SG'];
const BO_LABEL = { QP2D: 'QP2D', QPRO2: 'QPRO2', QPRO3: 'QPRO3', QPRO4: 'QPRO4', QPRO6: 'QPRO6', QPRO8: 'QPRO8', QPRO10: 'QPRO10', WS1_MY: 'WS1 MY', WS1_SG: 'WS1 SG' };

function formatCell(code) {
  const p = probeByCode.get(code);
  if (!p) return code; // fallback: just the code
  const lines = [];
  const issues = mismatchesByCode.get(code) || new Set();
  for (const bo of BO_ORDER) {
    const r = p[bo];
    if (!r?.present) continue;
    const marker = issues.has(bo) ? ' ✗' : '';
    lines.push(`${BO_LABEL[bo]}: ${r.code}${marker}`);
  }
  return lines.join('\n');
}

// Build batch
const data = [];
const plan = [];
for (const tab of Object.keys(cellMap)) {
  for (const cell of cellMap[tab]) {
    const value = formatCell(cell.code);
    data.push({ range: a1Range(tab, `${cell.col}${cell.row}`), values: [[value]] });
    plan.push({ tab, cell: `${cell.col}${cell.row}`, code: cell.code, lines: value.split('\n').length });
  }
}

console.log(`Tab: Sheet1 + Sheet 2`);
console.log(`Cells to write: ${data.length}`);
console.log(`Mode: ${commit ? 'LIVE (--commit)' : 'DRY-RUN'}`);
console.log(`\nPreview (first 3):`);
plan.slice(0, 3).forEach(p => console.log(`  ${p.tab}!${p.cell} (${p.code}): ${p.lines} lines`));
console.log(`\nSample full cell content:\n${data[0].values[0][0]}`);

if (!commit) {
  console.log('\nDRY-RUN — pass --commit to send.');
  process.exit(0);
}

const t0 = Date.now();
const client = await getSheetsClient();
const res = await client.sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: SHEET_ID,
  requestBody: { valueInputOption: 'USER_ENTERED', data },
});
const dur = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n✓ batchUpdate completed in ${dur}s`);
console.log(`  totalUpdatedCells: ${res.data.totalUpdatedCells}`);
console.log(`  totalUpdatedRows:  ${res.data.totalUpdatedRows}`);
