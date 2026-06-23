#!/usr/bin/env node
// pre-qc-fanout — read plan bundles for a request and emit a fan-out plan
// for the /pre-qc skill to drive sub-agent review BEFORE the user commits.
//
// The canary runners (canary-api.js, canary-api-qp2.js) write one plan
// bundle per (handle, brand) on every dry-run, under
// captures/qc-plans/<handle>__<brand>.json. Each bundle contains the
// source request + the structured plan that would be POSTed if --commit
// were added. This script reads all matching bundles, validates them,
// and prints either:
//   - a JSON array (default, for skill consumption)
//   - a pretty plan (with --pretty, for human review)
//
// Usage:
//   node bin/pre-qc-fanout.mjs P073-r1502
//   node bin/pre-qc-fanout.mjs P073        # auto-resolves bare P### → current-month handle
//   node bin/pre-qc-fanout.mjs P073 --pretty
//
// Exit codes:
//   0 — bundles found and emitted
//   2 — handle not found / no plan bundles
//   3 — bundles corrupt

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from './_args.js';
import { loadAllRequests, resolveHandle } from '../src/planner.js';

const { flags, positional } = parseArgs(process.argv.slice(2));
const userInput = positional[0];
if (!userInput) {
  console.error('usage: pre-qc-fanout.mjs <handle|P###> [--pretty]');
  process.exit(2);
}
const pretty = flags.pretty === true;

const { byHandle, byId } = await loadAllRequests();
const handle = resolveHandle(userInput, { byHandle, byId });
if (!handle) {
  console.error(`request "${userInput}" not found in captures/requests/`);
  process.exit(2);
}
if (handle !== userInput) console.error(`(auto-resolved "${userInput}" → "${handle}")`);

const planDir = path.resolve('captures/qc-plans');
let entries;
try {
  entries = await readdir(planDir);
} catch (e) {
  console.error(`No qc-plans directory found (expected ${planDir}).`);
  console.error('Run a canary dry-run first (without --commit) — bundles are written automatically.');
  process.exit(2);
}

const prefix = `${handle}__`;
const matched = entries.filter((f) => f.startsWith(prefix) && f.endsWith('.json'));
if (matched.length === 0) {
  console.error(`No plan bundles found for handle "${handle}" in ${planDir}.`);
  console.error('Run a canary dry-run first.');
  process.exit(2);
}

const bundles = [];
for (const file of matched) {
  const fp = path.join(planDir, file);
  try {
    const text = await readFile(fp, 'utf-8');
    const obj = JSON.parse(text);
    if (!obj.handle || !obj.brand || !obj.promo_code || !obj.plan) {
      console.error(`Plan bundle ${file} missing required fields (handle/brand/promo_code/plan).`);
      process.exit(3);
    }
    bundles.push({ ...obj, __file: fp });
  } catch (e) {
    console.error(`Failed to read plan bundle ${file}: ${e.message}`);
    process.exit(3);
  }
}

bundles.sort((a, b) => a.brand.localeCompare(b.brand));

if (pretty) {
  console.log(`Pre-QC fan-out plan for ${handle}`);
  console.log(`  Bundles: ${bundles.length}`);
  console.log('');
  for (const b of bundles) {
    console.log(`  ▸ ${b.brand} (${b.platform})  code=${b.promo_code}  bonus=${b.bonus_type}${b.bonus_sub_type ? '/' + b.bonus_sub_type : ''}`);
    console.log(`      site=${b.site}   planned_at=${b.planned_at}`);
    console.log(`      bundle=${b.__file}`);
  }
  console.log('');
  console.log(`To run pre-QC, invoke the /pre-qc skill with: ${handle}`);
} else {
  console.log(JSON.stringify({ handle, count: bundles.length, bundles }, null, 2));
}
