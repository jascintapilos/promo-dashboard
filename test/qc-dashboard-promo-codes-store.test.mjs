// Promo Codes tab — sheet parsing, BO status/mismatch logic, store + allowlist.
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expandBrands, parseRegions, parseStatusSegments, brandScope, findHeaderRow,
  parseCeeCodes, parseSalesIndex, parseCrmAll, applyBoStatus,
} from '../src/qc-dashboard/promo-codes-parse.js';
import {
  validatePromoCodesPush, applyPromoCodesPush, readPromoCodes, canViewPromoCodes, loadPromoCodeViewers,
} from '../src/qc-dashboard/promo-codes-store.js';

const IGMP = [
  { brand: 'WS1_MY', region: 'MY' }, { brand: 'WS1_SG', region: 'SG' }, { brand: 'WS2', region: 'MY' },
];
const ALL_KEYS = ['QPRO1', 'QPRO2', 'QPRO3', 'QP2A', 'QP2B'];

test('expandBrands expands ranges and keeps unknown brands', () => {
  assert.deepEqual(expandBrands('QP2A, QP2B, QPRO1-4'), ['QP2A', 'QP2B', 'QPRO1', 'QPRO2', 'QPRO3', 'QPRO4']);
  assert.deepEqual(expandBrands('QPRO2-3, QPRO5'), ['QPRO2', 'QPRO3', 'QPRO5']);
  assert.deepEqual(expandBrands('QP2A-D'), ['QP2A', 'QP2B', 'QP2C', 'QP2D']);
  assert.deepEqual(expandBrands('WS1/WS2 only'), ['WS1', 'WS2']);
  assert.deepEqual(expandBrands('WS1 MY'), ['WS1']);
  assert.deepEqual(expandBrands('ZG1, UG01'), ['ZG1', 'UG01']);
  assert.deepEqual(expandBrands('—'), []);
});

test('parseRegions keeps known market codes only', () => {
  assert.deepEqual(parseRegions('MY + SG'), ['MY', 'SG']);
  assert.deepEqual(parseRegions('MY, SG, ID'), ['MY', 'SG', 'ID']);
  assert.deepEqual(parseRegions(''), []);
});

test('parseStatusSegments reads labelled brand lists', () => {
  const a = parseStatusSegments('Active (13 brands)\nLive: QPRO1-3\nInactive: QP2A-B\nNot checked: QPRO11-12');
  assert.deepEqual(a.on, ['QPRO1', 'QPRO2', 'QPRO3']);
  assert.deepEqual(a.off, ['QP2A', 'QP2B']);
  assert.deepEqual(a.skip, ['QPRO11', 'QPRO12']);
  const b = parseStatusSegments('Active on BO: QP2A, QP2B\nSwitched off on BO: QPRO2-4');
  assert.deepEqual(b.on, ['QP2A', 'QP2B']);
  assert.deepEqual(b.off, ['QPRO2', 'QPRO3', 'QPRO4']);
  // "Still active on BO:" must not ALSO be read as "active on BO:" (no duplicates).
  const c = parseStatusSegments('⚠ Still active on BO: QP2A, QPRO1-2');
  assert.deepEqual(c.on, ['QP2A', 'QPRO1', 'QPRO2']);
});

test('brandScope recognises group labels', () => {
  assert.deepEqual(brandScope('ALL (QP2/QPRO)'), { all: true, ws: false });
  assert.deepEqual(brandScope('QP2/QPRO + WS'), { all: true, ws: true });
  assert.deepEqual(brandScope('ALL (except WS1)'), { all: true, ws: false });
  assert.deepEqual(brandScope('21 brands'), { all: true, ws: false });
  assert.deepEqual(brandScope('QPRO1'), { all: false, ws: false });
  assert.deepEqual(brandScope('WS1/WS2 only'), { all: false, ws: false });
});

test('findHeaderRow skips title and blank rows', () => {
  const v = [['All CEE codes — 31 codes'], [], ['Section', 'Live Code (BO)', 'Brands']];
  assert.equal(findHeaderRow(v, ['Section', 'Live Code (BO)']).index, 2);
  assert.equal(findHeaderRow(v, ['Nope']), null);
});

const CEE = [
  ['All CEE codes — title'], [],
  ['Section', 'Live Code (BO)', 'Brands', 'Region', 'Game Category', 'Offer (from CEE list)', 'Status', 'Note'],
  ['Deposit — Reload', 'REL_A', 'QP2A, QPRO1-2', 'SG', 'Slots', '12% bonus', 'Active', 'CEE list row 30'],
  ['Free Spin — Reload', 'REL_B', 'QP2A, QPRO2-3', 'SG', 'Slots', '80 FS', 'Active on BO: QP2A\nSwitched off on BO: QPRO2-3', ''],
  ['Not in use anymore (crossed out on CEE list)', 'RET_OLD', 'QP2A, QPRO1', 'SG', 'Slots', '199 FS', '⚠ Still active on BO: QP2A, QPRO1', ''],
  ['', '', '', '', '', '', '', ''],
];

test('parseCeeCodes reads rows and marks crossed-out codes retired', () => {
  const rows = parseCeeCodes(CEE);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].brands, ['QP2A', 'QPRO1', 'QPRO2']);
  assert.equal(rows[0].retired, false);
  assert.deepEqual(rows[1].expectedOff, ['QPRO2', 'QPRO3']);
  assert.equal(rows[2].retired, true);
  assert.deepEqual(rows[2].expectedOff, ['QP2A', 'QPRO1']);
});

test('parseSalesIndex handles ALL rows and "Not checked" rows', () => {
  const rows = parseSalesIndex([
    ['Index (All Teams)'], [],
    ['Team', 'Brand / Platform', 'Region', 'Live Code (BO)', 'Bonus Name / Offer', '', 'Status', 'Last Update'],
    ['VM (menu)', 'ALL (QP2/QPRO)', 'MY, SG', 'VM_X', 'Dep150 Get50', '', 'Active\nLive: QP2A, QPRO1-2\nNot checked: QPRO3', ''],
    ['VM', 'WS1/WS2 only', 'MY', 'FT_VM_Y', 'FC', '', 'Not checked WS1, WS2 BO not reachable (no session)', ''],
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].brandsAll, true);
  assert.deepEqual(rows[0].brands, ['QP2A', 'QPRO1', 'QPRO2']); // "Not checked" brands are not claimed
  assert.equal(rows[1].noClaim, true);
  assert.deepEqual(rows[1].brands, ['WS1', 'WS2']);
});

test('parseCrmAll reads stakeholder rows', () => {
  const rows = parseCrmAll([
    ['All CRM codes in one list'], [],
    ['Stakeholder', 'CRM PIC', 'Brands', 'Region', 'Live Code (BO)', 'Bonus Name', 'Mechanic', 'Type', 'Status', 'Last Update'],
    ['Kien', 'Ryan', 'QP2B, QPRO1', 'MY', 'FT_RET_X', '10% Reload', 'Deposit — Reload', 'Recurring', 'Active', '—'],
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].group, 'Kien');
  assert.equal(rows[0].pic, 'Ryan');
  assert.equal(rows[0].section, 'Deposit — Reload');
  assert.deepEqual(rows[0].brands, ['QP2B', 'QPRO1']);
});

test('header missing throws a clear error', () => {
  assert.throws(() => parseCrmAll([['nothing here']]), /header row not found/);
});

test('applyBoStatus: active / inactive / unchecked and mismatch rules', () => {
  const rows = parseCeeCodes(CEE);
  const live = [
    { brand: 'QP2A', code: 'REL_A' }, { brand: 'QPRO1', code: 'rel_a' }, // QPRO2 missing -> mismatch
    { brand: 'QP2A', code: 'REL_B' }, { brand: 'QPRO3', code: 'REL_B' }, // QPRO3 should be off -> mismatch
    { brand: 'QP2A', code: 'RET_OLD' },                                 // retired but live -> mismatch
  ];
  const out = applyBoStatus(rows, { liveCodes: live, checkedBrands: ['QP2A', 'QPRO1', 'QPRO2', 'QPRO3'], igmpSites: IGMP, allBrandKeys: ALL_KEYS });
  assert.deepEqual(out[0].bo, { QP2A: 'active', QPRO1: 'active', QPRO2: 'inactive' });
  assert.deepEqual(out[0].mismatch, ['QPRO2: not active on BO']);
  assert.deepEqual(out[1].mismatch, ['QPRO3: still active on BO']);
  assert.deepEqual(out[2].mismatch, ['QP2A: still active on BO']);
  assert.equal(out[2].bo.QPRO1, 'inactive'); // retired + off = fine, no mismatch
});

test('applyBoStatus: unchecked brands never raise a mismatch; expired is flagged', () => {
  const [row] = parseCeeCodes([CEE[2], ['Deposit', 'REL_Z', 'QP2A, ZG1', 'MY', '', '', 'Active', '']]);
  const out = applyBoStatus([row], {
    liveCodes: [{ brand: 'QP2A', code: 'REL_Z', validTo: '2020-01-01 00:00:00' }],
    checkedBrands: ['QP2A'], igmpSites: IGMP, allBrandKeys: ALL_KEYS,
  });
  assert.deepEqual(out[0].bo, { QP2A: 'expired', ZG1: 'unchecked' });
  assert.deepEqual(out[0].mismatch, ['QP2A: end date passed']);
});

test('applyBoStatus: WS1 splits by region; ALL rows only flag named brands', () => {
  const [ws] = parseCrmAll([
    ['Stakeholder', 'CRM PIC', 'Brands', 'Region', 'Live Code (BO)', 'Bonus Name', 'Mechanic', 'Type', 'Status'],
    ['Cedric', 'Claudia', 'WS1', 'MY, SG', 'FT_CRM_X', '', '', '', 'Active'],
  ]);
  const [all] = parseSalesIndex([
    ['Team', 'Brand / Platform', 'Region', 'Live Code (BO)', 'Bonus Name / Offer', '', 'Status'],
    ['VM', 'ALL (QP2/QPRO)', 'MY', 'VM_X', '', '', 'Live: QP2A'],
  ]);
  const out = applyBoStatus([ws, all], {
    liveCodes: [{ brand: 'WS1_MY', code: 'FT_CRM_X' }, { brand: 'QP2A', code: 'VM_X' }],
    checkedBrands: ['WS1_MY', 'WS1_SG', ...ALL_KEYS], igmpSites: IGMP, allBrandKeys: ALL_KEYS,
  });
  assert.deepEqual(out[0].bo, { WS1_MY: 'active', WS1_SG: 'inactive' });
  assert.deepEqual(out[0].mismatch, ['WS1_SG: not active on BO']);
  assert.equal(Object.keys(out[1].bo).length, ALL_KEYS.length);
  assert.deepEqual(out[1].mismatch, []); // QPRO1-3 / QP2B inactive but not named by the sheet
});

const goodPush = (rows) => ({
  ok: true, pulledAt: '2026-10-16T01:00:00.000Z', boCheckedAt: '2026-10-16T01:05:00.000Z',
  sources: { CEE: 1, Sales: 0, CRM: 0, Bogus: 9 }, siteErrors: [{ brand: 'WS1_SG', message: 'HTTP 500' }], rows,
});
const sampleRow = { source: 'CEE', code: 'REL_A', brands: ['QP2A'], regions: ['SG'], bo: { QP2A: 'active' }, mismatch: [] };

test('validatePromoCodesPush accepts a good body and rejects bad ones', () => {
  const rec = validatePromoCodesPush(goodPush([sampleRow]));
  assert.equal(rec.rows.length, 1);
  assert.deepEqual(rec.sources, { CEE: 1, Sales: 0, CRM: 0 });
  assert.throws(() => validatePromoCodesPush({ ...goodPush([sampleRow]), pulledAt: 'x' }), /pulledAt/);
  assert.throws(() => validatePromoCodesPush(goodPush([{ ...sampleRow, source: 'Other' }])), /source/);
  assert.throws(() => validatePromoCodesPush(goodPush([{ ...sampleRow, code: '' }])), /code/);
  assert.throws(() => validatePromoCodesPush(goodPush([{ ...sampleRow, bo: { QP2A: 'maybe' } }])), /bo entries/);
  assert.throws(() => validatePromoCodesPush(goodPush([{ ...sampleRow, bo: { '<script>': 'active' } }])), /bo entries/);
  assert.deepEqual(validatePromoCodesPush({ ok: false, pulledAt: '2026-10-16T01:00:00.000Z', detail: 'sheet error' }),
    { ok: false, pulledAt: '2026-10-16T01:00:00.000Z', detail: 'sheet error' });
});

test('apply/read: a failed push keeps the last good rows', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'promo-codes-store-'));
  try {
    assert.deepEqual(readPromoCodes(dir), { data: null, status: null });
    applyPromoCodesPush(dir, validatePromoCodesPush(goodPush([sampleRow])));
    const st = applyPromoCodesPush(dir, validatePromoCodesPush({ ok: false, pulledAt: '2026-10-17T01:00:00.000Z', detail: 'BO down' }));
    assert.equal(st.ok, false);
    assert.equal(st.lastGoodAt, '2026-10-16T01:00:00.000Z');
    const { data, status } = readPromoCodes(dir);
    assert.equal(data.rows[0].code, 'REL_A');
    assert.equal(status.detail, 'BO down');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('viewer allowlist: explicit emails only, case-insensitive, fails closed', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'promo-codes-viewers-'));
  const file = path.join(dir, 'viewers.json');
  const prev = process.env.PROMO_CODES_VIEWERS_PATH;
  process.env.PROMO_CODES_VIEWERS_PATH = file;
  try {
    assert.equal(canViewPromoCodes({ email: 'a@x.co', role: 'admin' }), false); // missing file
    writeFileSync(file, JSON.stringify({ emails: ['A@X.co'] }));
    assert.equal(canViewPromoCodes({ email: 'a@x.co', role: 'promo-team' }), true);
    assert.equal(canViewPromoCodes({ email: 'boss@x.co', role: 'admin' }), false); // admins not implied
    assert.equal(canViewPromoCodes(null), false);
    writeFileSync(file, '{ not json');
    assert.equal(loadPromoCodeViewers().size, 0);
  } finally {
    if (prev === undefined) delete process.env.PROMO_CODES_VIEWERS_PATH; else process.env.PROMO_CODES_VIEWERS_PATH = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('committed viewer list is valid JSON with emails', () => {
  const parsed = JSON.parse(readFileSync('promo-codes-viewers.json', 'utf8'));
  assert.ok(Array.isArray(parsed.emails) && parsed.emails.length > 0);
});
