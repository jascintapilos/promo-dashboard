import test from 'node:test';
import assert from 'node:assert/strict';
import { runAutoChecks } from '../src/qc-dashboard/auto-checks.js';

test('not-found fetch state produces only the clear not-found auto finding', () => {
  const findings = runAutoChecks({
    brand: 'QP2A',
    code: 'MISSING_CODE',
    notFound: true,
    detail: 'Code MISSING_CODE not found on QP2A',
    checkCandidate: { platform: 'qpro', brand: 'QP2A', code: 'MISSING_CODE' },
  });

  assert.deepEqual(findings, [{
    severity: 'FAIL',
    check: 'code-not-found',
    field: 'promoCode',
    message: 'Code MISSING_CODE not found on QP2A',
  }]);
});
