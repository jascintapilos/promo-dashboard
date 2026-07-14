// safePromoUpdate — idempotent PUT wrapper for existing QP2 promotions.
//
// Problem it solves: any raw `buildUpdate()` + PUT call silently zeroes
// `message_template_sms_id` (the mapper hardcoded 0) and drops
// `dialog_popup_list` (the detail endpoint omits it, so callers that forget
// to re-fetch from the listing endpoint wipe all linked popups).
//
// This wrapper auto-fetches both before the PUT and carries them through
// unless the caller explicitly overrides them. Use it for any one-field fix
// (linking SMS MT, updating categories, adjusting TO, etc.) so the safety
// properties are guaranteed by default.
//
// Usage:
//   import { safePromoUpdate } from '../src/qp2-safe-update.js';
//
//   await safePromoUpdate(site, promoId, resolved, {
//     brand: 'QP2A',
//     merchantIds: [1, 2, 3, 4],
//     overrides: { message_template_sms_id: 1320 },
//   });
//
// The `overrides` object is applied last (after building the plan body +
// restoring current state), so every key in `overrides` wins.

import { authedFetch, updatePromotion } from './api-client.js';
import { buildApiPlan } from './api-mapper-qp2.js';

export async function safePromoUpdate(site, promoId, resolved, {
  brand = 'QP2A',
  merchantIds = null,
  overrides = {},
} = {}) {
  // ── 1. Fetch current BO state ────────────────────────────────────────────
  const detail = (await authedFetch(site, `/api/bo/promotion/${promoId}`)).data.rows;
  const code = detail.code;
  const currentSmsMtId    = detail.message_template_sms_id || 0;
  const currentTemplateId = detail.message_template_id     || 0;
  const currentMerchantIds = (detail.merchant_ids || []).map((m) => (typeof m === 'object' ? m.id : m));

  // dialog_popup_list lives on the listing endpoint, not the detail endpoint.
  const listResp = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=10`);
  const listRow  = (listResp?.data?.rows || []).find((r) => r.id === promoId);
  const dialogList = listRow?.dialog_popup_list || [];

  // Resolve full popup rows so the PUT can carry the complete shape.
  const fullDialogObj = {};
  if (dialogList.length > 0) {
    const popResp  = await authedFetch(site, '/api/bo/popups?perPage=500&sort_by=id&sort_order=desc&page=1');
    const allPopups = popResp?.data?.rows || [];
    dialogList.forEach((link, i) => {
      const fullRow = allPopups.find((p) => p.id === link.popup_id);
      fullDialogObj[String(i)] = fullRow
        ? { ...fullRow, promotion_id: promoId }
        : { ...link,    promotion_id: promoId };
    });
  }

  // ── 2. Build PUT body via mapper ─────────────────────────────────────────
  const effectiveMerchantIds = merchantIds || currentMerchantIds;
  const plan = await buildApiPlan(resolved, { brand, site, merchantIds: effectiveMerchantIds });

  // Pass currentSmsMtId as 4th arg so buildUpdate does NOT zero it.
  const putBody = plan.buildUpdate(promoId, currentTemplateId, null, currentSmsMtId);

  // ── 3. Restore preserved state ───────────────────────────────────────────
  if (Object.keys(fullDialogObj).length > 0) {
    putBody.dialog_popup_list = fullDialogObj;
  }

  const mObj = {};
  effectiveMerchantIds.forEach((id, i) => { mObj[String(i)] = id; });
  putBody.merchant_ids = mObj;

  // ── 4. Apply caller overrides (wins over everything above) ───────────────
  Object.assign(putBody, overrides);

  // ── 5. PUT ───────────────────────────────────────────────────────────────
  await updatePromotion(site, promoId, putBody);
}
