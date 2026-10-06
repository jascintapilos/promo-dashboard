import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _test, listEntries, addEntry, updateEntry, deleteEntry } from '../src/qc-dashboard/leave-board-store.js';

// Point the store at a throwaway file for each file-backed test.
function withTempFile(fn) {
  return async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'leave-board-'));
    const prev = process.env.LEAVE_BOARD_FILE;
    process.env.LEAVE_BOARD_FILE = path.join(dir, 'nested', 'leave-board.local.json');
    try { await fn(process.env.LEAVE_BOARD_FILE); }
    finally {
      if (prev === undefined) delete process.env.LEAVE_BOARD_FILE; else process.env.LEAVE_BOARD_FILE = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

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

test('cleanInput keeps text verbatim (stored as plain text) and caps length', () => {
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

test('missing data file reads as an empty board', withTempFile(async () => {
  assert.deepEqual(await listEntries(), []);
}));

test('add / update / delete round-trip through the data file', withTempFile(async (file) => {
  const { entry } = await addEntry({ name: 'Wen', type: 'AL', start: '2026-11-06', end: '2026-11-06' }, { email: 'a@x' });
  await addEntry({ name: 'Gaby', type: 'MC', start: '2026-10-07', end: '2026-10-08' });
  let all = await listEntries();
  assert.equal(all.length, 2);
  assert.equal(all[0].start, '2026-11-06'); // dates stay YYYY-MM-DD

  await updateEntry(entry.id, { name: 'Wen', type: 'HALF', start: '2026-11-07', end: '2026-11-07', note: 'PM off' });
  all = await listEntries();
  const wen = all.find((e) => e.id === entry.id);
  assert.equal(wen.type, 'HALF');
  assert.equal(wen.start, '2026-11-07');
  assert.equal(wen.createdAt, entry.createdAt); // createdAt preserved on edit

  await deleteEntry(entry.id);
  all = await listEntries();
  assert.deepEqual(all.map((e) => e.name), ['Gaby']);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).entries.length, 1);
}));

test('update / delete of an unknown id is a 404', withTempFile(async () => {
  await assert.rejects(updateEntry('nope-123', { name: 'A', type: 'AL', start: '2026-09-01', end: '2026-09-01' }), (e) => e.status === 404);
  await assert.rejects(deleteEntry('nope-123'), (e) => e.status === 404);
}));

test('a corrupt data file throws and is never overwritten', withTempFile(async (file) => {
  await addEntry({ name: 'Keep', type: 'AL', start: '2026-09-01', end: '2026-09-01' });
  writeFileSync(file, '{ "entries": [ truncated', 'utf8');
  await assert.rejects(listEntries(), /unreadable/);
  await assert.rejects(addEntry({ name: 'New', type: 'AL', start: '2026-09-02', end: '2026-09-02' }), /unreadable/);
  assert.equal(readFileSync(file, 'utf8'), '{ "entries": [ truncated');
}));
