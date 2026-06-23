#!/usr/bin/env node
// READ-ONLY: resolve catalogs needed to faithfully clone QP2D_dummy-fc0.
//  - QP2 (ibc22/SPADE66) category id 3 -> name
//  - QPRO3/4/10: category id for that name + provider id for KAYA/918KAYA
//  - QPRO3/4/10: supported currencies (MYR/SGD) via /api/bo/currency
import { authedFetch, getAllCategories, getAllGameProviders } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const SRC_CAT_ID = 3;
const TARGETS = ['qpro3', 'qpro4', 'qpro10'];

// 1. QP2 source category 3 name
const srcCats = await getAllCategories(getSite('ibc22'));
const srcCat3 = srcCats.find((c) => c.id === SRC_CAT_ID);
console.log(`SRC (ibc22) category id ${SRC_CAT_ID} = ${srcCat3 ? `"${srcCat3.name}"` : 'NOT FOUND'}`);
console.log('  (all ibc22 cats:', srcCats.map((c) => `${c.id}:${c.name}`).join(', '), ')');

const wantCatName = String(srcCat3?.name || '').toUpperCase();

// 2. Per target: matching category id + KAYA provider + currencies
for (const t of TARGETS) {
  const site = getSite(t);
  console.log(`\n==== ${t} (${site.loginMerchantCode}) ====`);
  try {
    const [cats, gps, cur] = await Promise.all([
      getAllCategories(site),
      getAllGameProviders(site),
      authedFetch(site, '/api/bo/currency').catch((e) => ({ _err: e.message })),
    ]);
    const catMatch = cats.find((c) => String(c.name || '').toUpperCase() === wantCatName);
    console.log(`  category "${wantCatName}": ${catMatch ? `id=${catMatch.id}` : 'NOT INSTALLED'}`);
    const kaya = gps.rows.find((r) =>
      ['KAYA', '918KAYA'].includes(String(r.code || '').toUpperCase()) ||
      ['KAYA', '918KAYA'].includes(String(r.name || '').toUpperCase()));
    console.log(`  KAYA provider: ${kaya ? `id=${kaya.id} code=${kaya.code} name="${kaya.name}"` : 'NOT INSTALLED'}`);
    const curRows = cur?.data?.rows || cur?.data || [];
    const curList = (Array.isArray(curRows) ? curRows : []).map((c) => `${c.id}:${c.code || c.currency || c.name}`);
    console.log(`  currencies: ${curList.join(', ') || '(unknown shape)'}`);
  } catch (e) {
    console.log(`  ERROR: ${e.message.slice(0, 160)}`);
  }
}
