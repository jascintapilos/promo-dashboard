// Attempt #3: POST /api/bo/promotioncurrency directly to add the SGD row.
// Hypothesis: PUT /promotion silently ignores NEW currency blocks; have to
// use the per-row endpoint.

import { authedFetch } from '../src/api-client.js';

const PROMO_ID = 1209;
const SITE = 'ibc22';

// Pull the working SGD row from promo 1208 as a template
const ref = await authedFetch(SITE, '/api/bo/promotioncurrency?promotion_id=1208');
const refSgd = (ref.data?.rows||[]).find(c => c.currency === 'SGD');
console.log('reference SGD from #1208:', refSgd?.id, 'deposit_options:', refSgd?.deposit_options?.length);

// Build SGD payload for P164: min_dep=1000, max_bonus=600, bonus_rate=30, multiplier=5
const sgdPayload = {
  promotion_id: PROMO_ID,
  settings_currency_id: 3,
  currency: 'SGD',
  currency_id: 3,
  gmt: '+8',
  start_time: '00:00:00',
  end_time: '23:59:59',
  max_balance_claim: null,
  max_total_applications: null,
  max_total_bonus: null,
  bonus_type: 2,
  bonus_amount: 0,
  bonus_rate: 30,
  min_transfer: 1000,
  min_deposit: 1000,
  bypass_min_deposit: 0,
  max_withdraw_type: 1,
  max_withdraw: null,
  max_bonus: 600,
  min_bonus: 0,
  threshold: 0,
  rounds: 0,
  amount_per_line: 0,
  lines: 0,
  coins: 0,
  status: 1,
  reset: 0,
  reset_name: 'None',
  promo_type: 2,
  deposit_options: refSgd.deposit_options,
};

console.log('POST /api/bo/promotioncurrency …');
try {
  const r = await authedFetch(SITE, '/api/bo/promotioncurrency', { method: 'POST', body: sgdPayload });
  console.log('  success:', r.success, '| msg:', JSON.stringify(r.message));
  console.log('  data:', JSON.stringify(r.data, null, 2).slice(0, 500));
} catch (e) {
  console.log('  ERROR:', e.message);
}

console.log('\nAFTER:');
const raw = await authedFetch(SITE, `/api/bo/promotioncurrency?promotion_id=${PROMO_ID}`);
for (const r of (raw.data?.rows||[])) {
  console.log('  id=' + r.id, 'currency=' + r.currency, 'min=' + r.min_deposit, 'max_bonus=' + r.max_bonus);
}
