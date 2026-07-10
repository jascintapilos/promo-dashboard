#!/usr/bin/env node
// One-shot fix: link message_template_id=1288 on QP2 promo 1363 (P034-r35 QP2C).
// The EXTEND pass during the original save left message_template_id=0.
// The canary's idempotency check now exits before reaching the PUT, so
// this script bypasses the idempotency guard and directly applies the fix.
//
// Usage:
//   node bin/_archive/fix-qp2c-mt-link-p034.mjs           # dry run
//   node bin/_archive/fix-qp2c-mt-link-p034.mjs --commit  # live fix

import { loadAllRequests, resolveDuplicates } from '../../src/planner.js';
import { loadBoCodeIndex, fetchBoCodeAsRecord } from '../../src/bo-cache.js';
import { getSite } from '../../src/sites.js';
import { BRAND_TO_SITE } from '../../src/ingest.js';
import {
  updatePromotion,
  readDialogForPreservation,
  findPromotionByCode,
} from '../../src/api-client.js';
import { buildApiPlan } from '../../src/api-mapper-qp2.js';

const COMMIT = process.argv.includes('--commit');
const HANDLE   = 'P034-r35';
const BRAND    = 'QP2C';
const PROMO_ID = 1363;
const TEMPLATE_ID = 1288;
const PROMO_CODE  = 'WHALE_CRM_PROBE_20PCT_100_FTD_LOSE_4';

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`fix-qp2c-mt-link — ${COMMIT ? 'LIVE (--commit)' : 'DRY RUN'}`);
console.log(`  promo_id=${PROMO_ID}  template_id=${TEMPLATE_ID}  brand=${BRAND}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const { byHandle, byCode } = await loadAllRequests();
const request = byHandle.get(HANDLE);
if (!request) throw new Error(`handle "${HANDLE}" not found in captures/requests/`);

const bo = await loadBoCodeIndex();
const resolved = await resolveDuplicates(request, byCode, {
  boIndex: bo.byCode,
  boFetcher: fetchBoCodeAsRecord,
});

const siteId = BRAND_TO_SITE[BRAND]?.siteId || 'qp2';
const site = getSite(siteId);

console.log('\n▶ Building QP2C plan (resolves category IDs from live BO)...');
const plan = await buildApiPlan(resolved, { brand: BRAND, site });

console.log('▶ Reading current dialog linkage (for preservation)...');
const dialog = await readDialogForPreservation(site, PROMO_CODE);
console.log(`  dialog_popup_id: ${dialog?.id ?? 'NONE'}`);

const body = plan.buildUpdate(PROMO_ID, TEMPLATE_ID, dialog);
console.log(`\n  body.message_template_id: ${body.message_template_id}`);
console.log(`  body.dialog_popup_list keys: ${Object.keys(body.dialog_popup_list || {}).join(', ') || '(empty)'}`);

if (!COMMIT) {
  console.log('\nDry run complete. Add --commit to apply the fix.');
  process.exit(0);
}

console.log('\n▶ Applying PUT /api/bo/promotion/1363 ...');
const result = await updatePromotion(site, PROMO_ID, body);
console.log(`  success: ${result?.success}`);
console.log(`  message: ${JSON.stringify(result?.message)}`);

console.log('\n▶ Verifying — reading listing row...');
const listing = await findPromotionByCode(site, PROMO_CODE);
const row = (listing?.data?.rows || []).find((r) => r.code === PROMO_CODE);
const afterMT = row?.message_template_id;
const afterDialog = (row?.dialog_popup_list || []).length;
console.log(`  message_template_id after PUT: ${afterMT}`);
console.log(`  dialog_popup_list entries: ${afterDialog}`);

if (afterMT === TEMPLATE_ID) {
  console.log('\n✓ MT link fixed successfully.');
} else {
  console.error(`\n✗ MT link still wrong — expected ${TEMPLATE_ID}, got ${afterMT}`);
  process.exit(1);
}
