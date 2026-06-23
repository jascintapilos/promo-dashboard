#!/usr/bin/env node
// Live confirmation: read source at QP2's BO + show dummy-fc0 state on QPRO3/4/10.
import { authedFetch, findPromotionByCode } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

// 1. SOURCE at QP2's BO (ibc22, merchant SPADE66=QP2D), id 134
const qp2 = getSite('ibc22');
const d = await authedFetch(qp2, '/api/bo/promotion/134');
const c = await authedFetch(qp2, '/api/bo/promotioncurrency?promotion_id=134');
const m = d.data.rows;
console.log('==== QP2 BO SOURCE ====');
console.log(`  code=${m.code}  (merchant SPADE66 / QP2D)  internal name="${m.name}"`);
console.log(`  type=${m.promo_type}(3=FC) sub=${m.promo_sub_type}  validity=${m.validity}/reward=${m.reward_validity}  status=${m.status}`);
console.log(`  category_ids=${JSON.stringify(m.promotion_category_ids)}  target=${JSON.stringify((m.target||[]).map(t=>({mult:t.multiplier,gp:t.game_provider_codes})))}`);
console.log(`  currencies=${(c.data.rows||[]).map(x=>`${x.currency}(fc=${x.free_credit_amount})`).join(', ')}`);

// 2. STATE on QPRO3/4/10 for the new short code
console.log('\n==== QPRO state for "dummy-fc0" ====');
for (const b of ['qpro3','qpro4','qpro10']) {
  const s = getSite(b);
  const hit = await findPromotionByCode(s, 'dummy-fc0');
  console.log(`  ${b} (${s.loginMerchantCode}): ${hit ? `EXISTS id=${hit.id} status=${hit.status} type=${hit.promo_type}` : 'MISSING'}`);
}
