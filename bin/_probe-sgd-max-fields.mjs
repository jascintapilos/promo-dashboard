// Validator quirk: with max_total_applications/max_total_bonus=0 → "must be > 0"
// With them = null → "Deposit options is required"
// Try alternate forms: omit, empty string, positive int, very large.

import { authedFetch } from '../src/api-client.js';

const SITE = 'ibc22';
const PROMO_ID = 1209;

const ref = await authedFetch(SITE, '/api/bo/promotioncurrency?promotion_id=1208');
const sgdIds = (ref.data?.rows||[]).find(c => c.currency === 'SGD').deposit_options;

function baseBlock() {
  return {
    promotion_id: PROMO_ID,
    settings_currency_id: 3,
    currency: 'SGD',
    currency_id: 3,
    gmt: '+8',
    start_time: '00:00:00',
    end_time: '23:59:59',
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
    deposit_options: sgdIds,
  };
}

const cases = [
  { label: 'omit max_total_*',                 patch: {} },
  { label: 'max_total_applications=null, max_total_bonus=null', patch: { max_total_applications: null, max_total_bonus: null } },
  { label: 'max_total_applications="", max_total_bonus=""',     patch: { max_total_applications: '', max_total_bonus: '' } },
  { label: 'max_total_applications=1, max_total_bonus=1',       patch: { max_total_applications: 1, max_total_bonus: 1 } },
  { label: 'max_total_applications=999999, max_total_bonus=999999', patch: { max_total_applications: 999999, max_total_bonus: 999999 } },
];

for (const c of cases) {
  const body = { ...baseBlock(), ...c.patch };
  process.stdout.write('  ' + c.label.padEnd(70) + ' → ');
  try {
    const res = await authedFetch(SITE, '/api/bo/promotioncurrency', { method: 'POST', body });
    console.log('SUCCESS id=' + res.data?.rows?.id);
    // Verify SGD is now present
    const v = await authedFetch(SITE, '/api/bo/promotioncurrency?promotion_id=' + PROMO_ID);
    const has = (v.data?.rows||[]).find(r => r.currency === 'SGD');
    if (has) console.log('     ✓ SGD row persisted: id=' + has.id + ', max_total_apps=' + has.max_total_applications + ', max_total_bonus=' + has.max_total_bonus);
    break;
  } catch (e) {
    const m = String(e.message).match(/HTTP (\d+)[\s\S]*?\n\s*(.+)/);
    console.log(m ? `${m[1]} ${m[2].slice(0,90)}` : e.message.slice(0,100));
  }
}
