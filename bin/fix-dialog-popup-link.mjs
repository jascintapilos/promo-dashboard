// Bulk-fix dialog popup linkage for P176-P179 QPRO promos.
//
// Sentinel found that all QPRO brands have the wrong popup linked to each
// promotion — the automation created the correct popup (dialog_popup_id in
// bundle) but the promotion's dialog_popup_list still points to a stale popup.
//
// This script reads each QPRO bundle, compares dialog_popup_id against the
// live dialog_popup_list, and re-links the correct popup via PUT.
//
// Usage:
//   node bin/fix-dialog-popup-link.mjs [--dry-run] [--test-one]
//
// --test-one   Run only the first mismatched entry to validate the fix.
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

const { byHandle, byId, byCode } = await loadAllRequests();

// Load all QPRO bundles for P176-P179 that have a dialog_popup_id.
const allFiles = await readdir(BUNDLES_DIR);
const entries = [];
for (const f of allFiles.sort()) {
  if (!/P17[6-9].*QPRO/.test(f)) continue;
  const raw = JSON.parse(await readFile(join(BUNDLES_DIR, f), 'utf8'));
  if (!raw.dialog_popup_id) {
    console.log(`  skip ${f} — no dialog_popup_id in bundle`);
    continue;
  }
  // Check live dialog_popup_list from bundle snapshot.
  const liveList = raw.live_state?.list_row?.dialog_popup_list || [];
  const linkedIds = (Array.isArray(liveList) ? liveList : Object.values(liveList))
    .map(p => p.popup_id);
  const correctId = raw.dialog_popup_id;
  const isMislinked = !linkedIds.includes(correctId);

  entries.push({
    file:        f,
    handle:      raw.handle,
    brand:       raw.brand,
    siteName:    raw.site,
    promoId:     raw.promotion_id,
    templateId:  raw.template_id,
    code:        raw.promo_code,
    correctId,
    linkedIds,
    isMislinked,
  });
}

const broken = entries.filter(e => e.isMislinked);
const ok     = entries.filter(e => !e.isMislinked);

console.log(`Scanned ${entries.length} QPRO bundles.`);
console.log(`  ${ok.length} already correctly linked.`);
console.log(`  ${broken.length} need relinking.`);
if (testOne && broken.length) { broken.splice(1); console.log(`  --test-one: limiting to 1`); }

let passed = 0, failed = 0;

for (const e of broken) {
  const label = `${e.siteName} | ${e.brand} | ${e.code} | promo=${e.promoId} | link ${e.linkedIds.join(',')} → ${e.correctId}`;
  if (dryRun) { console.log(`DRY-RUN: ${label}`); continue; }

  const site = getSite(e.siteName);

  // Resolve source request (needed for buildApiPlan).
  const handle   = resolveHandle(e.handle, { byHandle, byId });
  const request  = byHandle.get(handle);
  const resolved = await resolveDuplicates(request, byCode, {});

  // GET listing row for current state.
  const listResp = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(e.code)}&perPage=5`);
  const listRow  = (listResp?.data?.rows || []).find(r => r.id === e.promoId);
  if (!listRow) { console.error(`  ✗ ${label} — not found in listing`); failed++; continue; }

  // Build PUT body via canonical mapper (avoids silent field wipe).
  const plan    = await buildApiPlan(resolved, { brand: e.brand, site });
  const putBody = plan.buildUpdate(e.promoId, e.templateId, null);
  putBody.member_group_ids = [];

  // Set corrected dialog_popup_list — replace with the correct popup.
  // QPRO junction records use id == popup_id; preserve promotion_id from live listing.
  const liveRaw = listRow.dialog_popup_list || [];
  const liveArr = Array.isArray(liveRaw) ? liveRaw : Object.values(liveRaw);
  const promotionId = (liveArr[0]?.promotion_id) ?? e.promoId;
  putBody.dialog_popup_list = {
    '0': { id: e.correctId, promotion_id: promotionId, popup_id: e.correctId },
  };

  // Re-assert auto_reward_activation=true as boolean (QPRO ignores integer 1).
  putBody.auto_reward_activation = true;

  try {
    await updatePromotion(site, e.promoId, putBody);
  } catch (err) {
    console.error(`  ✗ ${label} — PUT error: ${err.message}`);
    failed++;
    continue;
  }

  // Verify via fresh listing.
  const verifyResp = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(e.code)}&perPage=5`);
  const verifyRow  = (verifyResp?.data?.rows || []).find(r => r.id === e.promoId);
  const verifyList = verifyRow?.dialog_popup_list || [];
  const verifyIds  = (Array.isArray(verifyList) ? verifyList : Object.values(verifyList))
    .map(p => p.popup_id);

  if (verifyIds.includes(e.correctId)) {
    console.log(`  ✓ ${label} — now linked: ${verifyIds.join(',')}`);
    passed++;
  } else {
    console.error(`  ✗ ${label} — still showing: ${verifyIds.join(',')} (expected ${e.correctId})`);
    failed++;
  }
}

if (!dryRun) console.log(`\nDone: ${passed} fixed, ${failed} failed`);
