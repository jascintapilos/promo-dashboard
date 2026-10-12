import test from 'node:test';
import assert from 'node:assert/strict';
import {
  withBoundedRetry,
  readonlyIgmpPost,
} from '../src/qc-dashboard/readonly-client.js';

function networkError(code) {
  const e = new Error('fetch failed');
  e.name = 'TypeError';
  e.cause = { code };
  return e;
}

function httpError(status) {
  return new Error(`HTTP ${status} https://example.test/api\n  boom`);
}

function authError() {
  const e = new Error('auth required (401)');
  e.name = 'AuthError';
  return e;
}

test('withBoundedRetry succeeds after transient network errors', async () => {
  let calls = 0;
  const result = await withBoundedRetry(async () => {
    calls += 1;
    if (calls < 3) throw networkError('ECONNRESET');
    return 'ok';
  }, { attempts: 5, baseMs: 1, maxMs: 2 });
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('withBoundedRetry retries on 5xx and 429 but not on other HTTP errors', async () => {
  let calls502 = 0;
  const r502 = await withBoundedRetry(async () => {
    calls502 += 1;
    if (calls502 < 2) throw httpError(502);
    return 'recovered';
  }, { attempts: 3, baseMs: 1, maxMs: 2 });
  assert.equal(r502, 'recovered');
  assert.equal(calls502, 2);

  let calls400 = 0;
  await assert.rejects(
    withBoundedRetry(async () => {
      calls400 += 1;
      throw httpError(400);
    }, { attempts: 3, baseMs: 1, maxMs: 2 }),
    /HTTP 400/,
  );
  assert.equal(calls400, 1, 'non-transient HTTP errors must fail on the first attempt, no retry');
});

test('withBoundedRetry retries a second AuthError beyond authedFetch\'s own one-shot relogin', async () => {
  let calls = 0;
  const result = await withBoundedRetry(async () => {
    calls += 1;
    if (calls < 2) throw authError();
    return 'session-recovered';
  }, { attempts: 3, baseMs: 1, maxMs: 2 });
  assert.equal(result, 'session-recovered');
  assert.equal(calls, 2);
});

test('withBoundedRetry is bounded: a persistent transient error still throws', async () => {
  let calls = 0;
  await assert.rejects(
    withBoundedRetry(async () => {
      calls += 1;
      throw networkError('ETIMEDOUT');
    }, { attempts: 4, baseMs: 1, maxMs: 2 }),
    /fetch failed/,
  );
  assert.equal(calls, 4, 'must stop after the configured attempt count — a genuine outage must not retry forever');
});

test('withBoundedRetry reports each retry via onRetry for future health-state observability', async () => {
  const seen = [];
  let calls = 0;
  await withBoundedRetry(async () => {
    calls += 1;
    if (calls < 3) throw networkError('ECONNRESET');
    return 'ok';
  }, { attempts: 5, baseMs: 1, maxMs: 2, onRetry: (info) => seen.push(info.attempt) });
  assert.deepEqual(seen, [1, 2]);
});

test('readonlyIgmpPost retries transient failures from igmpPostImpl before succeeding', async () => {
  let calls = 0;
  const result = await readonlyIgmpPost('ws1-v3-my', '/PM/GetPromotionInfoByCode', { PromotionCode: 'X' }, {
    retry: { attempts: 3, baseMs: 1, maxMs: 2 },
    igmpPostImpl: async () => {
      calls += 1;
      if (calls < 2) throw networkError('ECONNRESET');
      return { data: { PromotionId: 1 } };
    },
  });
  assert.deepEqual(result, { data: { PromotionId: 1 } });
  assert.equal(calls, 2);
});

test('readonlyIgmpPost succeeds first-try with no retry overhead when the call is clean', async () => {
  const calls = [];
  const result = await readonlyIgmpPost('ws1-v3-my', '/PM/GetPromotionInfoByCode', { PromotionCode: 'X' }, {
    igmpPostImpl: async (siteId, endpoint, body) => {
      calls.push({ siteId, endpoint, body });
      return { data: { PromotionId: 1 } };
    },
  });
  assert.deepEqual(result, { data: { PromotionId: 1 } });
  assert.equal(calls.length, 1);
});
