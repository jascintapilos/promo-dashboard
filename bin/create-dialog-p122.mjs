// Create dialog popup for P122 (WELC_BASE_80FS_GOOSS_20X) on QPRO2/3/4 and link to promo.
//
// Usage:
//   node bin/create-dialog-p122.mjs             # dry run
//   node bin/create-dialog-p122.mjs --commit    # live POST popup + PUT promo
import { authedFetch, createDialogPopup, updatePromotion } from '../src/api-client.js';
import { buildApiPlan } from '../src/api-mapper-qpro.js';
import { getSite } from '../src/sites.js';
import { readFileSync } from 'fs';

const DRY_RUN = !process.argv.includes('--commit');
if (DRY_RUN) console.log('[DRY RUN] Pass --commit to execute\n');

const PROMO_CODE = 'WELC_BASE_80FS_GOOSS_20X';
const PROMO_IDS  = { qpro2: 508, qpro3: 531, qpro4: 460 };
const MT_IDS     = { qpro2: 422, qpro3: 491, qpro4: 423 };

const fixture = JSON.parse(readFileSync('./captures/requests/P122-r123.json', 'utf8'));
// Re-ingest strips parsed fields not in the sheet (min_deposit/vps/TO are in remark only).
// Inject them back so buildDialogPopupBody uses the correct min_deposit for CTA selection.
fixture.parsed = { ...fixture.parsed, min_deposit: 100, value_per_spin: 0.02, to_multiplier: 20 };

for (const siteId of ['qpro2', 'qpro3', 'qpro4']) {
  console.log(`\n=== ${siteId} ===`);
  const site = getSite(siteId);
  const promotionId = PROMO_IDS[siteId];
  const templateId  = MT_IDS[siteId];

  // Verify promo still exists and has the expected MT linked
  const listRes = await authedFetch(site, `/api/bo/promotion?code=${PROMO_CODE}&status=1`);
  const promoRow = (listRes?.data?.rows || []).find(r => r.code === PROMO_CODE);
  if (!promoRow) { console.log(`  ✗ promo not found`); continue; }
  if (promoRow.message_template_id !== templateId) {
    console.log(`  ⚠ MT mismatch: BO=${promoRow.message_template_id} expected=${templateId}`);
  }

  // Check if dialog already linked
  const detailRes = await authedFetch(site, `/api/bo/promotion/${promotionId}`);
  const detail = detailRes?.data?.rows;
  const existingDialog = (detail?.dialog_popup_list && Object.keys(detail.dialog_popup_list).length > 0)
    ? detail.dialog_popup_list['0'] : null;
  if (existingDialog) {
    console.log(`  ⚠ dialog already linked id=${existingDialog.id} — skipping`);
    continue;
  }

  // Build plan (popup_dialog:true in fixture → buildDialogPopupBody fires)
  const plan = await buildApiPlan(fixture, { brand: siteId, site });
  if (!plan.dialogPopup) {
    console.log(`  ✗ buildApiPlan did not generate dialogPopup — check popup_dialog in fixture`);
    continue;
  }
  const dp = plan.dialogPopup;
  const locales = Object.keys(dp.contents);
  console.log(`  dialog body locales: [${locales.join(', ')}]  label="${dp.label}"`);
  for (const [k, c] of Object.entries(dp.contents)) {
    console.log(`    [${k}] locale_id=${c.locale_id}  title="${c.title}"  cta1="${c.cta_button_text_1}"`);
  }

  if (DRY_RUN) {
    console.log(`  [dry] would POST popup + PUT promo ${promotionId}`);
    continue;
  }

  // POST dialog popup
  const popRes = await createDialogPopup(site, dp);
  const popupId   = popRes?.data?.rows?.id;
  const popupCode = popRes?.data?.rows?.code;
  if (!popupId) {
    console.log(`  ✗ POST /popups failed: ${JSON.stringify(popRes).slice(0, 300)}`);
    continue;
  }
  console.log(`  ✓ popup created  id=${popupId}  code="${popupCode}"`);

  // PUT promo to link dialog popup (preserve existing MT linkage)
  const dialogArg = {
    id: popupId,
    code: popupCode || '',
    start_date: dp.start_date,
    label: dp.label,
  };
  const putBody = plan.buildUpdate(promotionId, templateId, dialogArg);
  const putRes = await updatePromotion(site, promotionId, putBody);
  const ok = putRes?.status === 0 || putRes?.code === 0 || putRes?.data != null;
  if (ok) {
    console.log(`  ✓ PUT promotion — dialog linked (popup_id=${popupId})`);
  } else {
    console.log(`  ✗ PUT failed: ${JSON.stringify(putRes).slice(0, 300)}`);
  }
}

console.log('\nDone.');
