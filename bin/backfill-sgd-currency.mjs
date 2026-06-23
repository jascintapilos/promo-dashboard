#!/usr/bin/env node
// Backfill missing SGD currency rows on QP2A P112-P115 (Deposit-type).
// The original POST returned 500 mid-chain, leaving only the MYR currency
// row. The recovery script's PUT should have added SGD via the
// promotion_currency block, but didn't land for these 4 rows.
//
// This script re-sends the PUT with the full promotion_currency object
// (MYR + SGD) to force the BO to upsert the missing SGD row.

import { loadAllRequests, resolveHandle } from '../src/planner.js';
import { getSite } from '../src/sites.js';
import { authedFetch, updatePromotion, findPromotionByCode } from '../src/api-client.js';
import { buildApiPlan, QP2_BRAND_TO_IDS } from '../src/api-mapper-qp2.js';

const targets = [
  { handle: 'P112-r113', promotionId: 1205 },
  { handle: 'P113-r114', promotionId: 1206 },
  { handle: 'P114-r115', promotionId: 1207 },
  { handle: 'P115-r116', promotionId: 1208 },
];

const { byHandle } = await loadAllRequests();
const site = getSite('ibc22');

for (const { handle, promotionId } of targets) {
  const rec = byHandle.get(handle);
  if (!rec) { console.log(handle, '— no fixture'); continue; }
  console.log(`━━━ ${handle} (id=${promotionId}) ━━━`);
  const plan = await buildApiPlan(rec, { brand: 'QP2A', site, merchantIds: [1] });
  // Fetch current promotion to get message_template_id + dialog_popup_id
  const existing = await findPromotionByCode(site, rec.promo_code);
  const templateId = existing?.message_template_id || 0;
  const popupRow = existing?.dialog_popup_list?.[0];
  const dialogPopup = popupRow ? {
    id: popupRow.popup_id,
    code: popupRow.code || (popupRow.dialog_popup?.code) || '',
    start_date: popupRow.dialog_popup?.start_date || popupRow.start_date,
    label: rec.promotion_name_en,
    fullRow: popupRow.dialog_popup || popupRow,
  } : null;
  console.log(`  template=${templateId} popup=${dialogPopup?.id || 'null'}`);
  // Build PUT body with promotion_currency
  const putBody = plan.buildUpdate(promotionId, templateId, dialogPopup);
  const curKeys = Object.keys(putBody.promotion_currency || {});
  console.log(`  PUT will include ${curKeys.length} currency entries: ${curKeys.map(k => putBody.promotion_currency[k].currency).join(', ')}`);
  await updatePromotion(site, promotionId, putBody);
  console.log(`  ✓ PUT completed`);
  // Verify
  const verify = await authedFetch(site, '/api/bo/promotioncurrency?promotion_id=' + promotionId);
  const got = (verify?.data?.rows || []).map(r => r.currency);
  console.log(`  Verify: ${got.join(', ')}`);
  console.log('');
}
