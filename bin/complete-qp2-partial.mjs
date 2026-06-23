#!/usr/bin/env node
// Complete a partial QP2 save where POST /api/bo/promotion succeeded
// (returning a promotion id) but downstream steps (message template,
// dialog popup, per-locale names, PUT link) didn't fire because the BO
// returned HTTP 500 mid-chain.
//
// Usage:
//   node bin/complete-qp2-partial.mjs <handle> <promotion_id> [--brand=QP2A]
// Example:
//   node bin/complete-qp2-partial.mjs P112-r113 1205

import { parseArgs } from './_args.js';
import { loadAllRequests, resolveHandle } from '../src/planner.js';
import { getSite } from '../src/sites.js';
import { BRAND_TO_SITE } from '../src/ingest.js';
import {
  addPromotionName, createMessageTemplate,
  createDialogPopup, updatePromotion,
} from '../src/api-client.js';
import { buildApiPlan, QP2_BRAND_TO_IDS } from '../src/api-mapper-qp2.js';

const { flags, positional } = parseArgs(process.argv.slice(2));
const handleArg = positional[0];
const promotionId = Number(positional[1]);
const targetBrand = (flags.brand || 'QP2A').toUpperCase();

if (!handleArg || !promotionId) {
  console.error('usage: complete-qp2-partial.mjs <handle> <promotion_id> [--brand=QP2A]');
  process.exit(2);
}

const { byHandle, byId } = await loadAllRequests();
const handle = resolveHandle(handleArg, { byHandle, byId });
const rec = byHandle.get(handle);
if (!rec) { console.error(`No fixture for ${handleArg}`); process.exit(3); }

const siteId = BRAND_TO_SITE[targetBrand]?.siteId;
const site = getSite(siteId);
console.log(`Completing partial save: ${rec.promo_code} (id=${promotionId}) on ${siteId}/${targetBrand}`);

const merchantIds = [QP2_BRAND_TO_IDS[targetBrand]?.merchantId].filter(Boolean);
const plan = await buildApiPlan(rec, { brand: targetBrand, site, merchantIds });

let templateId = null;
let dialogPopup = null;

// 2. Message template
if (plan.messageTemplate) {
  console.log(`  → POST /api/bo/messagetemplate…`);
  const r = await createMessageTemplate(site, plan.messageTemplate);
  templateId = r?.data?.rows?.id;
  console.log(`    ✓ template id = ${templateId}`);
}

// 3. Dialog popup
if (plan.dialogPopup) {
  console.log(`  → POST /api/bo/popups…`);
  const r = await createDialogPopup(site, plan.dialogPopup);
  const rows = r?.data?.rows || r?.data;
  if (rows?.id && rows?.code) {
    dialogPopup = {
      id: rows.id, code: rows.code,
      start_date: rows.start_date || plan.dialogPopup.start_date,
      label: rec.promotion_name_en, fullRow: rows,
    };
    console.log(`    ✓ dialog popup id=${dialogPopup.id} code=${dialogPopup.code}`);
  }
}

// 4. Per-locale names
for (const name of plan.buildNames(promotionId)) {
  console.log(`  → POST /api/bo/promotionname (locale ${name.settings_locale_id})…`);
  await addPromotionName(site, name);
  console.log(`    ✓ added name for settings_locale_id=${name.settings_locale_id}`);
}

// 5. PUT link
const putBody = plan.buildUpdate(promotionId, templateId || 0, dialogPopup);
console.log(`  → PUT /api/bo/promotion/${promotionId}…`);
await updatePromotion(site, promotionId, putBody);
console.log(`    ✓ PUT completed`);

console.log('');
console.log(`✓ Completed.   promotion_id=${promotionId}   template_id=${templateId || 0}   dialog_popup_id=${dialogPopup ? dialogPopup.id : 'null'}`);
