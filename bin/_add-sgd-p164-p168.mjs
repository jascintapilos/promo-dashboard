// Add the missing SGD currency block to QP2C P164-P168 (#1209-#1213).
// POST /api/bo/promotioncurrency with:
//   - deposit_options: array of 180 SGD bank-account IDs (proven set from #1208)
//   - max_total_applications: null  (form says blank=unlimited; 0 is rejected)
//   - max_total_bonus: null
//   - max_withdraw: null
// Reads bonus_rate / min_deposit / max_bonus from each fixture.

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

// Pull the proven 180-ID SGD deposit_options set from a sibling Reload promo
const ref = await authedFetch(SITE, '/api/bo/promotioncurrency?promotion_id=1208');
const sgdIds = (ref.data?.rows||[]).find(c => c.currency === 'SGD').deposit_options;
console.log('Using SGD deposit_options set: ' + sgdIds.length + ' bank IDs (from sibling promo #1208)\n');

let pass = 0, fail = 0;
for (const t of TARGETS) {
  const fixture = JSON.parse(readFileSync('./captures/requests/' + t.file, 'utf8'));
  const r = fixture.parsed;

  // Skip if SGD already exists (idempotency)
  const exist = await authedFetch(SITE, '/api/bo/promotioncurrency?promotion_id=' + t.promoId);
  if ((exist.data?.rows||[]).some(c => c.currency === 'SGD')) {
    console.log(`  ${t.rn} #${t.promoId} — SGD already exists, skipping`);
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
    max_total_applications: null,
    max_total_bonus: null,
    bonus_type: 2,                  // Percentage
    bonus_amount: 0,
    bonus_rate: r.bonus_rate_pct,   // 30
    min_transfer: r.min_deposit,    // 1000 / 1500 / 2000 / 2500 / 3500
    min_deposit: r.min_deposit,
    bypass_min_deposit: 0,
    max_withdraw_type: 1,
    max_withdraw: null,
    max_bonus: r.max_bonus,         // 600
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
    console.log(m ? `FAIL ${m[1]} ${m[2]}` : e.message.slice(0,200));
    fail++;
  }
}

console.log(`\n══ ${pass} ok, ${fail} fail ══`);

// Verify final state
console.log('\nFinal state:');
for (const t of TARGETS) {
  const r = await authedFetch(SITE, '/api/bo/promotioncurrency?promotion_id=' + t.promoId);
  const cs = (r.data?.rows||[]).map(c => c.currency).sort().join(',');
  console.log(`  ${t.rn} #${t.promoId}: [${cs}]`);
}
process.exit(fail > 0 ? 1 : 0);
