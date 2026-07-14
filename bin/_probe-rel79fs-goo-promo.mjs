// READ-ONLY: pull promotion detail + currency + names for REL_79FS_GOO_100425 on ibc22.
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('ibc22');
const CODE = 'REL_79FS_GOO_100425';

const list = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(CODE)}&perPage=10`);
const rows = list?.data?.rows || [];
console.log(`list matches: ${rows.length}`);
for (const r of rows) console.log(`  id=${r.id} code=${r.code} status=${r.status} type=${r.promotion_type} sub=${r.promotion_sub_type}`);

const target = rows.find(r => r.code === CODE) || rows[0];
if (!target) { console.log('no promo found'); process.exit(0); }

const det = await authedFetch(site, `/api/bo/promotion/${target.id}`);
const p = det?.data?.rows || det?.data;
const keys = ['id','code','promotion_type','promotion_sub_type','min_transfer','max_transfer','rounds','free_credit_amount',
  'amount_per_line','value_per_spin','turnover_multiplier','to_multiplier','rollover','validity','validity_days',
  'reward_validity','rewards_validity','claim_validity','game_provider_codes','categories','merchant_ids',
  'message_template_id','auto_reward','start_date','end_date'];
console.log('\n=== promotion detail (selected keys) ===');
for (const k of keys) if (p && p[k] !== undefined) console.log(`  ${k}: ${JSON.stringify(p[k])}`);

console.log('\n=== ALL top-level keys ===');
console.log(Object.keys(p || {}).join(', '));

// currency rows
const cur = await authedFetch(site, `/api/bo/promotion/${target.id}/promotioncurrency`);
const crows = cur?.data?.rows || cur?.data || [];
console.log(`\n=== promotioncurrency (${Array.isArray(crows)?crows.length:'?'} rows) ===`);
console.log(JSON.stringify(crows, null, 2).slice(0, 3000));

// names
try {
  const nm = await authedFetch(site, `/api/bo/promotion/${target.id}/promotionname`);
  console.log('\n=== promotionname ===');
  console.log(JSON.stringify(nm?.data?.rows || nm?.data, null, 2).slice(0, 2000));
} catch (e) { console.log('promotionname fetch err:', e.message.split('\n')[0]); }
