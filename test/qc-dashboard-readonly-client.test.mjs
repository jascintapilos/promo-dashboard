import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertAllowedIgmpEndpoint,
  assertReadonlyHttp,
  readonlyIgmpPost,
} from '../src/qc-dashboard/readonly-client.js';

test('read-only HTTP transport rejects non-GET promotion requests', () => {
  assert.throws(
    () => assertReadonlyHttp('/api/bo/promotion/123', { method: 'PUT' }),
    /rejected PUT \/api\/bo\/promotion\/123/,
  );
  assert.throws(
    () => assertReadonlyHttp('/api/bo/promotion', { method: 'POST' }),
    /rejected POST \/api\/bo\/promotion/,
  );
});

test('IGMP allowlist rejects write endpoint', () => {
  assert.throws(
    () => assertAllowedIgmpEndpoint('/PM/AddBonus'),
    /rejected \/PM\/AddBonus/,
  );
});

test('IGMP allowlist allows GetPromotionInfoByCode', async () => {
  const calls = [];
  const result = await readonlyIgmpPost('ws1-v3-my', '/PM/GetPromotionInfoByCode', { PromotionCode: 'X' }, {
    igmpPostImpl: async (siteId, endpoint, body) => {
      calls.push({ siteId, endpoint, body });
      return { data: { PromotionId: 1 } };
    },
  });
  assert.deepEqual(result, { data: { PromotionId: 1 } });
  assert.deepEqual(calls, [{
    siteId: 'ws1-v3-my',
    endpoint: '/PM/GetPromotionInfoByCode',
    body: { PromotionCode: 'X' },
  }]);
});
