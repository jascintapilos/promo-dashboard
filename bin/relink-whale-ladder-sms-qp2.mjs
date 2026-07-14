#!/usr/bin/env node
// Re-link existing SMS MTs to QP2 promotions for the Whale-Probe Ladder campaign.
// Use this when the SMS MT already exists but message_template_sms_id was wiped
// by a subsequent promotion PUT (e.g. relink-qp2-dialogs.mjs).
//
// Finds each SMS MT by its code (PROMOTIONS.SMS.<promo_code>), then PUTs the
// promotion with message_template_sms_id set, preserving all other fields.
//
// Usage:
//   node bin/relink-whale-ladder-sms-qp2.mjs          # dry-run
//   node bin/relink-whale-ladder-sms-qp2.mjs --commit  # live write

import { parseArgs } from './_args.js';
import { authedFetch, updatePromotion } from '../src/api-client.js';
import { buildApiPlan } from '../src/api-mapper-qp2.js';
import { loadAllRequests, resolveDuplicates, resolveHandle } from '../src/planner.js';
import { getSite } from '../src/sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const COMMIT = flags.commit === true;
if (!COMMIT) console.log('[DRY RUN] Pass --commit to execute\n');

const site = getSite('ibc22');

const PROMOS = [
  { handle: 'P065-r66', code: 'WHALE_CRM_PROBE_GOO50FS_10X_6K' },
  { handle: 'P066-r67', code: 'WHALE_CRM_PROBE_GOO60FS_12X' },
  { handle: 'P067-r68', code: 'WHALE_CRM_PROBE_GOO75FS_12X' },
  { handle: 'P068-r69', code: 'WHALE_CRM_PROBE_GOO100FS_12X' },
  { handle: 'P069-r70', code: 'WHALE_CRM_PROBE_DEP50PCT_3K_10X' },
  { handle: 'P070-r71', code: 'WHALE_CRM_PROBE_DEP50PCT_1500_12X' },
  { handle: 'P071-r72', code: 'WHALE_CRM_PROBE_DEP50PCT_750_12X' },
  { handle: 'P072-r73', code: 'WHALE_CRM_PROBE_DEP50PCT_500_12X' },
];

// Build SMS MT code → id map from the ibc22 message template listing
console.log('Loading SMS MT listing from ibc22...');
const mtListRes = await authedFetch(site, '/api/bo/messagetemplate?page=1&perPage=500');
const mtRows = mtListRes?.data?.rows || mtListRes?.rows || [];
const smsMtMap = {};   // code → id
for (const row of (Array.isArray(mtRows) ? mtRows : Object.values(mtRows))) {
  if (row?.code?.startsWith('PROMOTIONS.SMS.WHALE_CRM_PROBE_')) {
    smsMtMap[row.code] = row.id;
  }
}
console.log(`Found ${Object.keys(smsMtMap).length} WHALE SMS MTs\n`);

const { byHandle, byCode } = await loadAllRequests();
let ok = 0, err = 0;

for (const promo of PROMOS) {
  const smsKey = `PROMOTIONS.SMS.${promo.code}`;
  const mtId   = smsMtMap[smsKey];
  console.log(`── ${promo.code}`);

  if (!mtId) {
    console.log(`  ✗ SMS MT not found (code=${smsKey})`);
    err++;
    continue;
  }
  console.log(`  SMS MT id=${mtId}`);

  if (!COMMIT) {
    console.log(`  [DRY RUN] Would set message_template_sms_id=${mtId}`);
    continue;
  }

  try {
    // Read listing row to get promo id, existing MT id, merchant ids, dialog list
    const listRes = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(promo.code)}&perPage=10`);
    const listRow = (listRes?.data?.rows || []).find((r) => r.code === promo.code);
    if (!listRow) throw new Error(`promo ${promo.code} not found`);

    const promoId    = listRow.id;
    const templateId = listRow.message_template_id || 0;
    const merchantIds = (listRow.merchant_ids || []).map((m) => typeof m === 'object' ? m.id : m);

    // Build full PUT body via QP2 mapper
    const handle   = resolveHandle(promo.handle, { byHandle, byId: new Map(), byCode });
    const request  = byHandle.get(handle);
    const resolved = await resolveDuplicates(request, byCode, {});
    const plan     = await buildApiPlan(resolved, { brand: 'QP2A', site, merchantIds });
    const putBody  = plan.buildUpdate(promoId, templateId, null);

    // Preserve merchant_ids
    const mObj = {};
    merchantIds.forEach((id, i) => { mObj[String(i)] = id; });
    putBody.merchant_ids = mObj;

    // Preserve dialog_popup_list
    if (Array.isArray(listRow.dialog_popup_list) && listRow.dialog_popup_list.length) {
      const dl = {};
      listRow.dialog_popup_list.forEach((d, i) => { dl[String(i)] = d; });
      putBody.dialog_popup_list = dl;
    }

    // Set SMS MT id
    putBody.message_template_sms_id = mtId;

    await updatePromotion(site, promoId, putBody);

    // Verify
    const verifyRes = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(promo.code)}&perPage=10`);
    const vRow = (verifyRes?.data?.rows || []).find((r) => r.id === promoId);
    const linked = vRow?.message_template_sms_id;
    if (Number(linked) === mtId) {
      console.log(`  ✓ Linked  promo=${promoId}  sms_mt=${linked}`);
      ok++;
    } else {
      console.log(`  ⚠ Verify failed: expected ${mtId}, got ${linked}`);
      err++;
    }
  } catch (e) {
    console.error(`  ✗ ${e.message.slice(0, 120)}`);
    err++;
  }
}

console.log(`\n── Summary ──`);
if (!COMMIT) {
  console.log(`[DRY RUN] ${PROMOS.length} SMS MT links would be set`);
} else {
  console.log(`✓ Linked: ${ok}  ✗ Errors: ${err}`);
}
