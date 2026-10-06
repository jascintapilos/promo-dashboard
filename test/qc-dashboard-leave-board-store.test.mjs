import test from 'node:test';
import assert from 'node:assert/strict';
import { _test } from '../src/qc-dashboard/leave-board-store.js';

test('cleanInput normalizes a valid entry', () => {
  const c = _test.cleanInput({ name: '  Jascinta  Pilos ', type: 'al', start: '2026-09-25', end: '2026-09-25', note: '  trip  ' });
  assert.equal(c.name, 'Jascinta Pilos');
  assert.equal(c.type, 'AL');
  assert.equal(c.start, '2026-09-25');
  assert.equal(c.end, '2026-09-25');
  assert.equal(c.note, 'trip');
});

test('cleanInput rejects bad input with 400', () => {
  assert.throws(() => _test.cleanInput({ name: '', type: 'AL', start: '2026-09-01', end: '2026-09-01' }),
    (e) => e.status === 400 && /name/.test(e.message));
  assert.throws(() => _test.cleanInput({ name: 'A', type: 'XX', start: '2026-09-01', end: '2026-09-01' }),
    (e) => e.status === 400 && /type/.test(e.message));
  assert.throws(() => _test.cleanInput({ name: 'A', type: 'AL', start: '2026/09/01', end: '2026-09-01' }),
    (e) => e.status === 400 && /YYYY-MM-DD/.test(e.message));
  assert.throws(() => _test.cleanInput({ name: 'A', type: 'AL', start: '2026-09-05', end: '2026-09-04' }),
    (e) => e.status === 400 && /on or after/.test(e.message));
});

test('cleanInput keeps text verbatim (written RAW) and caps length', () => {
  const c = _test.cleanInput({ name: '=CMD()', type: 'MC', start: '2026-09-01', end: '2026-09-02', note: '@x' });
  assert.equal(c.name, '=CMD()');
  assert.equal(c.note, '@x');
  const long = _test.cleanInput({ name: 'n'.repeat(80), type: 'EL', start: '2026-09-01', end: '2026-09-01', note: 'z'.repeat(200) });
  assert.equal(long.name.length, 60);
  assert.equal(long.note.length, 80);
});

test('row/record roundtrip preserves the schema', () => {
  assert.deepEqual(_test.HEADER, ['id', 'name', 'type', 'start', 'end', 'note', 'createdAt', 'updatedAt']);
  const rec = { id: 'x1', name: 'Wen', type: 'AL', start: '2026-11-06', end: '2026-11-06', note: '', createdAt: 'c', updatedAt: 'u' };
  const row = _test.rowFromRecord(rec);
  assert.equal(row.length, 8);
  assert.deepEqual(_test.recordFromRow(row), rec);
});

test('ALLOWED_TYPES is the casual set (AL/MC/EL/HALF)', () => {
  assert.deepEqual([..._test.ALLOWED_TYPES].sort(), ['AL', 'EL', 'HALF', 'MC']);
});
