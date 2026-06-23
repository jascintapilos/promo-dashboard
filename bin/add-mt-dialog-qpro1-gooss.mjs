// Add MT + dialog + names to the 6 QPRO1 GOOSS V2 promos (1032-1037).
// These were created via direct POST and skipped the canary, so
// message templates, dialog popups, and promotion names are missing.
//
// Usage:
//   node bin/add-mt-dialog-qpro1-gooss.mjs          # dry run
//   node bin/add-mt-dialog-qpro1-gooss.mjs --commit  # live
import { readFileSync } from 'fs';
import { buildApiPlan } from '../src/api-mapper-qpro.js';
import {
  createMessageTemplate, createDialogPopup, addPromotionName,
  updatePromotion, authedFetch,
} from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const DRY_RUN = !process.argv.includes('--commit');
if (DRY_RUN) console.log('[DRY RUN] Pass --commit to execute\n');

const SITE_ID = 'qpro1';
const BRAND   = 'QPRO1';

const ROWS = [
  { rn: 'P122', fixtureSuffix: 'r123', promoId: 1032, v2code: 'WELC_BASE_80FS_GOOSS_20X_V2' },
  { rn: 'P123', fixtureSuffix: 'r124', promoId: 1033, v2code: 'WELC_BOOSTER_100FS_GOOSS_25X_V2' },
  { rn: 'P124', fixtureSuffix: 'r125', promoId: 1034, v2code: 'REL_BASE_60FS_GOOSS_12X_V2B' },
  { rn: 'P125', fixtureSuffix: 'r126', promoId: 1035, v2code: 'REL_BOOSTER_80FS_GOOSS_15X_V2' },
  { rn: 'P126', fixtureSuffix: 'r127', promoId: 1036, v2code: 'RET_GOOSS_BASE_50FS_10X_V2' },
  { rn: 'P127', fixtureSuffix: 'r128', promoId: 1037, v2code: 'RET_GOOSS_BOOST_60FS_12X_V2' },
];

const s = getSite(SITE_ID);
let done = 0, errors = 0;

for (const row of ROWS) {
  console.log(`\n── ${row.rn} ${row.v2code} (promo_id=${row.promoId}) ──`);

  // Load fixture and override promo_code to V2
  const rec = JSON.parse(readFileSync(`captures/requests/${row.rn}-${row.fixtureSuffix}.json`));
  rec.promo_code = row.v2code;

  // Build plan
  const plan = await buildApiPlan(rec, { brand: BRAND, site: s });

  // Check current state
  const det = await authedFetch(s, `/api/bo/promotion/${row.promoId}`);
  const promo = det?.data?.rows ?? det?.data;
  const hasMt     = (promo?.message_template_id || 0) > 0;
  const hasDialog = (promo?.dialog_popup_list || []).length > 0;
  console.log(`  current: mt_id=${promo?.message_template_id}  dialogs=${(promo?.dialog_popup_list||[]).length}`);

  if (DRY_RUN) {
    console.log(`  [DRY] MT: ${plan.messageTemplate ? 'will create' : 'none'}`);
    console.log(`  [DRY] Dialog: ${plan.dialogPopup ? 'will create' : 'none'}`);
    console.log(`  [DRY] Names: ${plan.buildNames?.(row.promoId)?.length ?? 0} locales`);
    continue;
  }

  let templateId = promo?.message_template_id || 0;
  let dialogPopup = null;

  // 1. Create MT (if not already linked)
  if (!hasMt && plan.messageTemplate) {
    try {
      const r = await authedFetch(s, '/api/bo/messagetemplate', { method: 'POST', body: plan.messageTemplate });
      templateId = r?.data?.rows?.id;
      if (!templateId) throw new Error(`no id: ${JSON.stringify(r).slice(0,200)}`);
      console.log(`  ✓ MT created id=${templateId}`);
    } catch (e) {
      console.log(`  ✗ MT failed: ${e.message.slice(0,150)}`);
      errors++;
      continue;
    }
  } else if (hasMt) {
    console.log(`  ─ MT already linked (id=${templateId}), skip`);
  }

  // 2. Create dialog popup (if not already linked)
  if (!hasDialog && plan.dialogPopup) {
    try {
      const r = await authedFetch(s, '/api/bo/popups', { method: 'POST', body: plan.dialogPopup });
      const popupRows = r?.data?.rows || r?.data;
      if (!popupRows?.id) throw new Error(`no id: ${JSON.stringify(r).slice(0,200)}`);
      dialogPopup = {
        id: popupRows.id,
        code: popupRows.code,
        start_date: popupRows.start_date || plan.dialogPopup.start_date,
        label: rec.promotion_name_en,
      };
      console.log(`  ✓ Dialog created id=${dialogPopup.id} code=${dialogPopup.code}`);
    } catch (e) {
      console.log(`  ✗ Dialog failed: ${e.message.slice(0,150)}`);
      errors++;
      continue;
    }
  } else if (hasDialog) {
    console.log(`  ─ Dialog already linked, skip`);
  }

  // 3. Promotion names
  const names = plan.buildNames?.(row.promoId) || [];
  for (const name of names) {
    try {
      await authedFetch(s, '/api/bo/promotionname', { method: 'POST', body: name });
      console.log(`  ✓ Name locale=${name.settings_locale_id}`);
    } catch (e) {
      console.log(`  ⚠ Name locale=${name.settings_locale_id} failed: ${e.message.slice(0,80)}`);
    }
  }

  // 4. PUT to link MT + dialog
  const putBody = plan.buildUpdate(row.promoId, templateId, dialogPopup);
  try {
    await updatePromotion(s, row.promoId, putBody);
    console.log(`  ✓ PUT linked mt=${templateId}${dialogPopup ? ` dialog=${dialogPopup.id}` : ''}`);
  } catch (e) {
    console.log(`  ✗ PUT link failed: ${e.message.slice(0,150)}`);
    errors++;
    continue;
  }

  done++;
}

console.log(`\nSummary: ${done} done, ${errors} errors`);
