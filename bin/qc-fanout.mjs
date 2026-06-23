#!/usr/bin/env node
// qc-fanout — read deep-QC bundles for a saved request and emit a fan-out
// plan for the /deep-qc skill to drive sub-agent verification.
//
// The canary runners (canary-api.js, canary-api-qp2.js) write one bundle
// per (handle, brand) save under captures/qc-bundles/<handle>__<brand>.json.
// This script reads all matching bundles, validates them, and prints either:
//   - a JSON array (default, for skill consumption)
//   - a pretty plan (with --pretty, for human review)
//
// Usage:
//   node bin/qc-fanout.mjs P073-r1502
//   node bin/qc-fanout.mjs P073        # auto-resolves bare P### → current-month handle
//   node bin/qc-fanout.mjs P073 --pretty
//
// Exit codes:
//   0 — bundles found and emitted
//   2 — handle not found / no bundles
//   3 — bundles corrupt

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from './_args.js';
import { loadAllRequests, resolveHandle } from '../src/planner.js';

const { flags, positional } = parseArgs(process.argv.slice(2));
const userInput = positional[0];
if (!userInput) {
  console.error('usage: qc-fanout.mjs <handle|P###> [--pretty]');
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

const bundleDir = path.resolve('captures/qc-bundles');
let entries;
try {
  entries = await readdir(bundleDir);
} catch (e) {
  console.error(`No qc-bundles directory found (expected ${bundleDir}).`);
  console.error('Run a canary save first — canary-api.js / canary-api-qp2.js write bundles automatically.');
  process.exit(2);
}

const prefix = `${handle}__`;
const matched = entries.filter((f) => f.startsWith(prefix) && f.endsWith('.json'));
if (matched.length === 0) {
  console.error(`No bundles found for handle "${handle}" in ${bundleDir}.`);
  console.error('Run a canary save first.');
  process.exit(2);
}

const bundles = [];
for (const file of matched) {
  const fp = path.join(bundleDir, file);
  try {
    const text = await readFile(fp, 'utf-8');
    const obj = JSON.parse(text);
    if (!obj.handle || !obj.brand || !obj.promo_code) {
      console.error(`Bundle ${file} missing required fields (handle/brand/promo_code).`);
      process.exit(3);
    }
    bundles.push({ ...obj, __file: fp });
  } catch (e) {
    console.error(`Failed to read bundle ${file}: ${e.message}`);
    process.exit(3);
  }
}

bundles.sort((a, b) => a.brand.localeCompare(b.brand));

if (pretty) {
  console.log(`Deep-QC fan-out plan for ${handle}`);
  console.log(`  Bundles: ${bundles.length}`);
  console.log('');
  for (const b of bundles) {
    console.log(`  ▸ ${b.brand} (${b.platform})  promo_id=${b.promotion_id}  template_id=${b.template_id ?? '—'}  dialog_id=${b.dialog_popup_id ?? '—'}`);
    console.log(`      site=${b.site}   code=${b.promo_code}   saved_at=${b.saved_at}`);
    console.log(`      bundle=${b.__file}`);
  }
  console.log('');
  console.log(`To run deep QC, invoke the /deep-qc skill with: ${handle}`);
} else {
  console.log(JSON.stringify({ handle, count: bundles.length, bundles }, null, 2));
}
