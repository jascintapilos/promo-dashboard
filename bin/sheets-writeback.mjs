#!/usr/bin/env node
// Write a value back to the Promo Code Request Details Template via the
// Sheets API. Standalone so it can be tested without involving the canary,
// and so the canary can shell out to it (or import the underlying module)
// once the auto-namer (open item B) lands.
//
// Usage:
//   # Write one explicit field on the current-month row for P067 (auto-resolves bare P###):
//   node bin/sheets-writeback.mjs P067 --field=promo_code --value=REL_30PCT_3X --commit
//
//   # Write three fields from a fixture in one batch:
//   node bin/sheets-writeback.mjs P067-r68 --from-fixture --commit
//
//   # Dry-run is the default (no --commit) — prints the cell + value but
//   # does not call the API.
//
// Field name is matched via the same HEADER_ALIASES map the XLSX ingest
// uses (src/ingest-xlsx.js). Sheet row comes from the handle's `-rN`
// suffix; that number is the original sheet row number (source_line).

import { parseArgs } from './_args.js';
import { loadAllRequests, resolveHandle } from '../src/planner.js';
import {
  getSheetsClient,
  resolveCurrentMonthTab,
  readHeader,
  detectColumnMapFromHeader,
  writeCell,
  writeFields,
  colIndexToLetter,
} from '../src/sheets-client.js';

const { flags, positional } = parseArgs(process.argv.slice(2));
const userInput = positional[0];
if (!userInput) {
  console.error('usage: sheets-writeback.mjs <handle|P###> [--field=<f> --value=<v> | --from-fixture] [--commit]');
  process.exit(2);
}
const commit = flags.commit === true;
const fromFixture = flags['from-fixture'] === true || flags.fromFixture === true;
const field = flags.field;
const value = flags.value;
const explicitCol = flags.col;  // optional A1 letter override (skips field lookup)
const explicitRow = flags.row ? Number(flags.row) : null;
const explicitTab = flags.tab || null;  // override current-month tab resolution

if (!fromFixture && !field && !explicitCol) {
  console.error('Pass either --from-fixture, or --field=<f> [--value=<v>], or --col=<letter> --value=<v>');
  process.exit(2);
}

// ── Resolve handle → record (for source_line + fromFixture values) ──────
const { byHandle, byId } = await loadAllRequests();
const handle = resolveHandle(userInput, { byHandle, byId });
if (!handle) {
  console.error(`request "${userInput}" not found in captures/requests/`);
  console.error('  Run: node bin/ingest-requests.js');
  process.exit(2);
}
if (handle !== userInput) console.log(`(auto-resolved "${userInput}" → "${handle}" — current-month row)`);
const record = byHandle.get(handle);
if (!record) {
  console.error(`handle "${handle}" not in byHandle map`);
  process.exit(2);
}
const sheetRow = explicitRow ?? record.source_line;
if (!sheetRow || !Number.isInteger(sheetRow)) {
  console.error(`record ${handle} has no source_line; pass --row=<N> explicitly`);
  process.exit(2);
}

// ── Auth + tab + column map ─────────────────────────────────────────────
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`SHEETS WRITE-BACK — ${handle}  (row ${sheetRow})`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

let client, tabName, header, colMap;
try {
  client = await getSheetsClient();
  tabName = explicitTab || await resolveCurrentMonthTab(client);
  header = await readHeader(client, tabName);
  colMap = detectColumnMapFromHeader(header);
} catch (e) {
  console.error('✗ Sheets API unavailable:');
  console.error(`  ${e.message.split('\n').join('\n  ')}`);
  console.error('');
  console.error('  Even a dry-run needs API access to confirm column positions on the live sheet.');
  process.exit(3);
}
console.log(`  Tab:      ${tabName}`);
console.log(`  Account:  ${client.email}`);
console.log(`  Mode:     ${commit ? 'LIVE (--commit)' : 'DRY-RUN'}`);
console.log('');

// ── Build the write set ─────────────────────────────────────────────────
let writeSet;  // { field|colLetter → value }
if (fromFixture) {
  writeSet = {};
  for (const f of ['promo_code', 'promotion_name_en', 'promotion_name_zh_id']) {
    const v = record[f];
    if (v == null || v === '') continue;
    if (colMap[f] == null) {
      console.log(`  ⚠ Field "${f}" not found in current sheet header — skipping`);
      continue;
    }
    writeSet[f] = v;
  }
  if (Object.keys(writeSet).length === 0) {
    console.log('Nothing to write — fixture has empty promo_code / promotion_name_* fields.');
    process.exit(0);
  }
} else if (explicitCol) {
  if (value == null) {
    console.error('--col requires --value=<v>');
    process.exit(2);
  }
  writeSet = { [`__col__${explicitCol}`]: value };
} else {
  if (value == null) {
    console.error(`--field=${field} requires --value=<v>`);
    process.exit(2);
  }
  if (colMap[field] == null) {
    console.error(`Field "${field}" not in current sheet header. Known fields:`);
    for (const f of Object.keys(colMap)) console.error(`    ${f}`);
    process.exit(2);
  }
  writeSet = { [field]: value };
}

// ── Preview ─────────────────────────────────────────────────────────────
console.log('Planned writes:');
for (const [key, v] of Object.entries(writeSet)) {
  let colLetter;
  if (key.startsWith('__col__')) {
    colLetter = key.slice('__col__'.length).toUpperCase();
  } else {
    colLetter = colIndexToLetter(colMap[key]);
  }
  const display = key.startsWith('__col__') ? `(col ${colLetter})` : `${key} (${colLetter})`;
  console.log(`    ${display.padEnd(40)} ${tabName}!${colLetter}${sheetRow} = ${JSON.stringify(v)}`);
}
console.log('');

if (!commit) {
  console.log('Dry-run only. Re-run with --commit to write.');
  process.exit(0);
}

// ── Commit ──────────────────────────────────────────────────────────────
try {
  // Use the batch path when writing 2+ named fields; otherwise single-cell.
  const fieldEntries = Object.entries(writeSet).filter(([k]) => !k.startsWith('__col__'));
  const colEntries = Object.entries(writeSet).filter(([k]) => k.startsWith('__col__'));

  if (fieldEntries.length > 0) {
    const valuesByField = Object.fromEntries(fieldEntries);
    const res = await writeFields(client, tabName, sheetRow, valuesByField, colMap);
    const updates = res.totalUpdatedCells ?? (res.skipped ? 0 : '?');
    console.log(`✓ Field write succeeded — ${updates} cells updated`);
  }
  for (const [key, v] of colEntries) {
    const colLetter = key.slice('__col__'.length).toUpperCase();
    await writeCell(client, tabName, sheetRow, colLetter, v);
    console.log(`✓ Cell ${tabName}!${colLetter}${sheetRow} written`);
  }
} catch (e) {
  console.error(`✗ Write failed: ${e.message.split('\n')[0]}`);
  process.exit(3);
}

console.log('');
console.log('Done.');
