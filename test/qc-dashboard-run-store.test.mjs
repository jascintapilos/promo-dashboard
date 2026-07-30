// Blocker 1 fix: unit tests for the server-side run-store that backs
// MANUAL_PASS eligibility. Every attack vector this store defends against
// is also tested end-to-end in qc-dashboard-manual-pass.test.mjs; these
// tests target the store surface directly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { recordRun, lookupRun, _clearRunStoreForTest, _sizeForTest } from '../src/qc-dashboard/run-store.js';

test('run-store: recordRun issues a runId shaped qc_<base64url>', () => {
  _clearRunStoreForTest();
  const id = recordRun({ brand: 'QP2A', code: 'CODE1', verdict: 'MANUAL_REQUIRED' });
  assert.match(id, /^qc_[A-Za-z0-9_-]{12}$/);
});

test('run-store: recordRun rejects missing fields', () => {
  _clearRunStoreForTest();
  assert.throws(() => recordRun({ code: 'X', verdict: 'MANUAL_REQUIRED' }), /brand, code, verdict/);
  assert.throws(() => recordRun({ brand: 'X', verdict: 'MANUAL_REQUIRED' }), /brand, code, verdict/);
  assert.throws(() => recordRun({ brand: 'X', code: 'Y' }), /brand, code, verdict/);
});

test('run-store: lookupRun resolves a fresh MANUAL_REQUIRED run', () => {
  _clearRunStoreForTest();
  const id = recordRun({ brand: 'QP2A', code: 'CODE1', verdict: 'MANUAL_REQUIRED' });
  const r = lookupRun(id, { brand: 'QP2A', code: 'CODE1' });
  assert.equal(r.ok, true);
  assert.equal(r.entry.verdict, 'MANUAL_REQUIRED');
});

test('run-store: lookupRun rejects unknown id', () => {
  _clearRunStoreForTest();
  assert.deepEqual(lookupRun('qc_bogus', { brand: 'X', code: 'Y' }), { ok: false, code: 'UNKNOWN_RUN_ID' });
});

test('run-store: lookupRun rejects when verdict does not match expected', () => {
  _clearRunStoreForTest();
  const id = recordRun({ brand: 'QP2A', code: 'CODE1', verdict: 'NOT_SAFE' });
  const r = lookupRun(id, { brand: 'QP2A', code: 'CODE1', expectedVerdict: 'MANUAL_REQUIRED' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'VERDICT_MISMATCH');
  assert.equal(r.actual, 'NOT_SAFE');
});

test('run-store: brand mismatch rejects (case-insensitive normalized)', () => {
  _clearRunStoreForTest();
  const id = recordRun({ brand: 'QP2A', code: 'CODE1', verdict: 'MANUAL_REQUIRED' });
  const r = lookupRun(id, { brand: 'QPRO5', code: 'CODE1' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'BRAND_MISMATCH');
});

test('run-store: code mismatch rejects', () => {
  _clearRunStoreForTest();
  const id = recordRun({ brand: 'QP2A', code: 'CODE1', verdict: 'MANUAL_REQUIRED' });
  const r = lookupRun(id, { brand: 'QP2A', code: 'DIFFERENT' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'CODE_MISMATCH');
});

test('run-store: compareHash mismatch rejects when both sides carry a hash', () => {
  _clearRunStoreForTest();
  const id = recordRun({ brand: 'QP2A', code: 'CODE1', verdict: 'MANUAL_REQUIRED', compareHash: 'abc123' });
  const r = lookupRun(id, { brand: 'QP2A', code: 'CODE1', compareHash: 'def456' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'COMPARE_HASH_MISMATCH');
});

test('run-store: compareHash omitted by client is allowed even when server has one', () => {
  // This is the documented semantics — omitting compare is treated as
  // "no claim about compare state", server-stored hash is not enforced.
  _clearRunStoreForTest();
  const id = recordRun({ brand: 'QP2A', code: 'CODE1', verdict: 'MANUAL_REQUIRED', compareHash: 'abc123' });
  const r = lookupRun(id, { brand: 'QP2A', code: 'CODE1' /* no compareHash */ });
  assert.equal(r.ok, true);
});

test('run-store: FIFO eviction when > 512 entries', () => {
  _clearRunStoreForTest();
  const ids = [];
  for (let i = 0; i < 600; i++) {
    ids.push(recordRun({ brand: 'QP2A', code: `CODE${i}`, verdict: 'MANUAL_REQUIRED' }));
  }
  assert.equal(_sizeForTest(), 512);
  // First 88 should be evicted, last 512 kept.
  assert.equal(lookupRun(ids[0], { brand: 'QP2A', code: 'CODE0' }).ok, false, 'oldest entry evicted');
  assert.equal(lookupRun(ids[599], { brand: 'QP2A', code: 'CODE599' }).ok, true, 'newest entry retained');
});
