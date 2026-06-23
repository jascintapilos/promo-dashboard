// Probe v2: focus on `promo_linked_ids` + look at popups data more carefully.

import fs from 'node:fs/promises';
import { getSite } from '../sites.js';
import { authedFetch } from '../api-client.js';

const site = getSite('ibc22');

// Step 1: list popups with full body
const popups = await authedFetch(site, '/api/bo/popups?perPage=5&page=1');
const popupRows = popups?.data?.rows || [];
console.log(`=== Step 1: ${popupRows.length} popups ===`);
if (popupRows.length > 0) {
  console.log('first popup keys:', Object.keys(popupRows[0]).sort().join(', '));
  console.log('first popup (full):');
  console.log(JSON.stringify(popupRows[0], null, 2).slice(0, 2500));
}

// Step 2: a known V4 popup (id=1073)
console.log('\n=== Step 2: GET /api/bo/popups/1073 ===');
try {
  const r = await authedFetch(site, '/api/bo/popups/1073');
  console.log('keys:', Object.keys(r?.data?.rows || r?.data || {}).join(', '));
  console.log('body:', JSON.stringify(r?.data?.rows || r?.data, null, 2).slice(0, 2500));
} catch (e) {
  console.log('fail:', e.message.split('\n')[0]);
}

// Step 3: V4 promo - look at promo_linked_ids
console.log('\n=== Step 3: GET /api/bo/promotion/1154 promo_linked_ids ===');
const v4 = await authedFetch(site, '/api/bo/promotion/1154');
const v4d = v4?.data?.rows || v4?.data || {};
console.log('promo_linked_ids:', JSON.stringify(v4d.promo_linked_ids));
console.log('member_ids:', JSON.stringify(v4d.member_ids));
console.log('kyc_listing:', JSON.stringify(v4d.kyc_listing));

// Step 4: find a promo that the user-facing dropdown shows as LINKED
// (e.g., one with promo_code prefix matching its dialog popup label).
// We know the dropdown shows `RELOAD-APP-10PCT - Mega888 - 10% Reload Bonus`
// — let's find that promo on QP2A and check its detail.
console.log('\n=== Step 4: GET promotion by promo_code (RELOAD-APP-10PCT) ===');
const list = await authedFetch(site, '/api/bo/promotion?perPage=200&page=1&status=&category_id=&game_provider_code=&currency_id=&bonus_condition=&merchant_id=&date_type=valid_from&sort_by=id&sort_order=asc');
const candidate = (list?.data?.rows || []).find((r) => /RELOAD-APP|RELOAD|WELCOME/i.test(r.code || ''));
if (candidate) {
  console.log(`Found: ${candidate.code} (id=${candidate.id})`);
  const detail = await authedFetch(site, `/api/bo/promotion/${candidate.id}`);
  const d = detail?.data?.rows || detail?.data || {};
  for (const k of Object.keys(d)) {
    if (/popup|dialog/i.test(k)) console.log(`  ${k}:`, JSON.stringify(d[k]));
  }
  console.log('  promo_linked_ids:', JSON.stringify(d.promo_linked_ids).slice(0, 300));
  await fs.writeFile('captures/qp2-linked-promo-detail.json', JSON.stringify(d, null, 2));
} else {
  console.log('  No RELOAD/WELCOME promo found');
  console.log(`  list total rows: ${(list?.data?.rows || []).length}, paginations:`, list?.data?.paginations);
  console.log('  First 5 codes:', (list?.data?.rows || []).slice(0, 5).map((r) => r.code));
}
