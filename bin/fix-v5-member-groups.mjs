#!/usr/bin/env node
// One-off: V5 (promo 1173) on ibc22 has merchant_ids=[1,2,3,4] but
// member_group_ids only covers QP2A (site_id=1). Operator rule 2026-05-16:
// when extending QP2 merchants, member_group_ids must include each
// merchant's eligible tiers. Re-PUT with expanded set.

import fs from 'node:fs';
import { authedFetch, updatePromotion } from '../src/api-client.js';
import { buildApiPlan, QP2_BRAND_TO_IDS } from '../src/api-mapper-qp2.js';
import { getSite } from '../src/sites.js';

const PROMO_ID = 1173;
const POPUP_IDS = [1085, 1090, 1091, 1092];  // per-merchant
const site = getSite('ibc22');
const resolved = JSON.parse(fs.readFileSync('captures/requests/P068-r69.json', 'utf8'));
const v5Resolved = { ...resolved, promo_code: 'TEST_88FS_GOO_20X_V5' };

const detail = await authedFetch(site, `/api/bo/promotion/${PROMO_ID}`);
const detailRow = detail.data.rows;
const merchantIds = (detailRow.merchant_ids || []).map((m) => m.id || m);
console.log('Current merchant_ids:', merchantIds);

const plan = await buildApiPlan(v5Resolved, { brand: 'QP2A', site, merchantIds });
console.log(`Expanded member_group_ids: ${plan.memberGroupIds.length} groups → [${plan.memberGroupIds.join(',')}]`);

const putBody = plan.buildUpdate(PROMO_ID, detailRow.message_template_id || 0, null);
// Preserve merchant_ids
const midObj = {};
merchantIds.forEach((id, i) => { midObj[String(i)] = id; });
putBody.merchant_ids = midObj;
// Preserve dialog_popup_list (4 full popup rows)
const popupListResp = await authedFetch(site, '/api/bo/popups?perPage=100&page=1&date_type=start_date&sort_by=id&sort_order=desc');
const popupsAll = popupListResp.data?.rows || [];
const popups = POPUP_IDS.map((id) => popupsAll.find((x) => x.id === id));
if (popups.some((p) => !p)) {
  console.error('Some popup IDs missing:', POPUP_IDS, '→', popups.map((p) => p?.id));
  process.exit(1);
}
const dl = {};
popups.forEach((p, i) => { dl[String(i)] = { ...p, promotion_id: PROMO_ID }; });
putBody.dialog_popup_list = dl;

if (process.argv.includes('--commit')) {
  await updatePromotion(site, PROMO_ID, putBody);
  console.log('✓ PUT succeeded');
  const verifyResp = await authedFetch(site, '/api/bo/promotion?code=TEST_88FS_GOO_20X_V5&perPage=5');
  const v = (verifyResp.data?.rows || []).find((x) => x.id === PROMO_ID);
  const detailV = (await authedFetch(site, `/api/bo/promotion/${PROMO_ID}`)).data.rows;
  console.log('Verify merchant_ids:', (v?.merchant_ids||[]).map(m=>m.name).join('/'));
  console.log('Verify popups linked:', (v?.dialog_popup_list||[]).length);
  console.log('Verify member_group_ids (count):', (detailV.member_group_ids||[]).length);
} else {
  console.log('(dry-run; add --commit to PUT)');
}
