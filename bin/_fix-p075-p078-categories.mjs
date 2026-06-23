// PUT-update P075-P078 promo saves on QPRO4 + QP2C to set
// promotion_category_ids to Slots+Fishing only (per Game Categories
// line in column M that the auto-namer missed on the initial save).
//
// Pre-req: fixtures must have `instructions.categories_only = ['SLOTS','FISHING']`
// (verified via the parser fix landed earlier in this session).
import { authedFetch, updatePromotion } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { buildApiPlan as buildQproPlan } from '../src/api-mapper-qpro.js';
import { buildApiPlan as buildQp2Plan } from '../src/api-mapper-qp2.js';
import { loadAllRequests } from '../src/planner.js';

const { byHandle } = await loadAllRequests();

const targets = [
  { rn: 'P075', handle: 'P075-r76', qproId: 353, qp2Id: 1182 },
  { rn: 'P076', handle: 'P076-r77', qproId: 354, qp2Id: 1183 },
  { rn: 'P077', handle: 'P077-r78', qproId: 355, qp2Id: 1184 },
  { rn: 'P078', handle: 'P078-r79', qproId: 356, qp2Id: 1185 },
];

for (const t of targets) {
  const rec = byHandle.get(t.handle);
  if (!rec) { console.error(`${t.rn}: fixture not found`); continue; }
  console.log(`\n${t.rn} (${rec.promo_code}) categories_only=${JSON.stringify(rec.instructions?.categories_only)}`);

  // ── QPRO4 ──────────────────────────────────────────────────────────────
  try {
    const site = getSite('qpro4');
    const det = (await authedFetch(site, `/api/bo/promotion/${t.qproId}`)).data.rows;
    const templateId = det.message_template_id || 0;
    // dialog_popup_list on GET — pass first row as-is
    const dialogPopup = Array.isArray(det.dialog_popup_list) && det.dialog_popup_list[0]
      ? det.dialog_popup_list[0]
      : null;
    const plan = await buildQproPlan(rec, { brand: 'QPRO4', site });
    const body = plan.buildUpdate(t.qproId, templateId, dialogPopup);
    await updatePromotion(site, t.qproId, body);
    console.log(`  QPRO4 id=${t.qproId} ✓ PUT (categories now ${rec.instructions.categories_only.join('+')})`);
  } catch (e) {
    console.log(`  QPRO4 id=${t.qproId} ✗ ${e.message.split('\n')[0]}`);
  }

  // ── QP2C ───────────────────────────────────────────────────────────────
  try {
    const site = getSite('ibc22');
    const det = (await authedFetch(site, `/api/bo/promotion/${t.qp2Id}`)).data.rows;
    const templateId = det.message_template_id || 0;
    const dialogPopup = Array.isArray(det.dialog_popup_list) && det.dialog_popup_list[0]
      ? det.dialog_popup_list[0]
      : null;
    const plan = await buildQp2Plan(rec, { brand: 'QP2C', site });
    const body = plan.buildUpdate(t.qp2Id, templateId, dialogPopup);
    await updatePromotion(site, t.qp2Id, body);
    console.log(`  QP2C  id=${t.qp2Id} ✓ PUT (categories now ${rec.instructions.categories_only.join('+')})`);
  } catch (e) {
    console.log(`  QP2C  id=${t.qp2Id} ✗ ${e.message.split('\n')[0]}`);
  }
}
