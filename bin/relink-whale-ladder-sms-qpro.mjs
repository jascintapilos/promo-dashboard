#!/usr/bin/env node
// Re-link existing SMS MTs to QPRO promotions for the Whale-Probe Ladder campaign.
// Finds each SMS MT by name on the QPRO site, then PUTs message_template_sms_id.
//
// Usage:
//   node bin/relink-whale-ladder-sms-qpro.mjs          # dry-run
//   node bin/relink-whale-ladder-sms-qpro.mjs --commit  # live write

import { parseArgs } from './_args.js';
import { authedFetch, updatePromotion, getPopupDetail } from '../src/api-client.js';
import { buildApiPlan } from '../src/api-mapper-qpro.js';
import { loadAllRequests, resolveDuplicates, resolveHandle } from '../src/planner.js';
import { getSite } from '../src/sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const COMMIT = flags.commit === true;
if (!COMMIT) console.log('[DRY RUN] Pass --commit to execute\n');

const QPRO_SITES = [
  'qpro1','qpro2','qpro3','qpro4','qpro5','qpro6',
  'qpro7','qpro8','qpro9','qpro10','qpro15','qpro16',
];

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

const { byHandle, byCode } = await loadAllRequests();
let totalOk = 0, totalSkip = 0, totalErr = 0;

for (const siteId of QPRO_SITES) {
  const site  = getSite(siteId);
  const brand = siteId.toUpperCase();
  console.log(`\n══ ${brand} ══`);

  // Fetch SMS MT listing once per site
  const mtListRes = await authedFetch(site, '/api/bo/messagetemplate?page=1&perPage=500');
  const mtRows = mtListRes?.data?.rows || mtListRes?.rows || [];
  const smsMtByName = {};
  for (const row of (Array.isArray(mtRows) ? mtRows : Object.values(mtRows))) {
    if (row?.name?.startsWith('SMS WHALE_CRM_PROBE_')) {
      smsMtByName[row.name] = row.id;
    }
  }

  for (const promo of PROMOS) {
    const mtName = `SMS ${promo.code}`;
    const mtId   = smsMtByName[mtName];
    process.stdout.write(`  ${promo.code.slice(16)}: `);

    if (!mtId) {
      console.log(`✗ SMS MT not found`);
      totalErr++;
      continue;
    }

    // Check current state
    const listRes = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(promo.code)}&perPage=10`);
    const listRow = (listRes?.data?.rows || []).find((r) => r.code === promo.code);
    if (!listRow) {
      console.log(`✗ promo not found`);
      totalErr++;
      continue;
    }

    const currentSmsId = listRow.message_template_sms_id;
    if (Number(currentSmsId) === mtId) {
      console.log(`already linked (mt=${mtId})`);
      totalSkip++;
      continue;
    }

    if (!COMMIT) {
      console.log(`[DRY RUN] mt=${mtId} (currently ${currentSmsId || 0})`);
      continue;
    }

    try {
      const promoId    = listRow.id;
      const templateId = listRow.message_template_id || 0;

      // Preserve existing dialog popup
      let existingPopup = null;
      const popupEntry = Array.isArray(listRow.dialog_popup_list) && listRow.dialog_popup_list[0];
      if (popupEntry?.popup_id) {
        const popup = await getPopupDetail(site, popupEntry.popup_id);
        if (popup?.id) existingPopup = popup;
      }

      const handle   = resolveHandle(promo.handle, { byHandle, byId: new Map(), byCode });
      const request  = byHandle.get(handle);
      const resolved = await resolveDuplicates(request, byCode, {});
      const plan     = await buildApiPlan(resolved, { brand, site });
      const putBody  = plan.buildUpdate(promoId, templateId, existingPopup);
      putBody.message_template_sms_id = mtId;

      await updatePromotion(site, promoId, putBody);

      // Verify
      const vRes  = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(promo.code)}&perPage=10`);
      const vRow  = (vRes?.data?.rows || []).find((r) => r.id === promoId);
      const linked = vRow?.message_template_sms_id;
      if (Number(linked) === mtId) {
        console.log(`✓ linked (mt=${mtId})`);
        totalOk++;
      } else {
        console.log(`⚠ verify failed: got ${linked}`);
        totalErr++;
      }
    } catch (e) {
      console.log(`✗ ${e.message.slice(0, 80)}`);
      totalErr++;
    }
  }
}

console.log(`\n── Summary ──`);
if (!COMMIT) {
  console.log(`[DRY RUN] complete`);
} else {
  console.log(`✓ Linked: ${totalOk}  = Already set: ${totalSkip}  ✗ Errors: ${totalErr}`);
}
