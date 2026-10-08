import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeByUuid, normalizeQcRecord } from '../src/qc-dashboard/qc-log.js';

test('dedupeByUuid keeps the latest line for a repeated uuid (failed-sheet-write dup)', () => {
  const base = normalizeQcRecord({ uuid: 'U1', code: 'X', brand: 'QP2A', result: 'NOT_SAFE' }, {});
  const pending = { ...base, sheet_pending: true, sheet_error: 'boom' };
  const out = dedupeByUuid([base, pending]);
  assert.equal(out.length, 1, 'two same-uuid lines collapse to one');
  assert.equal(out[0].uuid, 'U1');
  assert.equal(out[0].sheet_pending, true, 'latest (pending) line wins');
});

test('dedupeByUuid preserves distinct uuids', () => {
  const a = normalizeQcRecord({ uuid: 'A', code: 'X', brand: 'QP2A', result: 'SAFE' }, {});
  const b = normalizeQcRecord({ uuid: 'B', code: 'Y', brand: 'QPRO1', result: 'REVIEW' }, {});
  const out = dedupeByUuid([a, b]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((r) => r.uuid).sort(), ['A', 'B']);
});

test('dedupeByUuid keeps uuid-less legacy records', () => {
  const out = dedupeByUuid([{ code: 'legacy', qc_result: 'SAFE' }, { code: 'legacy2', qc_result: 'SAFE' }]);
  assert.equal(out.length, 2);
});
