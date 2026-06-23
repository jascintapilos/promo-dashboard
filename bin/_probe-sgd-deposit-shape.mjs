// The validator complains "Deposit options is required" even when we send an
// array of 180 numeric IDs. Try different element shapes.

import { authedFetch } from '../src/api-client.js';

const SITE = 'ibc22';
const PROMO_ID = 1209;

const ref = await authedFetch(SITE, '/api/bo/promotioncurrency?promotion_id=1208');
const sgdIds = (ref.data?.rows||[]).find(c => c.currency === 'SGD').deposit_options;

// Filter to currently-active SGD bank accounts (fresh from BO)
const accts = await authedFetch(SITE, '/api/bo/merchantbank/accounts?paginate=false');
const activeSgd = (accts.data?.rows||[])
  .filter(a => a.currency_id === 3 && a.purpose === 1)
  .map(a => a.id);
console.log('Fresh active SGD ids:', activeSgd.length);
console.log('1208 reference set:', sgdIds.length);
const inter = sgdIds.filter(id => activeSgd.includes(id));
console.log('Intersection (still valid):', inter.length);

function base() {
  return {
    promotion_id: PROMO_ID,
    settings_currency_id: 3,
    currency: 'SGD',
    currency_id: '3',  // try string
    gmt: '+8',
    start_time: '00:00:00',
    end_time: '23:59:59',
    max_total_applications: 1,
    max_total_bonus: 1,
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
  };
}

const cases = [
  { label: 'fresh active intersection (numeric)',     payload: inter },
  { label: 'fresh active SGD all (numeric)',          payload: activeSgd },
  { label: 'fresh active SGD all (stringified)',      payload: activeSgd.map(String) },
  { label: 'object-map of fresh active',              payload: Object.fromEntries(activeSgd.map((id,i)=>[String(i),id])) },
  { label: 'one ID only',                             payload: [activeSgd[0]] },
];

for (const c of cases) {
  const body = { ...base(), deposit_options: c.payload };
  process.stdout.write('  ' + c.label.padEnd(50) + ' → ');
  try {
    const res = await authedFetch(SITE, '/api/bo/promotioncurrency', { method: 'POST', body });
    console.log('SUCCESS id=' + res.data?.rows?.id);
    break;
  } catch (e) {
    const m = String(e.message).match(/HTTP (\d+)[\s\S]*?\n\s*(.+)/);
    console.log(m ? `${m[1]} ${m[2].slice(0,90)}` : e.message.slice(0,100));
  }
  await new Promise(r => setTimeout(r, 800));
}
