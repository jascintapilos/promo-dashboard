// One-off: resume P053/QPRO10 (promotion_id=357) after the initial
// canary-api.js create run partially failed. createPromotion's POST embeds
// promotion_currency, but the BO rejected amount_per_line=0.02 (pre-fix
// Pragmatic-Play-only conversion applied to a Playtech game) with HTTP 422
// — yet still persisted the promotion shell server-side. Result: a live
// (status=1) promotion with 0 currency rows, no message template, no
// dialog. This script completes the interrupted sequence against the
// EXISTING promotion_id (never re-creates) now that src/api-mapper-qpro.js
// sends the corrected amount_per_line=0.20 for Playtech.
//
//   node bin/fix-p053-qpro10-resume.mjs          # dry run (prints bodies)
//   node bin/fix-p053-qpro10-resume.mjs --commit # live

import {
  authedFetch, createMessageTemplate, createDialogPopup,
  addPromotionName, updatePromotion,
} from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { buildApiPlan } from '../src/api-mapper-qpro.js';
import { loadAllRequests } from '../src/planner.js';

const DRY_RUN = !process.argv.includes('--commit');
const PROMOTION_ID = 357;
const site = getSite('qpro10');

console.log(DRY_RUN ? '[DRY RUN] pass --commit to execute\n' : '[LIVE]\n');

// ── Step 0: confirm current state before touching anything ────────────────
const detail = await authedFetch(site, `/api/bo/promotion/${PROMOTION_ID}`);
const promo = detail?.data?.rows;
if (!promo || promo.code !== 'ACQ_TSM_WELC_108FS_FBGW_8X') {
  throw new Error(`promotion ${PROMOTION_ID} is not the expected P053 record — aborting. Got: ${JSON.stringify(promo).slice(0, 200)}`);
}
console.log(`Confirmed promotion ${PROMOTION_ID}: code=${promo.code}, status=${promo.status}, message_template_id=${promo.message_template_id}`);

const curRes = await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${PROMOTION_ID}`);
const curRows = curRes?.data?.rows || [];
console.log(`Existing currency rows: ${curRows.length}`);
if (curRows.length > 0) {
  console.log('  Already has currency rows — not touching currency step:', JSON.stringify(curRows.map(r => ({ id: r.id, amount_per_line: r.amount_per_line }))));
}

// ── Step 1: rebuild the (now-corrected) plan ───────────────────────────────
const { byHandle } = await loadAllRequests();
const rec = byHandle.get('P053-r54');
if (!rec) throw new Error('P053-r54 fixture not found — run ingest first');
const plan = await buildApiPlan(rec, { brand: 'QPRO10', site });

const curBlock = plan.promotion.promotion_currency['0'];
console.log(`\nCorrected currency block: amount_per_line=${curBlock.amount_per_line}, rounds=${curBlock.rounds}, min_transfer=${curBlock.min_transfer}`);

// ── Step 2: create the missing currency row ────────────────────────────────
if (curRows.length === 0) {
  const body = { ...curBlock, promotion_id: PROMOTION_ID };
  console.log('\n── POST /api/bo/promotioncurrency ──');
  console.log(JSON.stringify(body));
  if (!DRY_RUN) {
    const res = await authedFetch(site, '/api/bo/promotioncurrency', { method: 'POST', body });
    console.log('  response:', JSON.stringify(res?.data || res).slice(0, 300));
  }
}

// ── Step 3: message template ───────────────────────────────────────────────
let templateId = promo.message_template_id || 0;
if (!templateId && plan.messageTemplate) {
  console.log('\n── POST /api/bo/messagetemplate ──');
  if (!DRY_RUN) {
    const r2 = await createMessageTemplate(site, plan.messageTemplate);
    templateId = r2?.data?.rows?.id;
    if (!templateId) throw new Error(`POST /messagetemplate did not return an id: ${JSON.stringify(r2).slice(0, 300)}`);
    console.log(`  ✓ template id = ${templateId}`);
  } else {
    console.log('  (dry-run — would create)');
  }
}

// ── Step 4: dialog popup ────────────────────────────────────────────────────
let dialogPopup = null;
if (plan.dialogPopup) {
  console.log('\n── POST /api/bo/popups ──');
  if (!DRY_RUN) {
    const r3 = await createDialogPopup(site, plan.dialogPopup);
    const popupRows = r3?.data?.rows || r3?.data;
    if (popupRows?.id && popupRows?.code) {
      dialogPopup = {
        id: popupRows.id,
        code: popupRows.code,
        start_date: popupRows.start_date || plan.dialogPopup.start_date,
        label: rec.promotion_name_en,
      };
      console.log(`  ✓ dialog popup id=${dialogPopup.id} code=${dialogPopup.code}`);
    } else {
      console.log('  ⚠ no id/code returned; PUT will leave dialog_popup_list empty');
    }
  } else {
    console.log('  (dry-run — would create)');
  }
}

// ── Step 5: per-locale names ─────────────────────────────────────────────
console.log('\n── POST /api/bo/promotionname ──');
for (const name of plan.buildNames(PROMOTION_ID)) {
  console.log(`  locale ${name.settings_locale_id}`);
  if (!DRY_RUN) await addPromotionName(site, name);
}

// ── Step 6: PUT to link template + dialog (never touches currency) ────────
console.log('\n── PUT /api/bo/promotion/' + PROMOTION_ID + ' ──');
const putBody = plan.buildUpdate(PROMOTION_ID, templateId || 0, dialogPopup);
if (!DRY_RUN) {
  await updatePromotion(site, PROMOTION_ID, putBody);
  console.log(`  ✓ PUT completed (message_template_id=${templateId || 0}${dialogPopup ? `, dialog_popup_id=${dialogPopup.id}` : ''})`);
} else {
  console.log('  (dry-run — would PUT)');
}

// ── Verify ──────────────────────────────────────────────────────────────
if (!DRY_RUN) {
  console.log('\n── Verify ──');
  const finalCur = await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${PROMOTION_ID}`);
  console.log('  currency rows:', JSON.stringify((finalCur?.data?.rows || []).map(r => ({ id: r.id, amount_per_line: r.amount_per_line, rounds: r.rounds }))));
  const finalPromo = await authedFetch(site, `/api/bo/promotion/${PROMOTION_ID}`);
  console.log('  message_template_id:', finalPromo?.data?.rows?.message_template_id);
  console.log('  dialog_popup_list:', JSON.stringify(finalPromo?.data?.rows?.dialog_popup_list));
}
