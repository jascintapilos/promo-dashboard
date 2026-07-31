// BO Relay Increment 2 — job store tests.
// Covers correction brief §3 (ownership), §5 (single-use lease, expiry,
// idempotency, restart-safe), §6 (safe projection).

import test from 'node:test';
import assert from 'node:assert/strict';
import { _newJobStoreForTest, safeJobForClient, JOB_STATUS } from '../src/qc-dashboard/relay-job-store.js';

const USER = { email: 'jascinta@example.com', role: 'operator' };
const ADMIN = { email: 'admin@example.com', role: 'admin' };
const OTHER = { email: 'other@example.com', role: 'operator' };

function mk() { return _newJobStoreForTest(); }

// ── createJob ───────────────────────────────────────────────────────────

test('createJob: happy path — QUEUED status, id shape, defaults', () => {
  const s = mk();
  const j = s.createJob({ brand: 'qp2a', code: 'code1', handle: 'p100', requestedBy: USER.email });
  assert.match(j.jobId, /^qcj_[A-Za-z0-9_-]{16}$/);
  assert.equal(j.status, 'QUEUED');
  assert.equal(j.brand, 'QP2A');
  assert.equal(j.code, 'CODE1');
  assert.equal(j.handle, 'p100');
  assert.equal(j.requestedBy, USER.email);
});

test('createJob: requires brand, code, requestedBy', () => {
  const s = mk();
  assert.throws(() => s.createJob({ code: 'X', requestedBy: 'u' }), /brand and code/);
  assert.throws(() => s.createJob({ brand: 'X', requestedBy: 'u' }), /brand and code/);
  assert.throws(() => s.createJob({ brand: 'X', code: 'Y' }), /requestedBy/);
});

// ── leaseJobs ───────────────────────────────────────────────────────────

test('lease: returns QUEUED jobs, marks them LEASED, never leaks requestedBy', () => {
  const s = mk();
  const j = s.createJob({ brand: 'QP2A', code: 'C1', requestedBy: USER.email });
  const leased = s.leaseJobs({ workerId: 'w1' });
  assert.equal(leased.length, 1);
  assert.equal(leased[0].jobId, j.jobId);
  assert.equal(s._peekForTest(j.jobId).status, 'LEASED');
  assert.equal(Object.prototype.hasOwnProperty.call(leased[0], 'requestedBy'), false);
});

test('lease: subsequent lease call returns nothing (single-use)', () => {
  const s = mk();
  s.createJob({ brand: 'QP2A', code: 'C1', requestedBy: USER.email });
  s.leaseJobs({ workerId: 'w1' });
  const second = s.leaseJobs({ workerId: 'w1' });
  assert.equal(second.length, 0);
});

test('lease: expired lease can be re-leased by another worker', () => {
  const now = 1_800_000_000_000;
  const s = mk();
  s.createJob({ brand: 'QP2A', code: 'C1', requestedBy: USER.email, now });
  s.leaseJobs({ workerId: 'w1', now, leaseTtlMs: 100 });
  const later = now + 500;
  const reLeased = s.leaseJobs({ workerId: 'w2', now: later });
  assert.equal(reLeased.length, 1);
});

test('lease: respects limit', () => {
  const s = mk();
  for (let i = 0; i < 8; i++) s.createJob({ brand: 'QP2A', code: `C${i}`, requestedBy: USER.email });
  const leased = s.leaseJobs({ workerId: 'w1', limit: 3 });
  assert.equal(leased.length, 3);
});

test('lease: workerId required', () => {
  const s = mk();
  assert.throws(() => s.leaseJobs({}), /workerId/);
});

// ── submitResult ────────────────────────────────────────────────────────

test('submit: happy path — COMPLETED with result payload', () => {
  const s = mk();
  const j = s.createJob({ brand: 'QP2A', code: 'C1', requestedBy: USER.email });
  s.leaseJobs({ workerId: 'w1' });
  const r = s.submitResult({ jobId: j.jobId, brand: 'QP2A', code: 'C1', handle: null, workerId: 'w1', verdictBundle: { any: 'shape' } });
  assert.equal(r.ok, true);
  assert.equal(r.job.status, 'COMPLETED');
  assert.deepEqual(r.job.result, { any: 'shape' });
});

test('submit: rejects UNKNOWN_JOB for made-up ids', () => {
  const s = mk();
  const r = s.submitResult({ jobId: 'qcj_forged', brand: 'QP2A', code: 'C1', workerId: 'w1', verdictBundle: {} });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'UNKNOWN_JOB');
});

test('submit: rejects non-leased jobs (queue-not-yet-leased)', () => {
  const s = mk();
  const j = s.createJob({ brand: 'QP2A', code: 'C1', requestedBy: USER.email });
  const r = s.submitResult({ jobId: j.jobId, brand: 'QP2A', code: 'C1', workerId: 'w1', verdictBundle: {} });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NOT_LEASED');
});

test('submit: brand/code/handle mismatch → rejected (worker cannot alter identity)', () => {
  const s = mk();
  const j = s.createJob({ brand: 'QP2A', code: 'C1', handle: 'p100', requestedBy: USER.email });
  s.leaseJobs({ workerId: 'w1' });
  assert.equal(s.submitResult({ jobId: j.jobId, brand: 'QPRO5', code: 'C1', handle: 'p100', workerId: 'w1', verdictBundle: {} }).code, 'BRAND_MISMATCH');
  assert.equal(s.submitResult({ jobId: j.jobId, brand: 'QP2A', code: 'OTHER', handle: 'p100', workerId: 'w1', verdictBundle: {} }).code, 'CODE_MISMATCH');
  assert.equal(s.submitResult({ jobId: j.jobId, brand: 'QP2A', code: 'C1', handle: 'p999', workerId: 'w1', verdictBundle: {} }).code, 'HANDLE_MISMATCH');
});

test('submit: different worker id than lessee → WRONG_LESSEE', () => {
  const s = mk();
  const j = s.createJob({ brand: 'QP2A', code: 'C1', requestedBy: USER.email });
  s.leaseJobs({ workerId: 'w1' });
  const r = s.submitResult({ jobId: j.jobId, brand: 'QP2A', code: 'C1', workerId: 'w2', verdictBundle: {} });
  assert.equal(r.code, 'WRONG_LESSEE');
});

test('submit: is idempotent — second submit returns alreadyComplete, does not overwrite', () => {
  const s = mk();
  const j = s.createJob({ brand: 'QP2A', code: 'C1', requestedBy: USER.email });
  s.leaseJobs({ workerId: 'w1' });
  s.submitResult({ jobId: j.jobId, brand: 'QP2A', code: 'C1', workerId: 'w1', verdictBundle: { seq: 1 } });
  const second = s.submitResult({ jobId: j.jobId, brand: 'QP2A', code: 'C1', workerId: 'w1', verdictBundle: { seq: 2 } });
  assert.equal(second.ok, true);
  assert.equal(second.alreadyComplete, true);
  assert.equal(s._peekForTest(j.jobId).result.seq, 1, 'first submission wins');
});

test('submit: rejects EXPIRED jobs (worker missed the TTL)', () => {
  const s = mk();
  const j = s.createJob({ brand: 'QP2A', code: 'C1', requestedBy: USER.email });
  s.leaseJobs({ workerId: 'w1' });
  s._forceExpireForTest(j.jobId);
  const r = s.submitResult({ jobId: j.jobId, brand: 'QP2A', code: 'C1', workerId: 'w1', verdictBundle: {} });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'EXPIRED');
});

// ── getForUser (§3 ownership) ───────────────────────────────────────────

test('ownership: original requester can read their own job', () => {
  const s = mk();
  const j = s.createJob({ brand: 'QP2A', code: 'C1', requestedBy: USER.email });
  const r = s.getForUser({ jobId: j.jobId, user: USER });
  assert.equal(r.ok, true);
});

test('ownership: another operator gets NOT_FOUND (no enumeration by id-guess)', () => {
  const s = mk();
  const j = s.createJob({ brand: 'QP2A', code: 'C1', requestedBy: USER.email });
  const r = s.getForUser({ jobId: j.jobId, user: OTHER });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NOT_FOUND', 'must not leak "forbidden" — otherwise attacker learns the jobId exists');
});

test('ownership: admin can read any job', () => {
  const s = mk();
  const j = s.createJob({ brand: 'QP2A', code: 'C1', requestedBy: USER.email });
  const r = s.getForUser({ jobId: j.jobId, user: ADMIN });
  assert.equal(r.ok, true);
});

test('ownership: unauthenticated → UNAUTHORIZED', () => {
  const s = mk();
  const j = s.createJob({ brand: 'QP2A', code: 'C1', requestedBy: USER.email });
  const r = s.getForUser({ jobId: j.jobId, user: null });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'UNAUTHORIZED');
});

test('ownership: id-guessing on a nonexistent jobId returns NOT_FOUND (identical shape to wrong-owner)', () => {
  const s = mk();
  const r = s.getForUser({ jobId: 'qcj_forged', user: USER });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NOT_FOUND');
});

// ── Server-restart / lost job (§5) ──────────────────────────────────────

test('restart: a fresh store has no jobs — a previously-issued jobId resolves to NOT_FOUND, never PASS', () => {
  const s = mk();
  const preRestartId = 'qcj_preRestartJobId';
  const r = s.getForUser({ jobId: preRestartId, user: USER });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NOT_FOUND');
});

test('expiry: getForUser materializes EXPIRED status on late read', () => {
  const now = 1_800_000_000_000;
  const s = mk();
  const j = s.createJob({ brand: 'QP2A', code: 'C1', requestedBy: USER.email, now, ttlMs: 100 });
  const r = s.getForUser({ jobId: j.jobId, user: USER, now: now + 500 });
  assert.equal(r.ok, true);
  assert.equal(r.job.status, 'EXPIRED');
});

// ── safeJobForClient projection (§6) ────────────────────────────────────

test('safeJobForClient: never exposes requestedBy or leasedBy to the browser', () => {
  const s = mk();
  const j = s.createJob({ brand: 'QP2A', code: 'C1', requestedBy: USER.email });
  s.leaseJobs({ workerId: 'w1' });
  const safe = safeJobForClient(s._peekForTest(j.jobId));
  assert.equal(safe.jobId, j.jobId);
  assert.equal(Object.prototype.hasOwnProperty.call(safe, 'requestedBy'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(safe, 'leasedBy'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(safe, 'leaseExpiresAt'), false);
});

test('safeJobForClient: result field is null unless COMPLETED', () => {
  const s = mk();
  const j = s.createJob({ brand: 'QP2A', code: 'C1', requestedBy: USER.email });
  s.leaseJobs({ workerId: 'w1' });
  assert.equal(safeJobForClient(s._peekForTest(j.jobId)).result, null, 'LEASED must not expose result');
  s.submitResult({ jobId: j.jobId, brand: 'QP2A', code: 'C1', workerId: 'w1', verdictBundle: { verdict: 'SAFE' } });
  assert.deepEqual(safeJobForClient(s._peekForTest(j.jobId)).result, { verdict: 'SAFE' });
});

// ── attachFinalRunId (§5 — MP override binding) ─────────────────────────

test('attachFinalRunId: after relay comparison, the MP-override runId is set on the job', () => {
  const s = mk();
  const j = s.createJob({ brand: 'QP2A', code: 'C1', requestedBy: USER.email });
  s.leaseJobs({ workerId: 'w1' });
  s.submitResult({ jobId: j.jobId, brand: 'QP2A', code: 'C1', workerId: 'w1', verdictBundle: { verdict: 'MANUAL_REQUIRED' } });
  s.attachFinalRunId(j.jobId, 'qc_finalRunId123');
  const safe = safeJobForClient(s._peekForTest(j.jobId));
  assert.equal(safe.finalRunId, 'qc_finalRunId123');
});

test('counts: aggregate view exposes NO promo secrets, just counts', () => {
  const s = mk();
  s.createJob({ brand: 'QP2A', code: 'C1', requestedBy: USER.email });
  s.createJob({ brand: 'QPRO5', code: 'C2', requestedBy: USER.email });
  const c = s.counts();
  assert.equal(c.total, 2);
  assert.equal(c.queued, 2);
  // Should be a plain-number-only shape:
  for (const k of Object.keys(c)) assert.equal(typeof c[k], 'number');
});
