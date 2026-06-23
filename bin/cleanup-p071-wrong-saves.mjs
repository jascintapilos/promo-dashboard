#!/usr/bin/env node
// Cleanup for the bad P071 run that used the hand-edited fixture
// before the new "Add TEST to code" remark was ingested:
//   - QPRO6 id=402 (FT_REL_SLOTS_25PCT) → archive
//   - QPRO8 id=458 (FT_REL_SLOTS_25PCT) → archive
//   - ibc22 id=922 (FT_REL_SLOTS_25PCT, pre-existing operator promo) →
//     PUT to remove QP2D (merchant_id=4) from merchant_ids; restore
//     to pre-run state (IBC22 only).
//
// QPRO2 id=295 (operator's source) is NOT touched.

import fs from 'node:fs';
import { authedFetch, updatePromotion } from '../src/api-client.js';
import { buildApiPlan as buildQproPlan } from '../src/api-mapper-qpro.js';
import { buildApiPlan as buildQp2Plan, QP2_BRAND_TO_IDS } from '../src/api-mapper-qp2.js';
import { getSite } from '../src/sites.js';

const commit = process.argv.includes('--commit');
const resolved = JSON.parse(fs.readFileSync('captures/requests/P071-r72.json', 'utf8'));

async function archiveQpro(siteId, id) {
  const site = getSite(siteId);
  const brand = siteId.toUpperCase();
  const before = (await authedFetch(site, `/api/bo/promotion/${id}`)).data.rows;
  console.log(`${siteId} id=${id} code=${before.code} status=${before.status} → deactivating…`);
  if (!commit) { console.log('  (dry-run)'); return; }
  // Use the QPRO mapper's buildUpdate to construct a valid PUT body shape;
  // override status=0. The fixture in resolved has the right basics; just
  // ensure code matches.
  const fixtureCopy = { ...resolved, promo_code: before.code, promotion_name_en: before.name };
  const plan = await buildQproPlan(fixtureCopy, { brand, site });
  const putBody = plan.buildUpdate(id, before.message_template_id || 0, null);
  putBody.status = 0;
  await updatePromotion(site, id, putBody);
  try {
    await authedFetch(site, `/api/bo/promotion/${id}`, { method: 'DELETE' });
    console.log('  ✓ deactivated + archived');
  } catch (e) {
    console.log(`  ✓ deactivated (delete: ${(e.message||'').split('\n')[1]?.trim() || 'failed'})`);
  }
}

async function revertQp2Merchants(promoId, dropMerchantId) {
  const site = getSite('ibc22');
  const before = (await authedFetch(site, `/api/bo/promotion/${promoId}`)).data.rows;
  const currentIds = (before.merchant_ids || []).map((m) => m.id || m);
  if (!currentIds.includes(dropMerchantId)) {
    console.log(`ibc22 id=${promoId} — merchant ${dropMerchantId} not in [${currentIds.join(',')}]; nothing to do.`);
    return;
  }
  const newIds = currentIds.filter((id) => id !== dropMerchantId);
  console.log(`ibc22 id=${promoId} merchant_ids: [${currentIds.join(',')}] → [${newIds.join(',')}]`);
  if (!commit) { console.log('  (dry-run)'); return; }
  // Build a valid PUT body via QP2 mapper, then override merchant_ids + preserve template/popup.
  const fixtureCopy = { ...resolved, promo_code: before.code, promotion_name_en: before.name };
  const plan = await buildQp2Plan(fixtureCopy, { brand: 'QP2A', site, merchantIds: newIds });
  const putBody = plan.buildUpdate(promoId, before.message_template_id || 0, null);
  const merchantIdsObj = {};
  newIds.forEach((id, i) => { merchantIdsObj[String(i)] = id; });
  putBody.merchant_ids = merchantIdsObj;
  // Preserve existing dialog_popup_list from the list endpoint (full popup rows)
  const listResp = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(before.code)}&perPage=5`);
  const listRow = (listResp.data?.rows || []).find((x) => x.id === promoId);
  if (Array.isArray(listRow?.dialog_popup_list) && listRow.dialog_popup_list.length) {
    const popupListResp = await authedFetch(site, '/api/bo/popups?perPage=200&page=1&date_type=start_date&sort_by=id&sort_order=desc');
    const allPopups = popupListResp.data?.rows || [];
    const popupRows = listRow.dialog_popup_list.map((d) => allPopups.find((p) => p.id === d.popup_id)).filter(Boolean);
    if (popupRows.length) {
      const dl = {};
      popupRows.forEach((p, i) => { dl[String(i)] = { ...p, promotion_id: promoId }; });
      putBody.dialog_popup_list = dl;
    }
  }
  await updatePromotion(site, promoId, putBody);
  const verify = (await authedFetch(site, `/api/bo/promotion/${promoId}`)).data.rows;
  console.log(`  ✓ now: [${(verify.merchant_ids||[]).map(m=>m.id+'='+m.name).join(',')}]`);
}

await archiveQpro('qpro6', 402);
await archiveQpro('qpro8', 458);
await revertQp2Merchants(922, 4);
