#!/usr/bin/env node
// Verify that category-restricted promos generate the correct provider subsets.

import { buildApiPlan as buildQproPlan } from '../src/api-mapper-qpro.js';
import { buildApiPlan as buildQp2Plan  } from '../src/api-mapper-qp2.js';
import { getSite } from '../src/sites.js';

const SITE_QPRO = getSite('qpro1');
const SITE_QP2  = getSite('ibc22');

function makeResolved(bonus_type, categories_only) {
  return {
    bonus_type,
    handle: 'TEST',
    promo_code: 'TEST_CAT_PROVIDER',
    currencies: ['MYR'],
    regions: ['MY'],
    brands: ['QPRO1'],
    parsed: { bonus_rate_pct: 20, max_bonus: 200, min_deposit: 50, to_multiplier: 10 },
    promotion_name_en: 'Test',
    promotion_name_zh_id: 'Test ZH',
    instructions: { categories_only, add_test_prefix: false, code_prefixes: [], external_refs: [], raw_signals: [] },
  };
}

async function testQpro(label, categories_only) {
  const plan = await buildQproPlan(makeResolved('Deposit', categories_only), { brand: 'QPRO1', site: SITE_QPRO });
  const body = plan.promotion;
  const gpIds = Object.values(body.game_provider_ids || {});
  const catIds = Object.values(body.promotion_category_turnover || {});
  console.log(`\nQPRO1 [${label}] categories_only=${JSON.stringify(categories_only)}`);
  console.log(`  promotion_category_turnover: ${JSON.stringify(catIds)} (expect non-empty)`);
  console.log(`  game_provider_ids count: ${gpIds.length} (expect << 70)`);
}

async function testQp2(label, categories_only) {
  const plan = await buildQp2Plan(makeResolved('Deposit', categories_only), { brand: 'QP2A', site: SITE_QP2 });
  const body = plan.promotion;
  const gpCodes = Object.values(body.game_provider_codes || {});
  const catIds  = Object.values(body.promotion_category_ids || {});
  const targetCodes = Object.values(body.target?.game_provider_codes || {});
  console.log(`\nQP2A [${label}] categories_only=${JSON.stringify(categories_only)}`);
  console.log(`  promotion_category_ids: ${JSON.stringify(catIds)} (expect non-empty)`);
  console.log(`  game_provider_codes (PUT numeric): ${gpCodes.length} entries → ${gpCodes.join(', ')}`);
  console.log(`  target.game_provider_codes: ${targetCodes.join(', ')}`);
}

try {
  await testQpro('SPORT',       ['SPORT']);
  await testQpro('LIVE CASINO', ['LIVE CASINO']);
  await testQpro('SLOTS',       ['SLOTS']);

  await testQp2('SPORT',       ['SPORT']);
  await testQp2('LIVE CASINO', ['LIVE CASINO']);
  await testQp2('SLOTS',       ['SLOTS']);

  console.log('\n✅ All tests ran without error.');
} catch (e) {
  console.error('\n❌', e.message);
  process.exit(1);
}
