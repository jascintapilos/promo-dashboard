import test from 'node:test';
import assert from 'node:assert/strict';
import { computeVerdict } from '../src/qc-dashboard/verdict-engine.js';

test('missing required data never yields SAFE', () => {
  const result = computeVerdict({
    findings: [],
    details: {
      promoCode: 'FT_TEST',
      promoName: 'unavailable',
      promoType: 'Deposit',
      currency: 'MYR',
      validity: '2026-01-01 to 2026-12-31',
      rewardValidity: '7',
      status: 'Active',
    },
  });
  assert.equal(result.verdict, 'NOT_SAFE');
  assert.equal(result.findings.some((f) => f.check === 'required-field-unavailable'), true);
});

test('clean complete data yields SAFE', () => {
  const result = computeVerdict({
    findings: [],
    details: {
      promoCode: 'FT_TEST',
      promoName: 'Test Promo',
      promoType: 'Deposit',
      currency: 'MYR',
      validity: '2026-01-01 to 2026-12-31',
      rewardValidity: '7',
      status: 'Active',
    },
  });
  assert.equal(result.verdict, 'SAFE');
});
