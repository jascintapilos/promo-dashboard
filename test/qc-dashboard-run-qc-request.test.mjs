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

test('Increment 6: handle is optional and defaults to null', () => {
  const r = normalizeRunQcRequest({ brand: 'QP2A', codes: ['X'] });
  assert.equal(r.ok, true);
  assert.equal(r.handle, null);
});

test('Increment 6: handle accepts the real formats found in captures/', () => {
  // Every one of these appears in captures/qc-bundles/ or captures/requests/ today.
  for (const h of ['P172', 'p172', 'B45', 'P068-r69', 'P133-r135', 'P-API-fc-v2', 'P-FC-qp2a-popup-test-v3']) {
    const r = normalizeRunQcRequest({ brand: 'QP2A', codes: ['X'], handle: h });
    assert.equal(r.ok, true, `handle "${h}" should be accepted (matches on-disk format)`);
    assert.equal(r.handle, h, 'handle must preserve original case (filenames are case-sensitive on POSIX)');
  }
});

test('Increment 6: handle rejects underscores (promo codes cant sneak in as handles)', () => {
  // Every promo code uses `_` as its separator — this is the invariant that
  // makes the D2 "no loose grep" rule work: a fat-fingered code cannot bypass.
  for (const h of ['FT_RET_CRM_REL_100FS_GOO_AUG', 'ANY_UNDERSCORED_STRING']) {
    const r = normalizeRunQcRequest({ brand: 'QP2A', codes: ['X'], handle: h });
    assert.equal(r.ok, false, `handle "${h}" should be rejected`);
    assert.equal(r.status, 400);
    assert.match(r.error, /underscores are reserved for promo codes/);
  }
});

test('Increment 6: handle rejects length > 40 and non-alphanumeric characters', () => {
  const tooLong = 'P' + 'a'.repeat(45);
  const r = normalizeRunQcRequest({ brand: 'QP2A', codes: ['X'], handle: tooLong });
  assert.equal(r.ok, false);
  assert.match(r.error, /at most 40 characters/);
  for (const h of ['PMY 172', '172-start-with-digit']) {
    const r2 = normalizeRunQcRequest({ brand: 'QP2A', codes: ['X'], handle: h });
    assert.equal(r2.ok, false, `handle "${h}" should be rejected`);
  }
  // Whitespace-only input is equivalent to "no handle" (post-trim it's '')
  // and returns ok:true with handle:null — matches the empty-input path.
  const blank = normalizeRunQcRequest({ brand: 'QP2A', codes: ['X'], handle: '   ' });
  assert.equal(blank.ok, true);
  assert.equal(blank.handle, null);
});
