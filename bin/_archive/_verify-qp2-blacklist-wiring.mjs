// Verify that buildApiPlan (api-mapper-qp2) now resolves + sets blacklist_template_id.
// Uses a real ibc22 session but does NOT commit anything.
// Run: node bin/_verify-qp2-blacklist-wiring.mjs

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildApiPlan } from '../src/api-mapper-qp2.js';
import { getSite } from '../src/sites.js';

const site = getSite('ibc22');

// Minimal resolved records covering the three cases we need to verify:
//   1. Deposit/all-cats → "All games" fallback expected (id=1 on QP2)
//   2. FS → "Slots Only" shortcut (id=5 on QP2)
//   3. categories_only override (Live Casino → "Live Casino Only", id=3 on QP2)
const base = {
  promo_code: '_DRY_TEST',
  bonus_type: 'Deposit',
  bonus_sub_type: null,
  validity_days: 7,
  rewards_validity_days: 7,
  recurring: false,
  promotion_name_en: 'DRY TEST',
  promotion_name_zh_id: null,
  currencies: ['MYR'],
  locales: ['MY_EN'],
  per_currency_overrides: { MYR: { min_deposit: 50, max_bonus: 200, bonus_rate_pct: 30 } },
  parsed: { to_multiplier: 5, bonus_rate_pct: 30, min_deposit: 50, max_bonus: 200 },
  inbox_message: false,
  popup_dialog: false,
  max_per_player: 1,
  daily_max: 1,
  instructions: {},
};

const cases = [
  { label: 'Deposit (all-cats) → "All games" expected', resolved: base },
  {
    label: 'Free Spin → "Slots Only" expected',
    resolved: {
      ...base,
      bonus_type: 'Free Spin',
      promo_code: '_DRY_TEST_FS',
      parsed: { ...base.parsed, game_provider: 'PP2 - Pragmatic Play', game: 'vs20olympgate', spin_count: 88, value_per_spin: 1.0, min_deposit: 50 },
    },
  },
  {
    label: 'categories_only=[LIVE CASINO] → "Live Casino Only" expected',
    resolved: {
      ...base,
      promo_code: '_DRY_TEST_LC',
      instructions: { categories_only: ['LIVE CASINO'] },
    },
  },
];

let pass = 0; let fail = 0;
for (const { label, resolved } of cases) {
  try {
    const plan = await buildApiPlan(resolved, { brand: 'QP2A', site });
    const bid = plan.promotion.blacklist_template_id;
    const bidPut = plan.buildUpdate(0, 0, null).blacklist_template_id;
    if (bid == null) throw new Error(`POST blacklist_template_id is null`);
    if (bidPut == null) throw new Error(`PUT blacklist_template_id is null`);
    if (bid !== bidPut) throw new Error(`POST id=${bid} ≠ PUT id=${bidPut}`);
    console.log(`  ✓  ${label}  →  template id=${bid} (plan.blacklistTemplateId=${plan.blacklistTemplateId})`);
    pass++;
  } catch (e) {
    console.error(`  ✗  ${label}: ${e.message}`);
    fail++;
  }
}

console.log(`\n${pass + fail} cases: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
