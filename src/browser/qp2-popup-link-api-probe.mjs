// Probe QP2A's dialog popup link mechanism purely via API.
// Strategy: GET the popups list + GET a promo detail, look for any field
// that surfaces the link relationship.

import fs from 'node:fs/promises';
import { getSite } from '../sites.js';
import { authedFetch } from '../api-client.js';

const site = getSite('ibc22');

console.log('=== Step 1: GET /api/bo/popups — list all dialog popups ===');
const popups = await authedFetch(site, '/api/bo/popups?perPage=10&page=1&status=&site_id=&date_type=start_date&sort_by=id&sort_order=desc');
const popupRows = popups?.data?.rows || popups?.data || [];
console.log(`  ${popupRows.length} popups returned`);
if (popupRows.length > 0) {
  console.log('  first popup keys:', Object.keys(popupRows[0]));
  console.log('  first popup sample:', JSON.stringify(popupRows[0], null, 2).slice(0, 1500));
}

console.log('\n=== Step 2: any popups with linked-promo metadata? ===');
const linked = popupRows.filter((p) => {
  return Object.keys(p).some((k) => /promo|link|relation/i.test(k));
});
console.log(`  ${linked.length} popups have a promo/link field`);
linked.slice(0, 3).forEach((p) => {
  console.log(`    id=${p.id} code=${p.code} →`,
    Object.entries(p).filter(([k]) => /promo|link/i.test(k)).map(([k, v]) => `${k}=${JSON.stringify(v).slice(0,80)}`).join(', '));
});

console.log('\n=== Step 3: GET /api/bo/promotion/<id> for a freshly-saved promo with dialog ===');
// Use TEST_API_QP2A_FC_V4 — promo 1154 with dialog popup 1073 (KFLZ9) NOT linked
const p4 = await authedFetch(site, '/api/bo/promotion/1154');
const p4d = p4?.data?.rows || p4?.data || {};
console.log('  V4 (no link) keys with popup/dialog:', Object.keys(p4d).filter((k) => /popup|dialog/i.test(k)));
console.log('  raw GET response keys:', Object.keys(p4d));

console.log('\n=== Step 4: Look for OPERATOR-LINKED popups via dropdown candidate endpoint ===');
// Maybe there is an endpoint that lists popups WITH their linked promo
// (used by the kt-dropdown to render "<promo_code> - <label>").
for (const ep of [
  '/api/bo/popups?with_promotion=1&perPage=5',
  '/api/bo/popups/promotion-options',
  '/api/bo/promotion/popups',
  '/api/bo/promotion/1154/popups',
  '/api/bo/dialogpopup',
  '/api/bo/promotion-popup',
]) {
  try {
    const r = await authedFetch(site, ep);
    console.log(`  ✓ ${ep}: ${JSON.stringify(r).slice(0,300)}`);
  } catch (e) {
    console.log(`  ✗ ${ep}: ${e.message.split('\n')[0].slice(0,100)}`);
  }
}

await fs.writeFile('captures/qp2-popup-link-api-probe.json', JSON.stringify({ popupRows: popupRows.slice(0, 3), v4: p4d }, null, 2));
console.log('\nSaved: captures/qp2-popup-link-api-probe.json');
