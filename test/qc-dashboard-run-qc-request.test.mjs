import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRunQcRequest } from '../src/qc-dashboard/run-qc-request.js';

test('run-qc input validation rejects more than five codes', () => {
  const result = normalizeRunQcRequest({
    brand: 'QP2A',
    codes: ['A', 'B', 'C', 'D', 'E', 'F'],
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.error, /at most 5 promo codes/);
});
