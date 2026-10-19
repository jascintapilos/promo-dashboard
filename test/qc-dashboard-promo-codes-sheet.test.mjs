// Promo Codes ↔ Ops sheet: round trip, status tab, untrusted cells, cached reader.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA_HEADERS, rowToSheet, statusToSheet, sheetToPayload, createPromoCodesReader } from '../src/qc-dashboard/promo-codes-sheet.js';

const ROWS = [
  { source: 'CEE', group: 'CEE', pic: '', section: 'Not in use anymore', code: 'RET_OLD', wsCode: '', brands: ['QP2A', 'QPRO1'], brandsAll: false, brandsAllWs: false,
    regions: ['SG'], type: 'Slots', offer: '199 FS', sheetStatus: '⚠ Still active on BO: QP2A', note: 'row 928', retired: true,
    bo: { QP2A: 'active', QPRO1: 'inactive' }, mismatch: ['QP2A: still active on BO'] },
  { source: 'Sales', group: 'VM (menu)', pic: '', section: '', code: 'VM_X', wsCode: 'FT_VM_X', brands: ['QP2A'], brandsAll: true, brandsAllWs: true,
    regions: ['MY', 'SG'], type: '', offer: '=HYPERLINK("x")', sheetStatus: 'Live: QP2A', note: '', retired: false,
    bo: { QP2A: 'active', QPRO1: 'expired', WS1_MY: 'unchecked' }, mismatch: [] },
];
const RUN = {
  pulledAt: '2026-10-19T02:00:00.000Z', boCheckedAt: '2026-10-19T02:05:00.000Z', ok: true, lastGoodAt: '2026-10-19T02:00:00.000Z',
  sources: { CEE: 1, Sales: 1, CRM: 0 }, siteErrors: [{ brand: 'WS1_SG', message: 'HTTP 500; retry' }], detail: '',
};
const sheetOf = (rows, run = RUN) => ({ data: [DATA_HEADERS.slice(), ...rows.map(rowToSheet)], status: statusToSheet(run) });

test('rows round-trip through the sheet unchanged', () => {
  const { data, status } = sheetOf(ROWS);
  const p = sheetToPayload(data, status);
  assert.equal(p.data.rows.length, 2);
  for (let i = 0; i < ROWS.length; i++) {
    const { ...want } = ROWS[i];
    assert.deepEqual(p.data.rows[i], want);
  }
  assert.equal(p.data.boCheckedAt, RUN.boCheckedAt);
  assert.deepEqual(p.data.sources, { CEE: 1, Sales: 1, CRM: 0 });
  assert.deepEqual(p.data.siteErrors, [{ brand: 'WS1_SG', message: 'HTTP 500, retry' }]);
  assert.deepEqual(p.status, { ok: true, lastGoodAt: RUN.lastGoodAt, lastFailureAt: null, detail: '' });
});

test('columns can be re-ordered by a sheet editor (read by header name)', () => {
  const { data, status } = sheetOf(ROWS);
  const order = DATA_HEADERS.map((_, i) => i).reverse();
  const shuffled = data.map((r) => order.map((i) => r[i]));
  assert.deepEqual(sheetToPayload(shuffled, status).data.rows, sheetToPayload(data, status).data.rows);
});

test('no data yet: empty/missing tabs, or no good run recorded', () => {
  assert.deepEqual(sheetToPayload([], []), { data: null, status: null });
  const { data } = sheetOf(ROWS);
  assert.equal(sheetToPayload(data, []).data, null);
});

test('a failed run keeps the list and reports the failure', () => {
  const { data } = sheetOf(ROWS);
  const failed = statusToSheet({ ...RUN, ok: false, pulledAt: '2026-10-19T03:00:00.000Z', detail: 'BO login failed' });
  const p = sheetToPayload(data, failed);
  assert.equal(p.data.rows.length, 2);
  assert.equal(p.status.ok, false);
  assert.equal(p.status.lastFailureAt, '2026-10-19T03:00:00.000Z');
  assert.equal(p.status.detail, 'BO login failed');
});

test('hand-edited bad rows are skipped and counted, not fatal', () => {
  const { data, status } = sheetOf(ROWS);
  const col = (h) => DATA_HEADERS.indexOf(h);
  const bad1 = data[1].slice(); bad1[col('Source')] = 'Hacker';
  const bad2 = data[2].slice(); bad2[col('Active on BO')] = '<img src=x>';
  const blank = DATA_HEADERS.map(() => '');
  const p = sheetToPayload([data[0], bad1, bad2, blank, data[1]], status);
  assert.equal(p.data.rows.length, 1);
  assert.equal(p.data.skippedRows, 2);
});

test('reader caches, single-flights, and serves the last copy when Google fails', async () => {
  let t = 0; let calls = 0; let fail = false;
  const read = createPromoCodesReader({
    ttlMs: 1000, now: () => t,
    fetchValues: async () => { calls++; if (fail) throw new Error('quota'); return sheetOf(ROWS); },
  });
  const [a, b] = await Promise.all([read(), read()]);
  assert.equal(calls, 1);
  assert.equal(a.data.rows.length, 2);
  assert.equal(a, b);
  t = 500; await read(); assert.equal(calls, 1);          // still cached
  t = 1500; fail = true;
  const stale = await read();                               // refresh fails → last copy
  assert.equal(calls, 2);
  assert.equal(stale.data.rows.length, 2);
  assert.match(stale.readError, /last copy/);
});

test('reader with no cache and a Google failure returns no data + a message', async () => {
  const read = createPromoCodesReader({ fetchValues: async () => { throw new Error('down'); } });
  const p = await read();
  assert.equal(p.data, null);
  assert.match(p.readError, /Could not reach the Google Sheet/);
});
