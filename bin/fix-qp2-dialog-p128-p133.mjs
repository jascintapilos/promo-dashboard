// Create dialog popups for P128-P133 on QP2 (all 4 merchants) and link them.
//
// All 6 codes already exist with all 4 merchants attached.
// Per-merchant popup: each merchant gets its own popup (site_id per brand).
// All 4 popup rows are merged into one dialog_popup_list on the PUT.
//
// Usage:
//   node bin/fix-qp2-dialog-p128-p133.mjs          # dry run
//   node bin/fix-qp2-dialog-p128-p133.mjs --commit  # live

import { readFileSync } from 'fs';
import { buildApiPlan, QP2_BRAND_TO_IDS } from '../src/api-mapper-qp2.js';
import { authedFetch, createDialogPopup, updatePromotion } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const DRY_RUN = !process.argv.includes('--commit');
if (DRY_RUN) console.log('[DRY RUN] Pass --commit to execute\n');

const s = getSite('qp2a');  // all QP2 brands share one BO

const BRANDS  = ['QP2A', 'QP2B', 'QP2C', 'QP2D'];
const ALL_MERCHANT_IDS = BRANDS.map(b => QP2_BRAND_TO_IDS[b].merchantId); // [1,2,3,4]

const ROWS = [
  { rn:'P128', handle:'P128-r129', promoId:860, mtId:800 },
  { rn:'P129', handle:'P129-r130', promoId:861, mtId:801 },
  { rn:'P130', handle:'P130-r131', promoId:859, mtId:796 },
  { rn:'P131', handle:'P131-r132', promoId:862, mtId:797 },
  { rn:'P132', handle:'P132-r133', promoId:898, mtId:835 },
  { rn:'P133', handle:'P133-r134', promoId:899, mtId:836 },
];

let ok = 0, err = 0;

for (const row of ROWS) {
  console.log(`\n── ${row.rn} (promo_id=${row.promoId}) ──`);
  const rec = JSON.parse(readFileSync(`captures/requests/${row.handle}.json`));

  if (DRY_RUN) {
    for (const brand of BRANDS) {
      const plan = await buildApiPlan(rec, { brand, site: s, merchantIds: ALL_MERCHANT_IDS });
      console.log(`  [DRY] POST popup for ${brand} site_id=${QP2_BRAND_TO_IDS[brand].siteId} label="${plan.dialogPopup?.label}"`);
    }
    console.log(`  [DRY] PUT promo ${row.promoId}: link mt=${row.mtId} + 4 popups`);
    ok++;
    continue;
  }

  // 1. POST one popup per merchant brand
  const popupEntries = [];
  let anyPopupFailed = false;

  for (const brand of BRANDS) {
    const plan = await buildApiPlan(rec, { brand, site: s, merchantIds: ALL_MERCHANT_IDS });
    if (!plan.dialogPopup) {
      console.log(`  ⚠ ${brand}: no dialogPopup in plan — skip`);
      continue;
    }
    try {
      const r = await createDialogPopup(s, plan.dialogPopup);
      const popup = r?.data?.rows || r?.data;
      if (!popup?.id) throw new Error(`no id: ${JSON.stringify(r).slice(0, 200)}`);
      console.log(`  ✓ ${brand}: popup id=${popup.id} code=${popup.code}`);
      popupEntries.push({ ...popup, promotion_id: row.promoId });
    } catch (e) {
      console.log(`  ✗ ${brand}: popup POST failed: ${e.message.slice(0, 120)}`);
      anyPopupFailed = true;
    }
  }

  if (popupEntries.length === 0) {
    console.log(`  ✗ no popups created — skipping PUT`);
    err++;
    continue;
  }
  if (anyPopupFailed) {
    console.log(`  ⚠ partial popup failure — proceeding with ${popupEntries.length}/4 popups`);
  }

  // 2. Build PUT body using QP2A plan (with all merchant IDs in scope)
  const basePlan = await buildApiPlan(rec, { brand: 'QP2A', site: s, merchantIds: ALL_MERCHANT_IDS });
  const putBody  = basePlan.buildUpdate(row.promoId, row.mtId, null);

  // Explicit merchant_ids as object (canary pattern)
  const merchantIdsObj = {};
  ALL_MERCHANT_IDS.forEach((id, i) => { merchantIdsObj[String(i)] = id; });
  putBody.merchant_ids = merchantIdsObj;

  // dialog_popup_list: object keyed "0"…"3" with full popup rows
  const dlObj = {};
  popupEntries.forEach((p, i) => { dlObj[String(i)] = p; });
  putBody.dialog_popup_list = dlObj;

  try {
    await updatePromotion(s, row.promoId, putBody);
    console.log(`  ✓ PUT: linked mt=${row.mtId} + ${popupEntries.length} popup(s)`);
    ok++;
  } catch (e) {
    console.log(`  ✗ PUT failed: ${e.message.slice(0, 150)}`);
    err++;
  }
}

console.log(`\nSummary: ${ok} ok, ${err} err`);
