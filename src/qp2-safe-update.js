// safePromoUpdate: idempotent PUT wrapper for existing QP2 promotions.
//
// Use this for one-field fixes on QP2 promotions. It builds the normal mapper
// PUT body, preserves current dialog/MT links through the shared api-client
// guard, keeps the existing merchant_ids unless overridden, then applies any
// explicit caller overrides last.

import { authedFetch, preserveQp2PutFields, updatePromotion } from './api-client.js';
import { buildApiPlan } from './api-mapper-qp2.js';

export async function safePromoUpdate(site, promoId, resolved, {
  brand = 'QP2A',
  merchantIds = null,
  overrides = {},
} = {}) {
  const detail = (await authedFetch(site, `/api/bo/promotion/${promoId}`)).data.rows;
  const currentSmsMtId = detail.message_template_sms_id || 0;
  const currentTemplateId = detail.message_template_id || 0;
  const currentMerchantIds = (detail.merchant_ids || []).map((m) => (typeof m === 'object' ? m.id : m));

  const effectiveMerchantIds = merchantIds || currentMerchantIds;
  const plan = await buildApiPlan(resolved, { brand, site, merchantIds: effectiveMerchantIds });

  const putBody = plan.buildUpdate(promoId, currentTemplateId, null, currentSmsMtId);
  const { body: preservedBody } = await preserveQp2PutFields(site, promoId, putBody);

  const mObj = {};
  effectiveMerchantIds.forEach((id, i) => { mObj[String(i)] = id; });
  preservedBody.merchant_ids = mObj;

  Object.assign(preservedBody, overrides);

  await updatePromotion(site, promoId, preservedBody);
}
