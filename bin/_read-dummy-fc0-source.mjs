#!/usr/bin/env node
// READ-ONLY: dump full source config of QP2D_dummy-fc0 (id 134) from the QP2
// BO (ibc22, merchant SPADE66=4) and probe QPRO3/4/10 for the same code.
import { authedFetch, findPromotionByCode } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const SRC_SITE = 'ibc22';
const SRC_ID = 134;
const SRC_CODE = 'QP2D_dummy-fc0';
const SRC_MERCHANT_ID = 4; // SPADE66
const TARGETS = ['qpro3', 'qpro4', 'qpro10'];

const site = getSite(SRC_SITE);

// 1. Raw detail (main + currency + names)
const [d, c, n] = await Promise.all([
  authedFetch(site, `/api/bo/promotion/${SRC_ID}`),
  authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${SRC_ID}`),
  authedFetch(site, `/api/bo/promotionname?promotion_id=${SRC_ID}`),
]);
console.log('==== RAW MAIN (/api/bo/promotion/134 .data.rows) ====');
console.log(JSON.stringify(d.data.rows, null, 2));
console.log('\n==== CURRENCY ROWS ====');
console.log(JSON.stringify(c.data.rows, null, 2));
console.log('\n==== NAME ROWS ====');
console.log(JSON.stringify(n.data.rows, null, 2));

// 2. Listing row (exposes dialog_popup_list, member fields, etc.)
const list = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(SRC_CODE)}&merchant_id=${SRC_MERCHANT_ID}&perPage=5`);
const lrow = (list.data?.rows || []).find((r) => r.code === SRC_CODE);
console.log('\n==== LISTING ROW (summary, dialog/member fields) ====');
console.log(JSON.stringify(lrow, null, 2));

// 3. Probe targets for existing code
console.log('\n==== TARGET PROBE (does QP2D_dummy-fc0 already exist?) ====');
for (const t of TARGETS) {
  try {
    const ts = getSite(t);
    const hit = await findPromotionByCode(ts, SRC_CODE);
    console.log(`  ${t} (${ts.loginMerchantCode}): ${hit ? `EXISTS id=${hit.id} status=${hit.status}` : 'not found'}`);
  } catch (e) {
    console.log(`  ${t}: ERROR ${e.message.slice(0, 120)}`);
  }
}
