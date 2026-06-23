// Attempt #2: Use the SAME 180-ID deposit_options that worked on promo 1208
// (FT_REL_100PCT_25X_WCFTD — same Reload type, same site, created today by jascinta).
// Hypothesis: the auto-fetched 115-ID set tripped a silent validator; the operator-
// proven 180-ID set should persist.

import { readFileSync } from 'fs';
import { buildApiPlan } from '../src/api-mapper-qp2.js';
import { updatePromotion, readDialogForPreservation, authedFetch } from '../src/api-client.js';

const PROMO_ID = 1209;
const TEMPLATE_ID = 1139;
const SITE = 'ibc22';
const BRAND = 'QP2C';
const CODE = 'REL_30PCT_5X_MIN1000';

// Pull the working SGD deposit_options from promo 1208 (live capture).
const ref = await authedFetch(SITE, '/api/bo/promotioncurrency?promotion_id=1208');
const refSgd = (ref.data?.rows||[]).find(c => c.currency === 'SGD');
const workingSgdIds = refSgd?.deposit_options || [];
console.log('reference SGD deposit_options from #1208:', workingSgdIds.length, 'IDs');

const resolved = JSON.parse(readFileSync('./captures/requests/P164-r165.json', 'utf8'));
const plan = await buildApiPlan(resolved, { brand: BRAND, site: SITE });
const dialog = await readDialogForPreservation(SITE, CODE);
const body = plan.buildUpdate(PROMO_ID, TEMPLATE_ID, dialog);

// Overwrite SGD's deposit_options with the proven 180-ID set
for (const [k, v] of Object.entries(body.promotion_currency)) {
  if (v.currency === 'SGD') {
    console.log('overriding SGD block deposit_options:', v.deposit_options.length, '→', workingSgdIds.length);
    v.deposit_options = workingSgdIds;
  }
}

console.log('PUT…');
const res = await updatePromotion(SITE, PROMO_ID, body);
console.log('  success:', res.success);

console.log('\nAFTER:');
const raw = await authedFetch(SITE, `/api/bo/promotioncurrency?promotion_id=${PROMO_ID}`);
for (const r of (raw.data?.rows||[])) {
  console.log('  id=' + r.id, 'currency=' + r.currency, 'settings_currency_id=' + r.settings_currency_id, 'min=' + r.min_deposit, 'max_bonus=' + r.max_bonus, 'deposit_options.len=' + (r.deposit_options?.length||0));
}
