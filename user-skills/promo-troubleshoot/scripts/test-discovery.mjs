import assert from 'node:assert/strict';
import { extractTemplateTerms, expectedTotal, parseDiscoveryQuery, rankCandidates } from './discovery-core.mjs';

const query = parseDiscoveryQuery('Probe QP2D MY. Welcome bonus 120% depo 50 get 110, depo 300 get 660, can play for sports.');
assert.deepEqual(query.examples, [{ deposit: 50, total: 110 }, { deposit: 300, total: 660 }]);
assert.equal(query.merchant_id, 4);
assert.equal(query.category, 'Sports');

const candidates = [
  {
    code: 'FT_WELC_SLOTS_TSM_15TO', name: 'Welcome Slots', status: 1, promo_type: 2,
    merchant_ids: [4], categories: ['Slots'],
    currencies: [{ currency: 'MYR', min_deposit: 30, bonus_rate: 100, max_bonus: 300 }],
  },
  {
    code: 'WELC_WC120PCT_10X', name: 'Deposit Welcome', status: 1, promo_type: 2,
    merchant_ids: [4], categories: ['Sports'],
    currencies: [{ currency: 'MYR', min_deposit: 30, bonus_rate: 120, max_bonus: 360 }],
  },
];
const ranked = rankCandidates(candidates, query);
assert.equal(ranked.candidates[0].code, 'WELC_WC120PCT_10X');
assert.equal(ranked.confidence, 'HIGH');
assert.match(ranked.candidates[1].contradictions.join(' '), /Slots, not Sports/);
assert.match(ranked.candidates[1].contradictions.join(' '), /300 predicts 600, not 660/);
assert.equal(expectedTotal(50, 120, 360), 110);
assert.equal(expectedTotal(300, 120, 360), 660);

const html = '<table><tr><th>Min Deposit</th><th>Bonus Percentage</th><th>Max Bonus</th><th>Turnover</th></tr>'
  + '<tr><td>MYR 30</td><td>120%</td><td>MYR 300</td><td>10x</td></tr></table>';
assert.deepEqual(extractTemplateTerms(html), { min_deposit: 30, bonus_rate: 120, max_bonus: 300, turnover: 10 });
assert.notEqual(extractTemplateTerms(html).max_bonus, 360, 'template mismatch must remain visible');

const ambiguous = rankCandidates([candidates[1], { ...candidates[1], code: 'WELC_COPY' }], query);
assert.equal(ambiguous.confidence, 'AMBIGUOUS');

console.log('discovery regression tests: PASS');
