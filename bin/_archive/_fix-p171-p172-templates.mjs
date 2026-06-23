// P171 (#1216 QP2C/#432 QPRO4) and P172 (#1217 QP2C/#433 QPRO4) were created
// without inbox message templates (inbox_message=false in fixture at save time).
// This script creates the missing message templates + dialog popups (where absent)
// and links them via PUT.

import { readFileSync } from 'fs';
import { buildApiPlan } from '../src/api-mapper-qp2.js';
import { buildApiPlan as buildQpro } from '../src/api-mapper-qpro.js';
import { createMessageTemplate, createDialogPopup, updatePromotion, authedFetch } from '../src/api-client.js';

const TARGETS = [
  { rn: 'P171', file: 'P171-r172.json', code: 'REL_30PCT_5X_MIN3000',
    qp2c: 1216, qpro4: 432 },
  { rn: 'P172', file: 'P172-r173.json', code: 'REL_30PCT_5X_MIN4000',
    qp2c: 1217, qpro4: 433 },
];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

for (const t of TARGETS) {
  console.log(`\n── ${t.rn} ──`);
  const fixture = JSON.parse(readFileSync('./captures/requests/' + t.file, 'utf8'));

  // ── QP2C ──
  {
    const site = 'ibc22';
    const brand = 'QP2C';
    const promoId = t.qp2c;
    const plan = await buildApiPlan(fixture, { brand, site });

    // Check if template already exists
    const det = await authedFetch(site, '/api/bo/promotion/' + promoId);
    const existingTplId = det.data?.rows?.message_template_id;
    const existingPopupId = det.data?.rows?.dialog_popup_list?.[0]?.id || det.data?.rows?.dialog_popup_list?.[0];

    let templateId = existingTplId;
    let popupId = existingPopupId;

    if (!existingTplId && plan.messageTemplate) {
      process.stdout.write(`  QP2C #${promoId}: POST messagetemplate → `);
      const r = await createMessageTemplate(site, plan.messageTemplate);
      templateId = r.data?.rows?.id;
      console.log('id=' + templateId);
      await sleep(500);
    } else if (existingTplId) {
      console.log(`  QP2C #${promoId}: template already exists (id=${existingTplId}), skip`);
    }

    if (!existingPopupId && plan.dialogPopup) {
      process.stdout.write(`  QP2C #${promoId}: POST dialog popup → `);
      const r = await createDialogPopup(site, plan.dialogPopup);
      popupId = r.data?.rows?.id;
      console.log('id=' + popupId);
      await sleep(500);
    } else if (existingPopupId) {
      console.log(`  QP2C #${promoId}: popup already exists (id=${existingPopupId}), skip`);
    }

    // Link via PUT
    const putBody = plan.buildUpdate(promoId, templateId || 0, popupId ? { id: popupId } : null);
    await updatePromotion(site, promoId, putBody);
    const verify = await authedFetch(site, '/api/bo/promotion/' + promoId);
    const vr = verify.data?.rows;
    console.log(`  QP2C #${promoId}: template_id=${vr?.message_template_id} popup=${JSON.stringify(vr?.dialog_popup_list)}`);
    await sleep(500);
  }

  // ── QPRO4 ──
  {
    const site = 'qpro4';
    const brand = 'QPRO4';
    const promoId = t.qpro4;
    const plan = await buildQpro(fixture, { brand, site });

    const det = await authedFetch(site, '/api/bo/promotion/' + promoId);
    const existingTplId = det.data?.rows?.message_template_id;
    const existingPopupId = det.data?.rows?.dialog_popup_list?.[0]?.id || det.data?.rows?.dialog_popup_list?.[0];

    let templateId = existingTplId;
    let popupId = existingPopupId;

    if (!existingTplId && plan.messageTemplate) {
      process.stdout.write(`  QPRO4 #${promoId}: POST messagetemplate → `);
      const r = await createMessageTemplate(site, plan.messageTemplate);
      templateId = r.data?.rows?.id;
      console.log('id=' + templateId);
      await sleep(500);
    } else if (existingTplId) {
      console.log(`  QPRO4 #${promoId}: template already exists (id=${existingTplId}), skip`);
    }

    if (!existingPopupId && plan.dialogPopup) {
      process.stdout.write(`  QPRO4 #${promoId}: POST dialog popup → `);
      const r = await createDialogPopup(site, plan.dialogPopup);
      popupId = r.data?.rows?.id;
      console.log('id=' + popupId);
      await sleep(500);
    } else if (existingPopupId) {
      console.log(`  QPRO4 #${promoId}: popup already exists (id=${existingPopupId}), skip`);
    }

    // For QPRO, buildUpdate needs gpIds, catIds etc — use the full plan
    const putBody = plan.buildUpdate(promoId, templateId || 0, popupId ? { id: popupId } : null);
    await updatePromotion(site, promoId, putBody);
    const verify = await authedFetch(site, '/api/bo/promotion/' + promoId);
    const vr = verify.data?.rows;
    console.log(`  QPRO4 #${promoId}: template_id=${vr?.message_template_id} popup=${JSON.stringify(vr?.dialog_popup_list)}`);
    await sleep(500);
  }
}

console.log('\n✓ Done');
