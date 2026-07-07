#!/usr/bin/env node
// Persist one bot QC verdict (Triage / Pre-QC / Sentinel / skip) into the
// 'QC Results Log' tab — the piece of the QC pipeline that currently gets
// discarded once a session ends. See docs/promo-monitoring-system-proposal.md
// (Phase 1) for the design. Thin CLI over src/qc-results-log.js — the same
// module bin/check-structural-health.mjs uses for bulk writes, so single
// calls and bulk sweeps compute Final Bot Verdict identically.
//
// Keyed by (Promo Code, Brand) — NOT Handle. A promo code is the identifier
// that exists for every live BO record, including the pre-existing backlog
// created before this pipeline existed; a Handle (P###) only exists for
// codes created through the canary flow. Handle is stored as an optional
// info column, blank for backlog/manually-created codes.
//
// Usage (creation-time gates — Handle known):
//   node bin/log-qc-result.mjs --code=REL_30PCT_3X --brand=QPRO5 --handle=P067 --stage=triage --verdict=READY [--commit]
//   node bin/log-qc-result.mjs --code=REL_30PCT_3X --brand=QPRO5 --handle=P067 --stage=pre-qc --verdict=PASS  [--reason="..."] [--commit]
//   node bin/log-qc-result.mjs --code=REL_30PCT_3X --brand=QPRO5 --handle=P067 --stage=skip [--commit]
//
// Usage (Sentinel — creation-time OR scheduled sweep, Handle optional):
//   node bin/log-qc-result.mjs --code=REL_30PCT_3X --brand=QPRO5 --handle=P067 --stage=sentinel --verdict=PASS \
//     --trigger=manual --depth=full [--commit]
//   node bin/log-qc-result.mjs --code=FIFA2022_42 --brand=WS2 --stage=sentinel --verdict=WARNING \
//     --trigger=weekly-sweep --depth=structural --reason="category default missing" [--commit]
//
// Dry-run is the default (prints the row it would write); --commit to persist.

import { parseArgs } from './_args.js';
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';
import { COL, VALID_VERDICT, VALID_TRIGGER, VALID_DEPTH, upsertRows } from '../src/qc-results-log.js';

const { flags } = parseArgs(process.argv.slice(2));
const code = flags.code;
const brand = flags.brand;
const handle = flags.handle || '';
const stage = flags.stage;
const verdict = flags.verdict ? String(flags.verdict).toUpperCase() : null;
const trigger = flags.trigger || 'manual';
const depth = flags.depth || 'full';
const reason = flags.reason || '';
const commit = flags.commit === true;

if (!code || !brand || !stage) {
  console.error('usage: log-qc-result.mjs --code=<PROMO_CODE> --brand=<BRAND> --stage=triage|pre-qc|sentinel|skip [--handle=<P###>] [--verdict=<V>] [--trigger=manual|post-creation|weekly-sweep] [--depth=full|structural] [--reason="..."] [--commit]');
  process.exit(2);
}
if (stage !== 'skip' && !VALID_VERDICT[stage]) {
  console.error(`--stage must be one of: triage, pre-qc, sentinel, skip`);
  process.exit(2);
}
if (stage !== 'skip') {
  if (!verdict) { console.error(`--stage=${stage} requires --verdict=<${VALID_VERDICT[stage].join('|')}>`); process.exit(2); }
  if (!VALID_VERDICT[stage].includes(verdict)) {
    console.error(`--verdict=${verdict} invalid for --stage=${stage}. Valid: ${VALID_VERDICT[stage].join(', ')}`);
    process.exit(2);
  }
  if (verdict !== VALID_VERDICT[stage][0] && !reason) {
    console.log(`⚠ --verdict=${verdict} on ${stage} with no --reason — recommended so "Flagged Reason" isn't blank for a non-clean verdict.`);
  }
}
if (stage === 'sentinel') {
  if (!VALID_TRIGGER.includes(trigger)) { console.error(`--trigger must be one of: ${VALID_TRIGGER.join(', ')}`); process.exit(2); }
  if (!VALID_DEPTH.includes(depth)) { console.error(`--depth must be one of: ${VALID_DEPTH.join(', ')}`); process.exit(2); }
  if (depth === 'structural' && trigger === 'manual') {
    console.log(`⚠ --depth=structural with --trigger=manual is unusual — structural (no-bundle) checks are normally automated sweep output, not a manual /deep-qc run.`);
  }
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`QC RESULTS LOG — code=${code} brand=${brand}  (stage=${stage}${verdict ? `, verdict=${verdict}` : ''}${stage === 'sentinel' ? `, trigger=${trigger}, depth=${depth}` : ''})`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const { sheets } = await getSheetsClient();
const OPS_ID = getOpsSheetId();

const entry = { code, brand, handle, stage, verdict, trigger, depth, reason };
const { results, wouldCommit, committed } = await upsertRows(sheets, OPS_ID, [entry], { commit });
const { row, action } = results[0];

console.log(`  Handle:              ${row[COL['Handle']] || '(none — no captured request; backlog/manual entry)'}`);
console.log(`  Region:              ${row[COL['Region']] || '(unknown)'}`);
console.log(`  Bonus Type:          ${row[COL['Bonus Type']] || '(unknown)'}`);
console.log(`  Triage / Pre-QC / Sentinel:  ${row[COL['Triage Verdict']] || '—'} / ${row[COL['Pre-QC Verdict']] || '—'} / ${row[COL['Sentinel Verdict']] || '—'}`);
if (row[COL['Check Trigger']]) console.log(`  Last Sentinel check: ${row[COL['Check Trigger']]} / ${row[COL['Check Depth']]}`);
console.log(`  Final Bot Verdict:   ${row[COL['Final Bot Verdict']]}`);
if (row[COL['Flagged Reason']]) console.log(`  Flagged Reason:      ${row[COL['Flagged Reason']]}`);
console.log(`  Action:              ${action === 'update' ? 'UPDATE existing row' : 'APPEND new row'}`);
console.log('');

if (!commit) {
  console.log('Dry-run only. Re-run with --commit to write.');
  process.exit(0);
}

console.log(`✓ Committed (${committed.updateCount} update, ${committed.appendCount} append)`);
console.log('');
console.log('Done.');
