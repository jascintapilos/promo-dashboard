#!/usr/bin/env node
// One-off: re-link popup 1085 to V5 promo 1173 on ibc22. Earlier
// extend-qp2-merchants.mjs PUT cleared the linkage.

import fs from 'node:fs';
import { authedFetch, updatePromotion } from '../src/api-client.js';
import { buildApiPlan, QP2_BRAND_TO_IDS } from '../src/api-mapper-qp2.js';
import { getSite } from '../src/sites.js';

const PROMO_ID = 1173;
const POPUP_ID = 1085;
const site = getSite('ibc22');

const resolved = JSON.parse(fs.readFileSync('captures/requests/P068-r69.json', 'utf8'));
// Temporarily force code to V5 (the fixture is now on V6 but we need V5 fields)
const v5Resolved = { ...resolved, promo_code: 'TEST_88FS_GOO_20X_V5' };

const popupResp = await authedFetch(site, '/api/bo/popups?perPage=50&page=1&date_type=start_date&sort_by=id&sort_order=desc');
const popupRow = (popupResp.data?.rows || []).find((p) => p.id === POPUP_ID);
if (!popupRow) {
  console.error(`Popup id=${POPUP_ID} not found.`);
  process.exit(1);
}
console.log(`Popup ${POPUP_ID} (code=${popupRow.code}) — found.`);

const detail = await authedFetch(site, `/api/bo/promotion/${PROMO_ID}`);
const promoRow = detail.data.rows;
console.log(`Promo ${PROMO_ID} merchant_ids:`, (promoRow.merchant_ids||[]).map(m=>m.id+'='+m.name).join(','));
console.log(`Promo template_id:`, promoRow.message_template_id);

const plan = await buildApiPlan(v5Resolved, { brand: 'QP2A', site });
const putBody = plan.buildUpdate(PROMO_ID, promoRow.message_template_id || 0, {
  id: popupRow.id,
  code: popupRow.code,
  start_date: popupRow.start_date,
  label: v5Resolved.promotion_name_en,
  fullRow: popupRow,
});

// Preserve the 4-merchant attachment.
const currentIds = (promoRow.merchant_ids || []).map((m) => m.id || m);
const merchantIdsObj = {};
currentIds.forEach((id, i) => { merchantIdsObj[String(i)] = id; });
putBody.merchant_ids = merchantIdsObj;

console.log('PUT body dialog_popup_list:', JSON.stringify(putBody.dialog_popup_list).slice(0,150));
console.log('PUT body merchant_ids:', JSON.stringify(putBody.merchant_ids));

if (process.argv.includes('--commit')) {
  await updatePromotion(site, PROMO_ID, putBody);
  console.log('✓ PUT succeeded');
  const verifyResp = await authedFetch(site, `/api/bo/promotion?code=TEST_88FS_GOO_20X_V5&perPage=5`);
  const verify = (verifyResp.data?.rows||[]).find(x=>x.id===PROMO_ID);
  console.log('Verify dialog_popup_list:', JSON.stringify(verify?.dialog_popup_list).slice(0,200));
  console.log('Verify merchant_ids:', (verify?.merchant_ids||[]).map(m=>m.name).join('/'));
} else {
  console.log('(dry-run; add --commit to send the PUT)');
}
