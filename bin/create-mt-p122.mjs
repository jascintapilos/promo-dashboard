// Create MT for P122 (WELC_BASE_80FS_GOOSS_20X) on QPRO2/3/4 and link to promo.
//
// Usage:
//   node bin/create-mt-p122.mjs             # dry run (shows plan only)
//   node bin/create-mt-p122.mjs --commit    # live POST MT + PUT promo
import { authedFetch, createMessageTemplate, updatePromotion } from '../src/api-client.js';
import { buildApiPlan } from '../src/api-mapper-qpro.js';
import { getSite } from '../src/sites.js';
import { readFileSync } from 'fs';

const DRY_RUN = !process.argv.includes('--commit');
if (DRY_RUN) console.log('[DRY RUN] Pass --commit to execute\n');

const PROMO_CODE = 'WELC_BASE_80FS_GOOSS_20X';
const TARGETS = ['qpro2', 'qpro3', 'qpro4'];

// Load fixture (has inbox_message:true + inline_mt_bodies)
const fixture = JSON.parse(readFileSync('./captures/requests/P122-r123.json', 'utf8'));

for (const siteId of TARGETS) {
  console.log(`\n=== ${siteId} ===`);
  const site = getSite(siteId);

  // 1. Look up existing promo by code
  const listRes = await authedFetch(site, `/api/bo/promotion?code=${PROMO_CODE}&status=1`);
  const listRows = listRes?.data?.rows;
  const promoRow = Array.isArray(listRows)
    ? listRows.find(r => r.code === PROMO_CODE)
    : null;
  if (!promoRow) {
    console.log(`  ✗ promo ${PROMO_CODE} not found on ${siteId}`);
    continue;
  }
  const promotionId = promoRow.id;
  const existingMtId = promoRow.message_template_id || 0;
  console.log(`  promo id=${promotionId}  existing_mt=${existingMtId}`);

  if (existingMtId > 0) {
    console.log(`  ⚠ MT already linked (id=${existingMtId}) — skipping`);
    continue;
  }

  // 2. Build plan (resolves FS catalogs + extracts MT body from inline_mt_bodies)
  const plan = await buildApiPlan(fixture, { brand: siteId, site });
  if (!plan.messageTemplate) {
    console.log(`  ✗ buildApiPlan did not generate messageTemplate — check fixture inbox_message/inline_mt_bodies`);
    continue;
  }
  console.log(`  MT body locales: ${Object.keys(plan.messageTemplate.details).join(', ')}`);
  if (DRY_RUN) {
    console.log(`  [dry] would POST MT: code=${plan.messageTemplate.code}`);
    console.log(`  [dry] would PUT promo ${promotionId} with new templateId`);
    continue;
  }

  // 3. POST MT
  const mtRes = await createMessageTemplate(site, plan.messageTemplate);
  const templateId = mtRes?.data?.rows?.id;
  if (!templateId) {
    console.log(`  ✗ POST /messagetemplate failed: ${JSON.stringify(mtRes).slice(0, 300)}`);
    continue;
  }
  console.log(`  ✓ MT created  id=${templateId}`);

  // 4. GET promo detail to check for existing dialog popup
  const detailRes = await authedFetch(site, `/api/bo/promotion/${promotionId}`);
  const detail = detailRes?.data?.rows;
  const existingDialog = (detail?.dialog_popup_list && Object.keys(detail.dialog_popup_list).length > 0)
    ? detail.dialog_popup_list['0'] : null;
  if (existingDialog) console.log(`  dialog popup already linked id=${existingDialog.id}`);

  // 5. PUT promo to link the new MT id
  const putBody = plan.buildUpdate(promotionId, templateId, existingDialog);
  const putRes = await updatePromotion(site, promotionId, putBody);
  const ok = putRes?.status === 0 || putRes?.code === 0 || putRes?.data != null;
  if (ok) {
    console.log(`  ✓ PUT promotion — MT linked (template_id=${templateId})`);
  } else {
    console.log(`  ✗ PUT failed: ${JSON.stringify(putRes).slice(0, 300)}`);
  }
}

console.log('\nDone.');
