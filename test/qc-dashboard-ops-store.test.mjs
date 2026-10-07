import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateOpsPush, applyOpsPush, readOpsData, toIsoDay, opsDataDir } from '../src/qc-dashboard/ops-store.js';

const PROMO_HEADERS = ['Date', 'Code', 'Brand', 'Region', 'Created By', 'Type', 'Status'];
const good = (rows, extra = {}) => ({ key: 'promos', pulledAt: '2026-10-07T10:00:00.000Z', ok: true, headers: PROMO_HEADERS, rows, ...extra });

function tmpDir() { return mkdtempSync(path.join(os.tmpdir(), 'ops-store-')); }

test('toIsoDay reads ISO dates, ISO timestamps and D/M/YYYY manual entries', () => {
  assert.equal(toIsoDay('2026-10-06'), '2026-10-06');
  assert.equal(toIsoDay('2026-10-07T00:08:47.570Z'), '2026-10-07');
  assert.equal(toIsoDay('5/1/2026'), '2026-01-05');
  assert.equal(toIsoDay(''), null);
  assert.equal(toIsoDay('Week 3'), null);
});

test('validateOpsPush rejects unknown keys, key mismatch and missing columns', () => {
  assert.throws(() => validateOpsPush('nope', good([])), /unknown dataset/);
  assert.throws(() => validateOpsPush('banners', good([])), /key mismatch/);
  assert.throws(() => validateOpsPush('promos', good([], { headers: ['Date', 'Code'] })), /missing columns: Brand/);
  assert.throws(() => validateOpsPush('promos', good([], { pulledAt: 'yesterday' })), /pulledAt/);
  assert.throws(() => validateOpsPush('promos', good([[1, 2]])), /cells must be strings/);
});

test('validateOpsPush accepts extra columns and a failed pull without rows', () => {
  const rec = validateOpsPush('promos', good([['06/10/2026', 'X', 'QP2A', 'MY', 'bot', 'Free Spin', 'Active', 'extra']], { headers: [...PROMO_HEADERS, 'Notes'] }));
  assert.equal(rec.ok, true);
  const fail = validateOpsPush('promos', { key: 'promos', pulledAt: '2026-10-07T10:00:00.000Z', ok: false, detail: 'exit 1' });
  assert.deepEqual(fail, { key: 'promos', ok: false, pulledAt: '2026-10-07T10:00:00.000Z', detail: 'exit 1' });
});

test('a good push stores rows + status, and the next good push keeps the previous one', () => {
  const dir = tmpDir();
  try {
    const s1 = applyOpsPush(dir, validateOpsPush('promos', good([['05/10/2026', 'A', 'QP2A', 'MY', 'bot', 'Deposit', 'Active']])));
    assert.equal(s1.rowCount, 1);
    assert.equal(s1.newestRowDate, '2026-10-05');
    assert.equal(s1.lastGoodAt, '2026-10-07T10:00:00.000Z');
    applyOpsPush(dir, validateOpsPush('promos', good([['06/10/2026', 'B', 'QP2A', 'MY', 'bot', 'Deposit', 'Active'], ['01/10/2026', 'C', 'QP2A', 'MY', 'bot', 'Deposit', 'Active']])));
    assert.ok(existsSync(path.join(dir, 'promos.prev.json')));
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'promos.prev.json'), 'utf8')).rows[0][1], 'A');
    const { datasets, status } = readOpsData(dir);
    assert.equal(datasets.promos.rows.length, 2);
    assert.equal(status.promos.newestRowDate, '2026-10-06');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a failed push keeps the last good rows and records the failure', () => {
  const dir = tmpDir();
  try {
    applyOpsPush(dir, validateOpsPush('promos', good([['05/10/2026', 'A', 'QP2A', 'MY', 'bot', 'Deposit', 'Active']])));
    const s = applyOpsPush(dir, validateOpsPush('promos', { key: 'promos', pulledAt: '2026-10-08T10:00:00.000Z', ok: false, detail: 'exit 1' }));
    assert.equal(s.ok, false);
    assert.equal(s.lastFailureAt, '2026-10-08T10:00:00.000Z');
    assert.equal(s.lastGoodAt, '2026-10-07T10:00:00.000Z');
    assert.equal(s.rowCount, 1);
    assert.equal(readOpsData(dir).datasets.promos.rows.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('readOpsData omits datasets that were never pushed', () => {
  const dir = tmpDir();
  try {
    assert.deepEqual(readOpsData(dir), { datasets: {}, status: {} });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('opsDataDir honours OPS_DATA_DIR', () => {
  assert.equal(opsDataDir('/repo', {}), path.join('/repo', 'data', 'ops'));
  assert.equal(opsDataDir('/repo', { OPS_DATA_DIR: os.tmpdir() }), path.resolve(os.tmpdir()));
});
