#!/usr/bin/env node
// One-off: extend an existing QP2 promo's merchant_ids to include all 4
// merchants (QP2A/B/C/D = IBC22/KING333/ACE66/SPADE66). Use when a single
// shared-config code was created for one merchant and needs to apply to
// the others. Per Jascinta 2026-05-16, this is the canonical QP2 pattern.
//
// Usage:
//   node bin/extend-qp2-merchants.mjs <handle> <promotion_id>
// Example:
//   node bin/extend-qp2-merchants.mjs P068-r69 1173

import fs from 'node:fs';
import path from 'node:path';
import { authedFetch } from '../src/api-client.js';
import { buildApiPlan, QP2_BRAND_TO_IDS } from '../src/api-mapper-qp2.js';
import { getSite } from '../src/sites.js';

const [handle, idArg] = process.argv.slice(2);
if (!handle || !idArg) {
  console.error('Usage: node bin/extend-qp2-merchants.mjs <handle> <promotion_id>');
  process.exit(1);
}
const promotionId = Number(idArg);

const fixturePath = path.join('captures', 'requests', `${handle}.json`);
const resolved = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const site = getSite('ibc22');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`EXTEND QP2 MERCHANTS — promotion id=${promotionId} on ibc22`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const existing = await authedFetch(site, `/api/bo/promotion/${promotionId}`);
const row = existing.data.rows;
console.log(`Existing code: ${row.code}`);
console.log(`Existing merchant_ids:`, row.merchant_ids?.map((m) => `${m.id}=${m.name}`).join(', '));
console.log(`message_template_id: ${row.message_template_id}`);
console.log(`dialog_popup_list:`, JSON.stringify(row.dialog_popup_list || []).slice(0, 100));

// Rebuild the canonical PUT body via the QP2A mapper, then override
// merchant_ids to include all 4. Preserve the existing message_template_id
// and dialog_popup_list (the popup row is per-merchant — operator will
// duplicate via the BO UI if needed).
const plan = await buildApiPlan(resolved, { brand: 'QP2A', site });
// Existing dialog_popup_list is the join-table entry; preserve as-is for
// the PUT. The mapper's plan.buildUpdate expects a single popup row object,
// but the existing row may already have it linked. Pass null so buildUpdate
// emits an empty list, then we overlay the row's saved list.
const planBody = plan.buildUpdate(promotionId, row.message_template_id || 0, null);
// merchant_ids in keyed-object form: every QP2 merchant
const allMerchantIds = {};
for (const [brand, ids] of Object.entries(QP2_BRAND_TO_IDS)) {
  allMerchantIds[String(Object.keys(allMerchantIds).length)] = ids.merchantId;
}
planBody.merchant_ids = allMerchantIds;
// Preserve whatever dialog_popup_list is already attached (operator's UI
// duplicate will append per-merchant rows; we don't reset).
if (Array.isArray(row.dialog_popup_list) && row.dialog_popup_list.length) {
  const dialogList = {};
  row.dialog_popup_list.forEach((d, i) => { dialogList[String(i)] = d; });
  planBody.dialog_popup_list = dialogList;
}

console.log('');
console.log('PUT merchant_ids →', JSON.stringify(planBody.merchant_ids));
console.log('');

if (process.argv.includes('--commit')) {
  const resp = await authedFetch(site, `/api/bo/promotion/${promotionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(planBody),
  });
  console.log('✓ PUT succeeded');
  const verifyResp = await authedFetch(site, `/api/bo/promotion/${promotionId}`);
  console.log('New merchant_ids:', verifyResp.data.rows.merchant_ids?.map((m) => `${m.id}=${m.name}`).join(', '));
} else {
  console.log('(dry-run; add --commit to send the PUT)');
}
