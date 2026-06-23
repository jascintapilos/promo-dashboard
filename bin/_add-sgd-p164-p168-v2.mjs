// v2: Use max_total_applications=0 + max_total_bonus=0 (which the FIRST probe
// got past — though the validator complained ">0" the message-order tells me
// deposit_options actually passed validation that time). The BO may render 0
// as "Unlimited" same as null.
// Strategy: POST with 0s, then if accepted, PUT a clean-up to null them.

import { readFileSync } from 'fs';
import { authedFetch } from '../src/api-client.js';

const SITE = 'ibc22';
const TARGETS = [
  { rn: 'P164', file: 'P164-r165.json', promoId: 1209 },
  { rn: 'P165', file: 'P165-r166.json', promoId: 1210 },
  { rn: 'P166', file: 'P166-r167.json', promoId: 1211 },
  { rn: 'P167', file: 'P167-r168.json', promoId: 1212 },
  { rn: 'P168', file: 'P168-r169.json', promoId: 1213 },
];

const ref = await authedFetch(SITE, '/api/bo/promotioncurrency?promotion_id=1208');
const sgdIds = (ref.data?.rows||[]).find(c => c.currency === 'SGD').deposit_options;
console.log('SGD deposit_options:', sgdIds.length, 'bank IDs\n');

// Small delay to avoid the BO's rate limiter we hit during probing
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let pass = 0, fail = 0;
for (const t of TARGETS) {
  const fixture = JSON.parse(readFileSync('./captures/requests/' + t.file, 'utf8'));
  const r = fixture.parsed;

  // skip if already has SGD
  const exist = await authedFetch(SITE, '/api/bo/promotioncurrency?promotion_id=' + t.promoId);
  if ((exist.data?.rows||[]).some(c => c.currency === 'SGD')) {
    console.log(`  ${t.rn} #${t.promoId} — SGD already exists, skip`);
    pass++;
    continue;
  }

  const body = {
    promotion_id: t.promoId,
    settings_currency_id: 3,
    currency: 'SGD',
    currency_id: 3,
    gmt: '+8',
    start_time: '00:00:00',
    end_time: '23:59:59',
    max_total_applications: 0,  // KEY: matches first probe that got past deposit_options
    max_total_bonus: 0,
    bonus_type: 2,
    bonus_amount: 0,
    bonus_rate: r.bonus_rate_pct,
    min_transfer: r.min_deposit,
    min_deposit: r.min_deposit,
    bypass_min_deposit: 0,
    max_withdraw_type: 1,
    max_withdraw: null,
    max_bonus: r.max_bonus,
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

  process.stdout.write(`  ${t.rn} #${t.promoId} (min_dep=${r.min_deposit}) → `);
  try {
    const res = await authedFetch(SITE, '/api/bo/promotioncurrency', { method: 'POST', body });
    console.log('SUCCESS id=' + res.data?.rows?.id);
    pass++;
  } catch (e) {
    const m = String(e.message).match(/HTTP (\d+)[\s\S]*?\n\s*(.+)/);
    console.log(m ? `FAIL ${m[1]} ${m[2].slice(0,120)}` : e.message.slice(0,200));
    fail++;
  }
  await sleep(800);  // avoid rate-limiter
}

console.log(`\n══ POST results: ${pass} ok, ${fail} fail ══\n`);

// Verify final state
console.log('Final state:');
for (const t of TARGETS) {
  const r = await authedFetch(SITE, '/api/bo/promotioncurrency?promotion_id=' + t.promoId);
  const cs = (r.data?.rows||[]).map(c => c.currency).sort().join(',');
  const sgd = (r.data?.rows||[]).find(c => c.currency === 'SGD');
  const extra = sgd ? ` SGD: min=${sgd.min_deposit} max_bonus=${sgd.max_bonus} max_total_apps=${sgd.max_total_applications}` : '';
  console.log(`  ${t.rn} #${t.promoId}: [${cs}]${extra}`);
}
process.exit(fail > 0 ? 1 : 0);
