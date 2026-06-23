#!/usr/bin/env node
// Patch P091-P096 QP2C saves: clear max_withdraw on promotion_currency rows.
// Bug: api-mapper-qp2.js Deposit block was setting max_withdraw = max_bonus.
// These are distinct fields — max_bonus is the bonus cap, max_withdraw is
// the withdrawal ceiling. Mapper fixed to default null=Unlimited (per
// feedback_qp2_max_total_unlimited.md). This patches the already-saved
// records.
//
// Usage: node bin/fix-p091-p096-max-withdraw.mjs [--commit]

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const commit = process.argv.includes('--commit');
const site = getSite('ibc22');

const targets = [
  { handle: 'P091', id: 1193, code: 'VIP_REL_30PCT_8X_MIN3000' },
  { handle: 'P092', id: 1194, code: 'VIP_REL_30PCT_8X_MIN6000' },
  { handle: 'P093', id: 1195, code: 'VIP_REL_100PCT_5X_MIN2500' },
  { handle: 'P094', id: 1196, code: 'VIP_REL_100PCT_5X_MIN3500' },
  { handle: 'P095', id: 1197, code: 'VIP_REL_100PCT_5X_MIN4000' },
  { handle: 'P096', id: 1198, code: 'VIP_REL_100PCT_5X_MIN8500' },
];

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`FIX QP2C P091-P096 max_withdraw — ${commit ? 'LIVE' : 'DRY-RUN'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

for (const t of targets) {
  console.log(`\n${t.handle} promotion_id=${t.id} (${t.code})`);
  const pcResp = await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${t.id}&perPage=20`);
  const rows = pcResp.data?.rows || [];
  console.log(`  ${rows.length} promotion_currency row(s)`);
  for (const row of rows) {
    const currencyId = row.settings_currency_id ?? row.currency_id;
    console.log(`    - id=${row.id} currency=${row.currency} max_bonus=${row.max_bonus} max_withdraw=${row.max_withdraw}`);
    if (!commit) continue;
    const body = {
      ...row,
      currency_id: currencyId,
      max_withdraw: null,
      max_total_applications: null,
      max_total_bonus: null,
    };
    await authedFetch(site, `/api/bo/promotioncurrency/${row.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    console.log(`      ✓ PUT promotioncurrency/${row.id} max_withdraw=null`);
  }
}

console.log('\nDone.');
