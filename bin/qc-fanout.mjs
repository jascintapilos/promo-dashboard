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
// With --refresh, re-fetches live BO state (list_row, detail, tnc) per brand
// and rewrites each bundle's live_state in place BEFORE emitting the plan.
// Auth stays in Node (api-client.js inherits the session-cache); the QC
// sub-agent remains read-only. Use --refresh when the bundle is more than a
// few minutes old or you need forensic verification.
//
// Usage:
//   node bin/qc-fanout.mjs P073-r1502
//   node bin/qc-fanout.mjs P073                      # auto-resolves bare P### → current-month handle
//   node bin/qc-fanout.mjs P073 --pretty
//   node bin/qc-fanout.mjs P073 --refresh            # re-fetch live BO state first
//   node bin/qc-fanout.mjs P073 --refresh --pretty
//
// Exit codes:
//   0 — bundles found and emitted (some refreshes may have warned non-fatally)
//   2 — handle not found / no bundles
//   3 — bundles corrupt
//   4 — refresh failed catastrophically (all brands errored)

import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from './_args.js';
import { loadAllRequests, resolveHandle } from '../src/planner.js';
import { getSite } from '../src/sites.js';
import { findPromotionByCode, getPromotionDetail, getPopupDetail } from '../src/api-client.js';
import { qcMtTncHyperlink } from '../src/qc-mt-tnc.js';

const { flags, positional } = parseArgs(process.argv.slice(2));
const userInput = positional[0];
if (!userInput) {
  console.error('usage: qc-fanout.mjs <handle|P###> [--pretty] [--refresh]');
  process.exit(2);
}
const pretty = flags.pretty === true;
const refresh = flags.refresh === true;

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

// ── Live BO re-fetch (Option B) ──────────────────────────────────────
// When --refresh is passed, re-call findPromotionByCode + getPromotionDetail
// + qcMtTncHyperlink for each bundle and rewrite the bundle's live_state
// block. All brands refreshed in parallel via Promise.all. Per-bundle
// failures are non-fatal (logged + skipped), only catastrophic all-fail
// produces exit code 4.
if (refresh) {
  console.error(`Refreshing live BO state for ${bundles.length} bundle(s)…`);
  const wrap = (p) => p.then((v) => ({ ok: true, value: v }), (e) => ({ ok: false, error: e.message }));
  const refreshResults = await Promise.all(bundles.map(async (b) => {
    if (!b.site) return { brand: b.brand, ok: false, error: 'bundle missing site' };
    try {
      const site = getSite(b.site);
      const platform = b.platform || (b.site.startsWith('ibc') ? 'qp2' : 'qpro');
      const [r1, r2, r3, r4] = await Promise.all([
        wrap(findPromotionByCode(site, b.promo_code)),
        b.promotion_id ? wrap(getPromotionDetail(site, b.promotion_id)) : Promise.resolve(null),
        b.template_id ? wrap(qcMtTncHyperlink(site, b.template_id, platform)) : Promise.resolve(null),
        b.dialog_popup_id ? wrap(getPopupDetail(site, b.dialog_popup_id)) : Promise.resolve(null),
      ]);
      b.live_state = {
        list_row: r1?.ok ? r1.value : null,
        detail:   r2?.ok ? r2.value : null,
        tnc:      r3?.ok ? r3.value : null,
        popup:    r4?.ok ? r4.value : null,
        refreshed_at: new Date().toISOString(),
      };
      // Rewrite bundle on disk (drop __file before serializing).
      const { __file, ...persistable } = b;
      await writeFile(b.__file, JSON.stringify(persistable, null, 2));
      return { brand: b.brand, ok: true };
    } catch (e) {
      return { brand: b.brand, ok: false, error: e.message };
    }
  }));
  const failed = refreshResults.filter((r) => !r.ok);
  for (const r of refreshResults) {
    if (r.ok) console.error(`  ✓ ${r.brand} refreshed`);
    else console.error(`  ✗ ${r.brand} refresh failed: ${r.error}`);
  }
  if (failed.length === bundles.length) {
    console.error(`All ${bundles.length} brand refreshes failed. Check BO session (creds may have expired).`);
    process.exit(4);
  }
  console.error('');
}

if (pretty) {
  console.log(`Deep-QC fan-out plan for ${handle}`);
  console.log(`  Bundles: ${bundles.length}${refresh ? '  (live-refreshed)' : ''}`);
  console.log('');
  for (const b of bundles) {
    console.log(`  ▸ ${b.brand} (${b.platform})  promo_id=${b.promotion_id}  template_id=${b.template_id ?? '—'}  dialog_id=${b.dialog_popup_id ?? '—'}`);
    const stateTime = b.live_state?.refreshed_at || b.saved_at;
    console.log(`      site=${b.site}   code=${b.promo_code}   state_at=${stateTime}`);
    console.log(`      bundle=${b.__file}`);
  }
  console.log('');
  console.log(`To run deep QC, invoke the /deep-qc skill with: ${handle}`);
} else {
  console.log(JSON.stringify({ handle, count: bundles.length, refreshed: refresh, bundles }, null, 2));
}
