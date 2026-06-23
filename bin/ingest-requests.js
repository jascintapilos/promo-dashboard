#!/usr/bin/env node
// Ingest the Promo Code Request Details Template via the Sheets API.
//
//   node bin/ingest-requests.js                  # current-month tab (default)
//   node bin/ingest-requests.js --tab="Apr 2026" # specific tab
//   node bin/ingest-requests.js --qc-only        # only rows with status="QC Completed"
//   node bin/ingest-requests.js --summary-only   # don't write fixture files
//
// Reads rows directly from the live sheet (src/sheets-ingest.js → Sheets API).
// Auto-names empty `promo_code` / `promotion_name_*` cells via the namer
// (src/promo-namer.js). Writes one fixture per row to captures/requests/.
//
// Needs Sheets API credentials — see docs/SHEETS-API-SETUP.md.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from './_args.js';
import { ingestCurrentMonthFromSheet } from '../src/sheets-ingest.js';

const { flags } = parseArgs(process.argv.slice(2));
const onlyQc = flags['qc-only'] === true;
const summaryOnly = flags['summary-only'] === true;
const tabOverride = flags.tab;

const OUT_DIR = path.resolve('captures/requests');
if (!summaryOnly) mkdirSync(OUT_DIR, { recursive: true });

let records = [];
let tabName = '';

console.log('Ingest source: LIVE sheet (Sheets API)');
try {
  const result = await ingestCurrentMonthFromSheet({
    tabNameOverride: tabOverride,
    onlyQcCompleted: onlyQc,
  });
  records = result.records;
  tabName = result.tab;
  console.log(`Tab: ${tabName}  (${records.length} records, ${Object.keys(result.colMap).length} columns detected, ${result.sheetRowCount} sheet rows scanned)`);
  if (result.namerStats) {
    const s = result.namerStats;
    console.log(`Auto-namer: ${s.already_named} already named, ${s.derived} derived, ${s.override} operator-override, ${s.incomplete} incomplete, ${s.unsupported} unsupported`);
    if (s.deduped) console.log(`Dedup: ${s.deduped} auto-named codes patched with _MIN<amount> to break batch collisions`);
  }
  const required = ['status', 'request_number', 'brand', 'bonus_type', 'promo_code'];
  const missing = required.filter((r) => result.colMap[r] == null);
  if (missing.length > 0) {
    console.warn(`⚠ Missing required columns: ${missing.join(', ')}. Header row may have changed.`);
  }
} catch (e) {
  console.error('✗ Live-sheet ingest failed:');
  console.error(`  ${e.message.split('\n').join('\n  ')}`);
  process.exit(3);
}

// Persist per-request JSON.
const filesWritten = [];
if (!summaryOnly) {
  for (const r of records) {
    const f = path.join(OUT_DIR, `${r.handle}.json`);
    writeFileSync(f, JSON.stringify(r, null, 2) + '\n');
    filesWritten.push(f);
  }
}

// ── Summary ─────────────────────────────────────────────────────────────
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`INGEST SUMMARY — ${tabName}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  ${records.length} record(s) parsed (filter: ${onlyQc ? 'QC Completed only' : 'all rows'})`);
console.log(`  ${filesWritten.length} file(s) written to ${path.relative(process.cwd(), OUT_DIR)}/`);

// Gap rollup
const gapCounts = {};
const unknownBrands = new Map();
for (const r of records) {
  for (const g of r.gaps || []) {
    const key = g.split(':')[0];
    gapCounts[key] = (gapCounts[key] || 0) + 1;
    if (key === 'unknown_brand') {
      const brand = g.replace(/^unknown_brand:\s*/, '');
      unknownBrands.set(brand, (unknownBrands.get(brand) || 0) + 1);
    }
  }
}
if (Object.keys(gapCounts).length > 0) {
  console.log('');
  console.log('Gaps seen:');
  for (const [k, v] of Object.entries(gapCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(30)} ${v}`);
  }
  if (unknownBrands.size > 0) {
    console.log('');
    console.log('Unknown brands seen:');
    for (const [b, c] of unknownBrands) console.log(`  unknown_brand: ${b}  (×${c})`);
  }
}
