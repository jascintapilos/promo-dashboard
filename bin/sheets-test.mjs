#!/usr/bin/env node
// Probe the Sheets API integration end-to-end. Use this once after the
// service account is set up and the spreadsheet is shared — it confirms
// auth, read, and write all work before wiring into the canary.
//
//   node bin/sheets-test.mjs                  # read-only: list tabs, dump column map
//   node bin/sheets-test.mjs --row=68         # also read a specific data row
//   node bin/sheets-test.mjs --write-test     # writes "SHEETS_API_OK <timestamp>"
//                                             # into a designated test cell, then
//                                             # erases it again (round-trip proof)
//
// On failure, the script prints actionable error messages pointing back at
// docs/SHEETS-API-SETUP.md.

import { parseArgs } from './_args.js';
import {
  getSheetsClient,
  getSpreadsheetId,
  listTabs,
  resolveCurrentMonthTab,
  readHeader,
  readRow,
  detectColumnMapFromHeader,
  writeCell,
  colIndexToLetter,
} from '../src/sheets-client.js';

const { flags } = parseArgs(process.argv.slice(2));
const readRowNum = flags.row ? Number(flags.row) : null;
const writeTest = flags['write-test'] === true || flags.writeTest === true;

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('SHEETS API PROBE');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

let client;
try {
  client = await getSheetsClient();
} catch (e) {
  console.error('✗ Auth failed:');
  console.error(`  ${e.message.split('\n').join('\n  ')}`);
  process.exit(2);
}
console.log(`✓ Auth OK`);
console.log(`  Spreadsheet: ${getSpreadsheetId()}`);
console.log(`  Mode:        ${client.mode || 'unknown'}`);
console.log(`  Account:     ${client.email || '(OAuth: tied to the user who completed consent)'}`);
console.log('');

// ── List tabs ───────────────────────────────────────────────────────────
let tabs;
try {
  tabs = await listTabs(client);
} catch (e) {
  console.error('✗ Reading spreadsheet metadata failed:');
  console.error(`  ${e.message.split('\n')[0]}`);
  if (/(403|permission|forbidden)/i.test(e.message)) {
    console.error('');
    console.error('  → The service account does not have access to this spreadsheet.');
    console.error(`  → In Google Sheets: Share → add ${client.email || 'the service account email'} as Editor.`);
  }
  process.exit(3);
}
console.log(`✓ ${tabs.length} tabs found:`);
for (const t of tabs.slice(0, 20)) console.log(`    ${t.name}`);
if (tabs.length > 20) console.log(`    … +${tabs.length - 20} more`);
console.log('');

// ── Resolve current-month tab ───────────────────────────────────────────
const tabName = await resolveCurrentMonthTab(client);
console.log(`✓ Current-month tab: "${tabName}"`);

// ── Read header + dump column map ───────────────────────────────────────
const header = await readHeader(client, tabName);
console.log(`✓ Header row has ${header.length} cells`);
const colMap = detectColumnMapFromHeader(header);
console.log('  Detected columns (field → col-letter [header-cell]):');
const fields = Object.keys(colMap).sort();
for (const f of fields) {
  const idx = colMap[f];
  const letter = colIndexToLetter(idx);
  const cell = String(header[idx] || '').slice(0, 50).replace(/\s+/g, ' ');
  console.log(`    ${f.padEnd(24)} → ${letter.padEnd(3)} [${cell}]`);
}
const missing = ['promo_code', 'promotion_name_en', 'promotion_name_zh_id'].filter((f) => colMap[f] == null);
if (missing.length) {
  console.log('');
  console.log(`  ⚠ The following critical columns were NOT auto-detected: ${missing.join(', ')}`);
  console.log('    Add a regex alias in src/ingest-xlsx.js → HEADER_ALIASES.');
}
console.log('');

// ── Optional: read a data row ───────────────────────────────────────────
if (readRowNum) {
  const cells = await readRow(client, tabName, readRowNum);
  console.log(`✓ Row ${readRowNum} read (${cells.length} cells):`);
  for (const f of fields) {
    const v = cells[colMap[f]];
    if (v == null || v === '') continue;
    console.log(`    ${f.padEnd(24)} = ${String(v).slice(0, 80)}`);
  }
  console.log('');
}

// ── Optional: write round-trip ──────────────────────────────────────────
if (writeTest) {
  // Pick a safe target one column past the detected header. The sheet has a
  // bounded grid (~35 cols on May 2026), so picking too far right errors
  // with "exceeds grid limits". We round-trip into that one cell and restore
  // the original value, so the operator never sees a change.
  const TEST_COL_IDX = header.length;       // one past last header cell
  const TEST_COL_LETTER = colIndexToLetter(TEST_COL_IDX);
  const TEST_ROW = 1;
  const stamp = `SHEETS_API_OK ${new Date().toISOString()}`;
  console.log(`▶ Write test → writing to ${tabName}!${TEST_COL_LETTER}${TEST_ROW}`);
  // Read existing value first so we can restore it.
  const before = await readRow(client, tabName, TEST_ROW);
  const original = before[TEST_COL_IDX] ?? '';
  try {
    await writeCell(client, tabName, TEST_ROW, TEST_COL_LETTER, stamp);
    console.log(`  ✓ Wrote: "${stamp}"`);
    await writeCell(client, tabName, TEST_ROW, TEST_COL_LETTER, original);
    console.log(`  ✓ Restored original value: "${original}"`);
    console.log('');
    console.log('✓ Round-trip write succeeded — the authenticated principal has Editor access.');
  } catch (e) {
    console.error(`  ✗ Write failed: ${e.message.split('\n')[0]}`);
    if (/(403|permission|forbidden|readonly)/i.test(e.message)) {
      console.error('');
      console.error('  → The service account has read-only access. Re-share with Editor permission.');
    }
    process.exit(4);
  }
}

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Probe complete.');
console.log('Next: node bin/sheets-writeback.mjs <handle> --field=<field> --value=<value>');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
