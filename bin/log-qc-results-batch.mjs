#!/usr/bin/env node
// Batched version of log-qc-result.mjs — logs every brand from ONE QC gate
// (triage, pre-qc, or sentinel) in a single read + single write, instead of
// one CLI process per brand. Two reasons this exists rather than just
// running log-qc-result.mjs N times in parallel:
//
//   1. Speed: one Node startup + one sheet read + one batch write, instead
//      of N of each. Adds ~1-2s to a QC gate regardless of brand count.
//   2. Correctness: N parallel single-row writers each do their own
//      independent read-then-write against the same tab — two could both
//      see "row doesn't exist yet" and both append, creating duplicates.
//      One process, one read, one write avoids the race entirely.
//
// Usage:
//   node bin/log-qc-results-batch.mjs --input=<file.json> [--commit]
//   echo '[{...}]' | node bin/log-qc-results-batch.mjs [--commit]
//
// Input is a JSON array of entries, each shaped like a single
// log-qc-result.mjs call's flags:
//   [{ "code": "REL_30PCT_3X", "brand": "QPRO5", "handle": "P067",
//      "stage": "pre-qc", "verdict": "PASS", "reason": "" }, ...]

import { readFileSync } from 'node:fs';
import { parseArgs } from './_args.js';
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';
import { COL, VALID_VERDICT, VALID_TRIGGER, VALID_DEPTH, upsertRows } from '../src/qc-results-log.js';

const { flags } = parseArgs(process.argv.slice(2));
const commit = flags.commit === true;

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const raw = flags.input ? readFileSync(flags.input, 'utf8') : await readStdin();
let entries;
try { entries = JSON.parse(raw); } catch (e) {
  console.error(`Could not parse input as JSON: ${e.message}`);
  process.exit(2);
}
if (!Array.isArray(entries) || !entries.length) {
  console.error('Input must be a non-empty JSON array of entries.');
  process.exit(2);
}

// ── Validate every entry up front — fail the whole batch on any bad entry ──
for (const e of entries) {
  if (!e.code || !e.brand || !e.stage) {
    console.error(`Invalid entry (needs code, brand, stage): ${JSON.stringify(e)}`);
    process.exit(2);
  }
  if (e.stage !== 'skip') {
    if (!VALID_VERDICT[e.stage]) { console.error(`Invalid stage "${e.stage}" on ${e.brand}/${e.code}`); process.exit(2); }
    e.verdict = String(e.verdict || '').toUpperCase();
    if (!VALID_VERDICT[e.stage].includes(e.verdict)) {
      console.error(`Invalid verdict "${e.verdict}" for stage "${e.stage}" on ${e.brand}/${e.code}. Valid: ${VALID_VERDICT[e.stage].join(', ')}`);
      process.exit(2);
    }
  }
  if (e.stage === 'sentinel') {
    e.trigger = e.trigger || 'manual';
    e.depth = e.depth || 'full';
    if (!VALID_TRIGGER.includes(e.trigger)) { console.error(`Invalid trigger "${e.trigger}" on ${e.brand}/${e.code}`); process.exit(2); }
    if (!VALID_DEPTH.includes(e.depth)) { console.error(`Invalid depth "${e.depth}" on ${e.brand}/${e.code}`); process.exit(2); }
  }
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`QC RESULTS LOG (batch) — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const { sheets } = await getSheetsClient();
const OPS_ID = getOpsSheetId();

const { results, wouldCommit, committed } = await upsertRows(sheets, OPS_ID, entries, { commit });

for (const { entry, row, action } of results) {
  console.log(`  ${action === 'update' ? 'UPDATE' : 'APPEND'}  ${entry.brand} / ${entry.code}  →  Final: ${row[COL['Final Bot Verdict']]}`);
}
console.log('');

if (!commit) {
  console.log(`Dry-run only. Would ${wouldCommit.updateCount} update(s) + ${wouldCommit.appendCount} append(s). Re-run with --commit to write.`);
  process.exit(0);
}

console.log(`✓ Committed (${committed.updateCount} update, ${committed.appendCount} append)`);
console.log('');
console.log('Done.');
