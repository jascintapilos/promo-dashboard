#!/usr/bin/env node
// Rebuild V5 (promo 1173) dialog_popup_list using full popup rows for
// 1085 + 1090 + 1091 + 1092. The earlier PUT corrupted the first entry
// by passing the join row shape; this fixes it.

import fs from 'node:fs';
import { authedFetch, updatePromotion } from '../src/api-client.js';
import { buildApiPlan } from '../src/api-mapper-qp2.js';
import { getSite } from '../src/sites.js';

const PROMO_ID = 1173;
const POPUP_IDS = [1085, 1090, 1091, 1092];  // QP2A/B/C/D
const site = getSite('ibc22');
const resolved = JSON.parse(fs.readFileSync('captures/requests/P068-r69.json', 'utf8'));
const v5Resolved = { ...resolved, promo_code: 'TEST_88FS_GOO_20X_V5' };

// Fetch full popup rows.
const popupListResp = await authedFetch(site, '/api/bo/popups?perPage=100&page=1&date_type=start_date&sort_by=id&sort_order=desc');
const allPopups = popupListResp.data?.rows || [];
const popups = POPUP_IDS.map((id) => {
  const p = allPopups.find((x) => x.id === id);
  if (!p) throw new Error(`Popup ${id} not found`);
  return p;
});
console.log('Popups (full rows):');
popups.forEach((p) => console.log(`  id=${p.id} code=${p.code} site_id=${p.site_id} site_name=${p.site_name}`));

const detailRow = (await authedFetch(site, `/api/bo/promotion/${PROMO_ID}`)).data.rows;
const plan = await buildApiPlan(v5Resolved, { brand: 'QP2A', site });
const putBody = plan.buildUpdate(PROMO_ID, detailRow.message_template_id || 0, null);

// Preserve merchant_ids
const merchantIdsObj = {};
(detailRow.merchant_ids || []).forEach((m, i) => { merchantIdsObj[String(i)] = m.id || m; });
putBody.merchant_ids = merchantIdsObj;

// dialog_popup_list with 4 full popup rows
const dl = {};
popups.forEach((p, i) => { dl[String(i)] = { ...p, promotion_id: PROMO_ID }; });
putBody.dialog_popup_list = dl;

if (process.argv.includes('--commit')) {
  await updatePromotion(site, PROMO_ID, putBody);
  console.log('✓ PUT succeeded');
  const verifyResp = await authedFetch(site, '/api/bo/promotion?code=TEST_88FS_GOO_20X_V5&perPage=5');
  const verify = (verifyResp.data?.rows || []).find((x) => x.id === PROMO_ID);
  console.log('Verify:');
  for (const d of verify.dialog_popup_list) {
    console.log(`  join_id=${d.id} popup_id=${d.popup_id} site_id=${d.site_id}`);
  }
} else {
  console.log('(dry-run; add --commit to PUT)');
}
