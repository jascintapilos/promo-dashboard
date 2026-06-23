// One-shot fix: re-PUT QP2C/ibc22 promotion #1209 (P164) with both MYR+SGD
// currency blocks. The initial POST returned 500 (the BO created the row
// anyway) and the recovery PUT silently dropped SGD. Re-issuing the PUT with
// the same plan-builder pipeline restores the SGD block.

import { readFileSync } from 'fs';
import { buildApiPlan } from '../src/api-mapper-qp2.js';
import { updatePromotion, readDialogForPreservation, getPromotionDetail, authedFetch } from '../src/api-client.js';

const PROMO_ID = 1209;
const TEMPLATE_ID = 1139;
const SITE = 'ibc22';
const BRAND = 'QP2C';
const CODE = 'REL_30PCT_5X_MIN1000';
const FIXTURE = './captures/requests/P164-r165.json';

const resolved = JSON.parse(readFileSync(FIXTURE, 'utf8'));

console.log('── BEFORE ──');
const before = await getPromotionDetail(SITE, PROMO_ID);
console.log('  currencies:', before.currencies.join(','));
console.log('  per_currency:', JSON.stringify(before.per_currency_overrides));

console.log('\n── building plan ──');
const plan = await buildApiPlan(resolved, { brand: BRAND, site: SITE });
const dialog = await readDialogForPreservation(SITE, CODE);
console.log('  dialog preserved: id =', dialog?.id);
const body = plan.buildUpdate(PROMO_ID, TEMPLATE_ID, dialog);
console.log('  promotion_currency keys:', Object.keys(body.promotion_currency).join(','));
for (const [k, v] of Object.entries(body.promotion_currency)) {
  console.log('    [' + k + '] currency=' + v.currency + ' currency_id=' + v.currency_id + ' deposit_options.len=' + (v.deposit_options?.length ?? 'undefined'));
}

console.log('\n── PUT /api/bo/promotion/' + PROMO_ID + ' ──');
const res = await updatePromotion(SITE, PROMO_ID, body);
console.log('  success:', res.success, '| msg:', JSON.stringify(res.message));

console.log('\n── AFTER (raw promotioncurrency rows) ──');
const raw = await authedFetch(SITE, `/api/bo/promotioncurrency?promotion_id=${PROMO_ID}`);
for (const r of (raw.data?.rows || [])) {
  console.log('  id=' + r.id + ' currency=' + r.currency + ' settings_currency_id=' + r.settings_currency_id + ' min_dep=' + r.min_deposit + ' max_bonus=' + r.max_bonus);
}
