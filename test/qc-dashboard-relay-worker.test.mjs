// BO Relay Increment 5 — VDI worker unit tests.
//
// Covers correction brief §6 (evidence-only outputs, no PII in logs),
// §7 (graceful shutdown, bounded backoff, structured logs), and
// end-to-end job handling with stubbed BO / expected-source layers.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResultForJob, sanitizeError, _internals } from '../bin/qc-bo-relay-worker.mjs';

// ── Stub factories that mimic the real module signatures ──────────────

function stubDeps({
  snapshot = { runtime: { platform: 'qp2', siteId: 'ibc22' }, raw: { listingRow: { code: 'C1' }, detail: {} } },
  expSrc = { source: { promo_code: 'C1', bonus_type: 'Free Credit' }, sourceType: 'bundle', sourceId: 'B1', handle: 'P1', promoCode: 'C1', brand: 'QP2A' },
  expected = { identity: { promoCode: 'C1', platform: 'qp2' }, currencies: [] },
  actual = { identity: { promoCode: 'C1', platform: 'qp2' }, currencies: [] },
  throwFetch, throwResolve, throwExpectedAdapter, throwLiveAdapter,
  resolveExpectedSourceFromSheet,
  overrideSnapshotToLiveState,
} = {}) {
  return {
    fetchPromoSnapshot: async () => { if (throwFetch) throw throwFetch; return snapshot; },
    resolveExpectedSource: () => { if (throwResolve) throw throwResolve; return expSrc; },
    ...(resolveExpectedSourceFromSheet ? { resolveExpectedSourceFromSheet } : {}),
    snapshotToLiveState: overrideSnapshotToLiveState || (() => ({ list_row: {}, detail: {}, tnc: null })),
    expectedFromSource: () => { if (throwExpectedAdapter) throw throwExpectedAdapter; return expected; },
    liveFromPlatform: () => { if (throwLiveAdapter) throw throwLiveAdapter; return actual; },
    leaseJobs: async () => [],
    submitResult: async () => ({ status: 200, text: '' }),
  };
}

const JOB = { jobId: 'qcj_test', brand: 'QP2A', code: 'C1', handle: 'P1' };

// ── happy path ────────────────────────────────────────────────────────

test('worker: happy path — returns sanitized canonicals + expectedSourceMeta, no workerError', async () => {
  const deps = stubDeps();
  const r = await buildResultForJob({ ...JOB, deps });
  assert.equal(r.workerError, null);
  assert.equal(r.expectedCanonical.identity.promoCode, 'C1');
  assert.equal(r.actualCanonical.identity.promoCode, 'C1');
  assert.equal(r.expectedSourceMeta.sourceType, 'bundle');
  // sanitized shape must NOT carry a sourcePath, even if we tried to sneak one
  assert.equal(Object.prototype.hasOwnProperty.call(r.expectedSourceMeta, 'sourcePath'), false);
});

// ── error paths (correction brief §5: relay-incomplete → MANUAL_REQUIRED) ─

test('worker: BO_UNREACHABLE snapshot → workerError code BO_UNREACHABLE, no canonicals', async () => {
  const deps = stubDeps({
    snapshot: { runtime: { platform: 'qp2', siteId: 'ibc22' }, raw: null, error: 'BO unreachable', notFound: false },
  });
  const r = await buildResultForJob({ ...JOB, deps });
  assert.equal(r.workerError.code, 'BO_UNREACHABLE');
  assert.equal(r.expectedCanonical, null);
  assert.equal(r.actualCanonical, null);
});

test('worker: CODE_NOT_FOUND when snapshot.notFound', async () => {
  const deps = stubDeps({
    snapshot: { runtime: { platform: 'qp2', siteId: 'ibc22' }, notFound: true, raw: null },
  });
  const r = await buildResultForJob({ ...JOB, deps });
  assert.equal(r.workerError.code, 'CODE_NOT_FOUND');
});

test('worker: EXPECTED_SOURCE_MISSING when expSrc unresolved', async () => {
  const deps = stubDeps({ expSrc: { sourceType: 'not-found', source: null } });
  const r = await buildResultForJob({ ...JOB, deps });
  assert.equal(r.workerError.code, 'EXPECTED_SOURCE_MISSING');
});

test('worker: EXPECTED_SOURCE_AMBIGUOUS when resolver returns ambiguous', async () => {
  const deps = stubDeps({ expSrc: { sourceType: 'ambiguous', source: null } });
  const r = await buildResultForJob({ ...JOB, deps });
  assert.equal(r.workerError.code, 'EXPECTED_SOURCE_AMBIGUOUS');
});

test('buildResultForJob falls back to the sheet when the local expected source is not-found', async () => {
  let sheetCalls = 0;
  const deps = stubDeps({
    expSrc: { sourceType: 'not-found', source: null },
    resolveExpectedSourceFromSheet: async () => {
      sheetCalls += 1;
      return {
        source: { promo_code: 'C1', bonus_type: 'Free Credit' },
        sourceType: 'sheet',
        sourceId: 'Promo Request Sheet:P1',
        sourceTs: '2026-10-08T00:00:00.000Z',
        approvalStatus: 'Approved',
        handle: 'P1',
        promoCode: 'C1',
        promotionId: null,
        brand: 'QP2A',
      };
    },
  });
  const r = await buildResultForJob({ ...JOB, deps });
  assert.equal(r.workerError, null);
  assert.notEqual(r.expectedCanonical, null);
  assert.equal(sheetCalls, 1);
});

test('buildResultForJob does NOT consult the sheet when the local expected source resolves', async () => {
  let sheetCalls = 0;
  const deps = stubDeps({
    expSrc: {
      source: { promo_code: 'C1', bonus_type: 'Free Credit', marker: 'local' },
      sourceType: 'bundle',
      sourceId: 'B1',
      handle: 'P1',
      promoCode: 'C1',
      brand: 'QP2A',
    },
    resolveExpectedSourceFromSheet: async () => {
      sheetCalls += 1;
      return {
        source: { promo_code: 'C1', bonus_type: 'Free Credit', marker: 'sheet' },
        sourceType: 'sheet',
        sourceId: 'Promo Request Sheet:P1',
        handle: 'P1',
        promoCode: 'C1',
        brand: 'QP2A',
      };
    },
  });
  const r = await buildResultForJob({ ...JOB, deps });
  assert.equal(r.workerError, null);
  assert.equal(r.expectedSourceMeta.sourceType, 'bundle');
  assert.equal(sheetCalls, 0);
});

test('worker: fetchPromoSnapshot throw → INTERNAL error, scrubbed message', async () => {
  const err = new Error('failed at C:\\Users\\vdiuser\\creds.json');
  const deps = stubDeps({ throwFetch: err });
  const r = await buildResultForJob({ ...JOB, deps });
  assert.equal(r.workerError.code, 'INTERNAL');
  assert.doesNotMatch(r.workerError.message, /vdiuser/, 'must scrub path from error message');
});

test('worker: expectedFromSource throw → INTERNAL error, workerError.message scrubbed', async () => {
  const err = new Error('bad token abcdef1234567890abcdef1234567890abcdef1234');
  const deps = stubDeps({ throwExpectedAdapter: err });
  const r = await buildResultForJob({ ...JOB, deps });
  assert.equal(r.workerError.code, 'INTERNAL');
  assert.match(r.workerError.message, /<token>/);
});

test('worker: liveFromPlatform throw → INTERNAL error', async () => {
  const deps = stubDeps({ throwLiveAdapter: new Error('adapter blew up') });
  const r = await buildResultForJob({ ...JOB, deps });
  assert.equal(r.workerError.code, 'INTERNAL');
});

test('worker: snapshotToLiveState returning null → INTERNAL error', async () => {
  const deps = stubDeps({ overrideSnapshotToLiveState: () => null });
  const r = await buildResultForJob({ ...JOB, deps });
  assert.equal(r.workerError.code, 'INTERNAL');
});

// ── sanitizeError primitive ───────────────────────────────────────────

test('sanitizeError: strips Windows absolute paths from messages', () => {
  const s = sanitizeError(new Error('read C:\\Users\\jascinta\\.qc-relay\\relay-secret failed'));
  assert.doesNotMatch(s, /jascinta|relay-secret/);
  assert.match(s, /<server-path>/);
});

test('sanitizeError: strips long hex tokens', () => {
  const s = sanitizeError(new Error(`token ${'f'.repeat(64)} rejected`));
  assert.match(s, /<token>/);
});

test('sanitizeError: strips cookie/auth headers embedded in text', () => {
  const s = sanitizeError(new Error('Cookie: qc_hub_session=zzzzzzzzzzzz mismatch'));
  assert.match(s, /<auth-header>/);
  assert.doesNotMatch(s, /qc_hub_session/);
});

test('sanitizeError: caps output length', () => {
  const long = 'x'.repeat(500);
  assert.ok(sanitizeError(new Error(long)).length <= 200);
});

// ── poll loop backoff / shutdown ──────────────────────────────────────

test('worker loop: idle backs off up to POLL_MAX_MS', async () => {
  _internals.reset();
  _internals.setSecret('S'.repeat(64));
  const empties = { leaseJobs: async () => [], submitResult: async () => ({ status: 200, text: '' }) };
  await _internals.tick({ deps: empties, noSchedule: true });
  const d1 = _internals.getCurrentDelay();
  await _internals.tick({ deps: empties, noSchedule: true });
  const d2 = _internals.getCurrentDelay();
  assert.ok(d2 >= d1, 'idle backoff must be monotonically non-decreasing');
});
