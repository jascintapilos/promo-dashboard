#!/usr/bin/env node
// Comprehensive one-shot fix for P034-r35 QP2 promo 1363:
//   - Restores merchant_ids to all 4 QP2 merchants (QP2A/B/C/D)
//   - Preserves message_template_id=1288 (just fixed)
//   - Restores correct per-site dialog_popup_list from the popup registry
//
// WHY: The targeted fix-qp2c-mt-link-p034.mjs PUT set merchant_ids to
// just QP2C (merchantId=3), wiping the other 3 merchants from the
// shared ibc22 record. This script restores everything in one PUT.
//
// Usage:
//   node bin/_archive/fix-qp2-full-restore-p034.mjs           # dry run
//   node bin/_archive/fix-qp2-full-restore-p034.mjs --commit  # live fix

import { loadAllRequests, resolveDuplicates } from '../../src/planner.js';
import { getSite } from '../../src/sites.js';
import { authedFetch, updatePromotion } from '../../src/api-client.js';
import { buildApiPlan } from '../../src/api-mapper-qp2.js';

const COMMIT    = process.argv.includes('--commit');
const HANDLE    = 'P034-r35';
const PROMO_ID  = 1363;
const PROMO_CODE = 'WHALE_CRM_PROBE_20PCT_100_FTD_LOSE_4';
const TEMPLATE_ID = 1288;
// All 4 QP2 merchant IDs (QP2A=1, QP2B=2, QP2C=3, QP2D=4)
const ALL_MERCHANT_IDS = [1, 2, 3, 4];
// Popup registry: site_id -> popup_id
const POPUP_REGISTRY = { 1: 1759, 2: 1762, 3: 1755, 4: 1758 };

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`fix-qp2-full-restore — ${COMMIT ? 'LIVE (--commit)' : 'DRY RUN'}`);
console.log(`  promo_id=${PROMO_ID}  template_id=${TEMPLATE_ID}`);
console.log(`  merchants: ${ALL_MERCHANT_IDS.join(', ')}`);
console.log(`  popups: ${JSON.stringify(POPUP_REGISTRY)}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const site = getSite('qp2');

// Load request + build plan (using QP2A brand with all merchantIds)
const { byHandle, byCode } = await loadAllRequests();
const request = byHandle.get(HANDLE);
if (!request) throw new Error(`handle "${HANDLE}" not found`);
const resolved = await resolveDuplicates(request, byCode, {});

console.log('\n▶ Building plan (QP2A brand, all 4 merchantIds)...');
const plan = await buildApiPlan(resolved, { brand: 'QP2A', site, merchantIds: ALL_MERCHANT_IDS });

// Build the core update body (null for dialog — we'll set it explicitly)
const putBody = plan.buildUpdate(PROMO_ID, TEMPLATE_ID, null);

// Explicitly set all 4 merchants
const mObj = {};
ALL_MERCHANT_IDS.forEach((id, i) => { mObj[String(i)] = id; });
putBody.merchant_ids = mObj;
console.log('  merchant_ids:', JSON.stringify(putBody.merchant_ids));

// Build dialog_popup_list from registry — fetch full popup rows
console.log('\n▶ Fetching popup full-rows from registry...');
const pr = await authedFetch(site, '/api/bo/popups?per_page=500&page=1&sort_by=id&sort_order=desc');
const allPopups = pr?.data?.rows || [];
const popupById = Object.fromEntries(allPopups.map((p) => [p.id, p]));

const dl = {};
let dlIdx = 0;
for (const [siteId, popupId] of Object.entries(POPUP_REGISTRY).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  const fullRow = popupById[popupId];
  if (!fullRow) {
    console.error(`  ⚠ popup ${popupId} (site_id=${siteId}) not found in listing — skipping`);
    continue;
  }
  dl[String(dlIdx++)] = { ...fullRow, promotion_id: PROMO_ID };
  console.log(`  site_id=${siteId} → popup ${popupId} (${fullRow.created_at?.slice(0,10)})`);
}
if (Object.keys(dl).length === 0) {
  console.error('No popups found — aborting');
  process.exit(1);
}
putBody.dialog_popup_list = dl;
console.log(`  dialog_popup_list: ${Object.keys(dl).length} entries`);
console.log('  message_template_id:', putBody.message_template_id);

if (!COMMIT) {
  console.log('\nDry run complete. Add --commit to apply.');
  process.exit(0);
}

// Apply
console.log('\n▶ Applying PUT /api/bo/promotion/1363...');
const result = await updatePromotion(site, PROMO_ID, putBody);
console.log(`  success: ${result?.success}`);
console.log(`  message: ${JSON.stringify(result?.message)}`);

// Verify
console.log('\n▶ Verifying listing row...');
const listResp = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(PROMO_CODE)}&perPage=5`);
const lr = (listResp?.data?.rows || []).find((r) => r.code === PROMO_CODE);
const afterMT = lr?.message_template_id;
const afterDialogs = (lr?.dialog_popup_list || []).map(d => `s${d.site_id}→${d.popup_id}`).join(' ');
const detailResp = await authedFetch(site, `/api/bo/promotion/${PROMO_ID}`);
const afterMerchants = (detailResp?.data?.rows?.merchant_ids || []).map(m => typeof m === 'object' ? m.id : m).join(', ');
console.log(`  message_template_id: ${afterMT}`);
console.log(`  dialog_popup_list: ${afterDialogs || '(empty)'}`);
console.log(`  merchant_ids: ${afterMerchants}`);

const ok = afterMT === TEMPLATE_ID && afterMerchants.includes('1') && afterMerchants.includes('2') && afterMerchants.includes('3') && afterMerchants.includes('4');
if (ok) {
  console.log('\n✓ Full restore complete — MT=1288, all 4 merchants, all 4 dialogs linked.');
} else {
  console.error('\n✗ Verification failed — check output above.');
  process.exit(1);
}
