#!/usr/bin/env node
// One-off: V5 (promo id=1173) on ibc22 has one popup (id=1085, site_id=1)
// linked, which only renders on QP2A. To deploy the popup on QP2B/C/D,
// POST 3 clone popups with site_ids 2/3/4 (same contents), then PUT
// promo 1173 with all 4 popups in dialog_popup_list.

import fs from 'node:fs';
import { authedFetch, createDialogPopup, updatePromotion } from '../src/api-client.js';
import { buildApiPlan, QP2_BRAND_TO_IDS } from '../src/api-mapper-qp2.js';
import { getSite } from '../src/sites.js';

const PROMO_ID = 1173;
const SOURCE_POPUP_ID = 1085;
const site = getSite('ibc22');

const resolved = JSON.parse(fs.readFileSync('captures/requests/P068-r69.json', 'utf8'));
const v5Resolved = { ...resolved, promo_code: 'TEST_88FS_GOO_20X_V5' };

// 1. Fetch source popup full row
const popupListResp = await authedFetch(site, '/api/bo/popups?perPage=50&page=1&date_type=start_date&sort_by=id&sort_order=desc');
const sourcePopup = (popupListResp.data?.rows || []).find((p) => p.id === SOURCE_POPUP_ID);
if (!sourcePopup) {
  console.error(`Source popup ${SOURCE_POPUP_ID} not found`);
  process.exit(1);
}
console.log(`Source popup ${SOURCE_POPUP_ID} (code=${sourcePopup.code}, site_id=${sourcePopup.site_id})`);

// 2. POST 3 cloned popups for QP2B/C/D
const clones = [];
for (const brand of ['QP2B', 'QP2C', 'QP2D']) {
  const plan = await buildApiPlan(v5Resolved, { brand, site });
  if (!plan.dialogPopup) {
    console.log(`  ⚠ ${brand}: no dialogPopup body built — skipping`);
    continue;
  }
  console.log(`  → POST popup for ${brand} (site_id=${plan.dialogPopup.site_id})…`);
  if (process.argv.includes('--commit')) {
    const resp = await createDialogPopup(site, plan.dialogPopup);
    console.log(`    response keys:`, Object.keys(resp || {}), 'data keys:', Object.keys(resp?.data || {}));
    const rows = resp?.data?.rows || resp?.data;
    if (rows?.id) {
      clones.push({ brand, popup: rows });
      console.log(`    ✓ popup id=${rows.id} code=${rows.code} site_id=${rows.site_id}`);
    } else {
      console.log(`    ✖ no id in response:`, JSON.stringify(resp).slice(0, 250));
    }
  } else {
    console.log(`    (dry-run; would POST popup with site_id=${plan.dialogPopup.site_id})`);
  }
}

if (!process.argv.includes('--commit')) {
  console.log('');
  console.log('(dry-run; add --commit to POST popups + link)');
  process.exit(0);
}

// 3. Build new dialog_popup_list with all 4 popups (source + 3 clones).
//    The QP2 PUT shape requires the FULL popup row, not a join row.
const detailRow = (await authedFetch(site, `/api/bo/promotion/${PROMO_ID}`)).data.rows;
const plan = await buildApiPlan(v5Resolved, { brand: 'QP2A', site });
const putBody = plan.buildUpdate(PROMO_ID, detailRow.message_template_id || 0, null);
// Preserve current 4-merchant attachment
const merchantIdsObj = {};
(detailRow.merchant_ids || []).forEach((m, i) => { merchantIdsObj[String(i)] = m.id || m; });
putBody.merchant_ids = merchantIdsObj;
// dialog_popup_list: source popup (full row) + each clone (full row).
const combined = [
  { ...sourcePopup, promotion_id: PROMO_ID },
  ...clones.map((c) => ({ ...c.popup, promotion_id: PROMO_ID })),
];
const dl = {};
combined.forEach((d, i) => { dl[String(i)] = d; });
putBody.dialog_popup_list = dl;

console.log(`PUT dialog_popup_list now has ${combined.length} entries (site_ids: ${combined.map((d) => d.site_id).join(',')})`);
await updatePromotion(site, PROMO_ID, putBody);
console.log('✓ PUT succeeded');

// 5. Verify
const verifyResp = await authedFetch(site, '/api/bo/promotion?code=TEST_88FS_GOO_20X_V5&perPage=5');
const verify = (verifyResp.data?.rows || []).find((x) => x.id === PROMO_ID);
console.log('');
console.log(`Verify: ${verify.dialog_popup_list.length} popup links`);
for (const d of verify.dialog_popup_list) {
  console.log(`  popup_id=${d.popup_id} site_id=${d.site_id}`);
}
