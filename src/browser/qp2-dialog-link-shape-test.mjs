// Test different dialog_popup_list shapes for QP2A's PUT.
// Promo 1154 (TEST_API_QP2A_FC_V4) was created via canary-api-qp2 with
// empty dialog_popup_list; dialog popup KFLZ9 (id=1073) exists but isn't
// linked. Iterate over shapes and report which (if any) succeeds.

import fs from 'node:fs/promises';
import { getSite } from '../sites.js';
import { updatePromotion } from '../api-client.js';

const v25 = JSON.parse(await fs.readFile('captures/api-contract/2026-05-15T09-29-39-335Z-P-MULTI-test-v25-QP2A.json', 'utf8'));
const v25Body = JSON.parse((v25.calls || v25).find((c) => c.method === 'PUT' && c.url.includes('/promotion/')).requestBody);

const site = getSite('ibc22');
const promoId = 1154;
const popupId = 1073;
const popupCode = 'KFLZ9';

const baseBody = { ...v25Body, id: promoId, code: 'TEST_API_QP2A_FC_V4',
  name: 'TEST API QP2A Exclusive Offer - 30 Free Credit (V4 API)',
  message_template_id: 1027 };

const shapes = [
  { label: 'array of int',                    val: [popupId] },
  { label: 'array of int with promotion_id obj', val: [{ popup_id: popupId }] },
  { label: 'object keyed by 0 (id only)',     val: { '0': { id: popupId } } },
  { label: 'object keyed by 0 with 6 fields', val: { '0': { id: popupId, start_date: new Date().toISOString(), end_date: null, promotion_id: promoId, labelKey: popupCode, code: popupCode } } },
  { label: 'object keyed by 0 (popup_id key)', val: { '0': { popup_id: popupId } } },
  { label: 'object with id key only',         val: { id: popupId } },
];

for (const shape of shapes) {
  const body = { ...baseBody, dialog_popup_list: shape.val };
  try {
    const r = await updatePromotion(site, promoId, body);
    console.log(`✅ "${shape.label}" → OK (${r?.message || 'success'})`);
    console.log('   Sent:', JSON.stringify(shape.val).slice(0, 150));
    break; // first success wins
  } catch (e) {
    const m = (e.message.match(/I22-\w+/) || [''])[0];
    console.log(`❌ "${shape.label}" → ${e.message.split('\n')[0].slice(0, 80)} ${m}`);
  }
}
