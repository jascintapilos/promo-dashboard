#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveFreeSpinBet } from '../src/free-spin-bet.js';
import { validateFreeSpinPromotionPlan } from '../src/free-spin-preflight.js';
import { buildActions as buildQproActions } from '../src/bo-mapper-qpro.js';
import { buildActions as buildQp2Actions } from '../src/bo-mapper-qp2.js';

const cases = [
  { provider: 'PP2 - Pragmatic Play', valuePerSpin: 0.50, expected: 0.02 },
  { provider: 'PP', valuePerSpin: 0.20, expected: 0.01 },
  { provider: 'Playtech', valuePerSpin: 0.20, expected: 0.20 },
  { provider: 'PTI - Playtech', valuePerSpin: 0.30, expected: 0.30 },
  { provider: 'PP2', valuePerSpin: 99, amountPerLine: 0.125, expected: 0.125 },
];
for (const test of cases) {
  assert.equal(resolveFreeSpinBet(test).amountPerLine, test.expected, test.provider);
}
assert.throws(() => resolveFreeSpinBet({ provider: 'Unknown', valuePerSpin: 0.5 }), /Unsupported/);
assert.throws(() => resolveFreeSpinBet({ provider: 'PP2', valuePerSpin: 0 }), /Invalid/);

const base = {
  promo_code: 'TEST_FS_CONFORMANCE',
  bonus_type: 'Free Spin',
  bonus_sub_type: 'Reload',
  currencies: ['MYR'],
  per_currency_overrides: {},
  parsed: {
    game: 'Test Game', spin_count: 88, value_per_spin: 0.5,
    min_deposit: 100, to_multiplier: 10,
  },
};

function currencyApl(actions) {
  return actions.find((action) => action.kind === 'popup_fill_currency').rows[0].amount_per_line;
}
for (const provider of ['PP2 - Pragmatic Play', 'Playtech']) {
  const resolved = { ...base, parsed: { ...base.parsed, game_provider: provider } };
  const expected = provider === 'Playtech' ? 0.5 : 0.02;
  assert.equal(currencyApl(buildQproActions(resolved, { brand: 'QPRO2' })), expected, `QPRO browser ${provider}`);
  assert.equal(currencyApl(buildQp2Actions(resolved, { brand: 'QP2A' })), expected, `QP2 browser ${provider}`);
}

const validPlan = {
  free_spin_game_provider_id: 69,
  free_spin_game_code: 'vs20test',
  game_provider_ids: { 0: 69 },
  target: { 0: { game_provider_ids: { 0: 69 } } },
  promotion_currency: { 0: { currency: 'MYR', rounds: 88, amount_per_line: 0.02, lines: 0, coins: 0 } },
};
assert.deepEqual(validateFreeSpinPromotionPlan(validPlan, { platform: 'qpro' }), []);
assert.ok(validateFreeSpinPromotionPlan({ ...validPlan, free_spin_game_code: null }, { platform: 'qpro' }).length > 0);
assert.ok(validateFreeSpinPromotionPlan({ ...validPlan, promotion_currency: { 0: { rounds: 0, amount_per_line: 0 } } }, { platform: 'qpro' }).length > 0);

const orchestrator = await readFile(new URL('./canary-multi-brand.js', import.meta.url), 'utf8');
assert.match(orchestrator, /runSequential\(qp2Jobs\)/, 'QP2 jobs must remain serialized');

console.log('Free-spin conformance: PASS');
