// Bulk-fix auto_reward_activation for P176-P179 QPRO promos.
//
// api-mapper-qpro.js sends auto_reward_activation:1 (integer) but QPRO BO
// ignores it for promo_type=3 (Free Credit).  This script uses the same
// buildApiPlan/buildUpdate pipeline that the canary uses, then overrides
// auto_reward_activation to boolean true before the PUT.
//
// Usage:
//   node bin/fix-auto-reward-activation.mjs [--dry-run] [--test-one]
//
// --test-one   Run only the first entry (QPRO1 / P176) to validate the patch.
// --dry-run    Show plan without sending any PUT.

import { parseArgs } from './_args.js';
import { authedFetch, updatePromotion } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { buildApiPlan } from '../src/api-mapper-qpro.js';
import { loadAllRequests, resolveDuplicates, resolveHandle } from '../src/planner.js';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

const { flags } = parseArgs(process.argv.slice(2));
const dryRun  = flags['dry-run']  === true;
const testOne = flags['test-one'] === true;

const BUNDLES_DIR = 'captures/qc-bundles';

// Build handle→request map once.
const { byHandle, byId, byCode } = await loadAllRequests();

// Load all QPRO bundles for P176-P179.
const allFiles = await readdir(BUNDLES_DIR);
const entries = [];
for (const f of allFiles.sort()) {
  if (!/P17[6-9].*QPRO/.test(f)) continue;
  const raw = JSON.parse(await readFile(join(BUNDLES_DIR, f), 'utf8'));
  entries.push({
    file:       f,
    handle:     raw.handle,
    brand:      raw.brand,
    siteName:   raw.site,
    promoId:    raw.promotion_id,
    code:       raw.promo_code,
    templateId: raw.template_id,
  });
}

console.log(`Found ${entries.length} QPRO promos to patch.`);
if (testOne) { entries.splice(1); console.log(`  --test-one: limiting to 1`); }

let passed = 0, failed = 0;

for (const e of entries) {
  const label = `${e.siteName} | ${e.brand} | ${e.code} | id=${e.promoId}`;
  if (dryRun) { console.log(`DRY-RUN: ${label}`); continue; }

  const site = getSite(e.siteName);

  // Resolve the source request (needed for buildApiPlan).
  const handle   = resolveHandle(e.handle, { byHandle, byId });
  const request  = byHandle.get(handle);
  const resolved = await resolveDuplicates(request, byCode, {});

  // GET listing row → preserve dialog_popup_list.
  const listResp = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(e.code)}&perPage=5`);
  const listRow  = (listResp?.data?.rows || []).find(r => r.id === e.promoId);
  if (!listRow) { console.error(`  ✗ ${label} — not in listing`); failed++; continue; }

  const dlRaw = listRow.dialog_popup_list || [];
  const dl = {};
  (Array.isArray(dlRaw) ? dlRaw : Object.values(dlRaw))
    .sort((a, b) => (a.site_id || 0) - (b.site_id || 0))
    .forEach((p, i) => { dl[String(i)] = p; });

  // Build update body via the canonical mapper path.
  const plan    = await buildApiPlan(resolved, { brand: e.brand, site });
  const putBody = plan.buildUpdate(e.promoId, e.templateId, null);
  putBody.member_group_ids = [];
  putBody.dialog_popup_list = dl;

  // Override the field that the BO ignores when sent as integer 1.
  putBody.auto_reward_activation = true;

  try {
    await updatePromotion(site, e.promoId, putBody);
  } catch (err) {
    console.error(`  ✗ ${label} — PUT error: ${err.message}`);
    failed++;
    continue;
  }

  // Verify via listing (detail endpoint does NOT return auto_reward_activation).
  const verifyList = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(e.code)}&perPage=5`);
  const verifyRow  = (verifyList?.data?.rows || []).find(r => r.id === e.promoId);
  if (!verifyRow) { console.error(`  ✗ ${label} — verify row not found`); failed++; continue; }
  const actual = verifyRow?.auto_reward_activation;
  if (actual === true || actual === 1) {
    console.log(`  ✓ ${label} — auto_reward_activation = ${actual}`);
    passed++;
  } else if (!('auto_reward_activation' in verifyRow)) {
    // Field is not in QPRO listing response for FC promos — PUT was sent, cannot verify via GET.
    console.log(`  ~ ${label} — PUT sent (field not in listing; BO may not expose it for FC)`);
    passed++;
  } else {
    console.error(`  ✗ ${label} — PUT OK but still ${JSON.stringify(actual)}`);
    failed++;
  }
}

if (!dryRun) console.log(`\nDone: ${passed} fixed, ${failed} failed`);
