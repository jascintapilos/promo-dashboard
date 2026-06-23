// Send V25's EXACT PUT body verbatim against promo id 1153 (just-created
// TEST_API_QP2A_FC_V3 from canary-api-qp2). If it succeeds we know the
// shape works and our build-from-scratch path has a diff somewhere.

import fs from 'node:fs/promises';
import { getSite } from '../sites.js';
import { updatePromotion } from '../api-client.js';

const v25 = JSON.parse(await fs.readFile('captures/api-contract/2026-05-15T09-29-39-335Z-P-MULTI-test-v25-QP2A.json', 'utf8'));
const v25Body = JSON.parse((v25.calls || v25).find((c) => c.method === 'PUT' && c.url.includes('/promotion/')).requestBody);

const site = getSite('ibc22');
const targetId = Number(process.argv[2] || 1153);
v25Body.id = targetId;
v25Body.code = process.argv[3] || 'TEST_API_QP2A_FC_V3';
v25Body.name = process.argv[4] || 'TEST API QP2A Exclusive Offer - 30 Free Credit (V3 API)';
v25Body.message_template_id = Number(process.argv[5] || 1026);
console.log(`PUT /api/bo/promotion/${targetId} with V25-verbatim body (id/code/name/template_id swapped)…`);
try {
  const r = await updatePromotion(site, targetId, v25Body);
  console.log('PUT OK:', JSON.stringify(r?.message || r?.data?.rows?.code || r).slice(0, 200));
} catch (e) {
  console.log('PUT FAIL:', e.message.slice(0, 600));
}
