// Deactivate promo 1310 (FT_88FS_10X_060_GOO, 88 spins) on QP2A
// This was the wrong P002 save committed before the 100-spin change.
import { buildApiPlan } from '../src/api-mapper-qp2.js';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('qp2a');
const PROMO_ID = 1310;

// Reconstruct resolved for the old 88-spin P002
const resolved = {
  handle: 'P002-old',
  promo_code: 'FT_88FS_10X_060_GOO',
  promotion_name_en: '88 Free Spins on Gate Of Olympus',
  promotion_name_zh_id: '88 次免费旋转 — Gate Of Olympus',
  bonus_type: 'Free Spin',
  bonus_sub_type: 'Reload',
  validity_days: 1,
  rewards_validity_days: 1,
  recurring: true,
  currencies: ['MYR', 'SGD'],
  locales: ['MY_EN', 'MY_ZH', 'SG_EN', 'SG_ZH'],
  regions: ['MY', 'SG'],
  parsed: {
    spin_count: 88,
    value_per_spin: 0.60,
    min_deposit: 100,
    to_multiplier: 10,
    game: 'Gate Of Olympus',
  },
  per_currency_overrides: {
    MYR: { min_deposit: 100 },
    SGD: { min_deposit: 100 },
  },
  instructions: {},
};

console.log(`→ Building PUT body for promo ${PROMO_ID}…`);
const plan = await buildApiPlan(resolved, { brand: 'QP2A', site });
const putBody = plan.buildUpdate(PROMO_ID, 0, null);
putBody.status = 0;

console.log(`→ Deactivating promo ${PROMO_ID} (FT_88FS_10X_060_GOO)…`);
const result = await authedFetch(site, `/api/bo/promotion/${PROMO_ID}`, { method: 'PUT', body: putBody });
console.log('BO response:', JSON.stringify(result?.data ?? result ?? 'no data'));
console.log('\n✓ Done — promo 1310 deactivated (status=0).');
