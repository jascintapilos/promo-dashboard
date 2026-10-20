// Promo Codes — every Sales tab is read and de-duplicated; key-owner rule; Ops sheet copy writer.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SALES_TABS, PARSERS, parseVmAllCodes, parseTsmCodes, parseAmCodes, parseVmLiveByCampaign, parseBonusMenu, parseSalesAll,
} from '../src/qc-dashboard/promo-codes-parse.js';
import { canManagePromoCodesKey } from '../src/qc-dashboard/promo-codes-store.js';
import { writeGoodRun, writeFailedRun, DATA_HEADERS } from '../src/qc-dashboard/promo-codes-sheet.js';

const INDEX = [
  ['Index (All Teams)'], [],
  ['Team', 'Brand / Platform', 'Region', 'Live Code (BO)', 'Bonus Name / Offer', '', 'Status'],
  ['TSM', 'QP2A', 'MY, SG', 'WELC_138FS', '138 FS', '', 'Active'],
  ['TSM', 'QP2B', 'MY, SG', 'WELC_138FS', '138 FS', '', 'Active'],
  ['VM (menu)', 'ALL (QP2/QPRO)', 'MY, SG', 'VM_DEP150_GET50_2X', 'Dep150', '', 'Live: QP2A'],
];
const VM_ALL = [
  ['VM — All Codes'], [],
  ['Mechanic', 'Live Code (BO)', 'QP2/QPRO Brands', 'Region', 'Type', 'Bonus Name', 'Status', 'Last Update'],
  ['1 · Deposit-match  (81)'],
  ['', 'FT_VM_DEP2000_GET700_5X', 'QPRO2', 'MY, SG', 'Recurring', 'Dep 2000 get 700', 'Active', ''],
  ['', 'VM_DEP150_GET50_2X', 'QPRO1', 'MY', 'Recurring', 'dup of Index', 'Active', ''],
  ['2 · Free credit  (3)'],
  ['', 'VM_FC_388_8X', 'QPRO2-3', 'MY', 'One-time', 'RM388', 'Active', ''],
];
const TSM = [
  ['TSM'], [],
  ['Segment', 'Brand / Platform', 'Region', 'Offer', 'Live Code (BO)', 'Status', 'Last Update'],
  ['Fresh Leads  (48)'],
  ['', 'QP2A', 'MY, SG', '138 FS', 'WELC_138FS', 'Active', ''],
  ['', 'QP2C', 'MY', '50 FS', 'TSM_ONLY_CODE', 'Active', ''],
];
const AM = [
  ['AM'], [],
  ['Campaign', 'Live Code (BO)', 'Bonus Name', 'Brand coverage', 'Region', 'Note', 'Status', 'Last Update'],
  ['1a · Free Spins — Gate of Olympus  (7)'],
  ['', 'AM_FS_OLYMP_10', 'FREESPIN AM', '17 brands', 'MY, SG', '', 'Active (13 brands)\nLive: QPRO1-2\nInactive: QP2A', ''],
];
const LIVE = [
  ['VM — Live Codes by Campaign'], [],
  ['Campaign', 'Code — QP2/QPRO', 'QP2/QPRO Brands', 'Code — WS1/WS2', 'Region', 'Bonus Name', 'TO'],
  ['Fixed Free Credit ladder  (27)'],
  ['', 'VM_FC_388_8X', 'QPRO2-3, QPRO5', 'FT_VM_FC_388_8X', 'MY, SG', 'RM388', '8x'],
  ['', 'VM_FC_588_8X', 'QP2A', '', 'MY', 'RM588', '8x'],
];
const MENU = [
  [], [],
  ['', '#', 'PROMO CODE ', 'PROMO CODE FOR WS1 + WS2', 'Bonus NAME', 'Remark', 'Status (BO 2026-09-07)'],
  ['', '1', 'VM_DEP150_GET50_2X', 'FT_VM_DEP150_GET50_2X', 'VM Bns - Dep150', '', 'Live'],
  ['', '2', 'VM_DEP1000_GET500_5X', '', 'VM Bns - Dep1000', '', 'Live'],
  ['', '3', 'FT_VMFC_VARIABLE_3X', 'FT_VMFC_VARIABLE_3X', 'VIP FC 3x', '', 'Live'],
];
const ALL_TABS = {
  'Index (All Teams)': INDEX, 'VM - All Codes (BO)': VM_ALL, 'TSM - Codes by Segment x Brand': TSM,
  'AM - Codes by Campaign': AM, 'VM - Live Codes by Campaign': LIVE, 'Bonus Menu': MENU,
};

test('VM - All Codes: group headings become the section', () => {
  const rows = parseVmAllCodes(VM_ALL);
  assert.deepEqual(rows.map((r) => [r.code, r.section, r.type]), [
    ['FT_VM_DEP2000_GET700_5X', 'Deposit-match', 'Recurring'],
    ['VM_DEP150_GET50_2X', 'Deposit-match', 'Recurring'],
    ['VM_FC_388_8X', 'Free credit', 'One-time'],
  ]);
  assert.deepEqual(rows[2].brands, ['QPRO2', 'QPRO3']);
});

test('TSM and AM tabs parse; AM "17 brands" takes its brands from the Status lists', () => {
  const tsm = parseTsmCodes(TSM);
  assert.deepEqual(tsm.map((r) => [r.code, r.group, r.section, r.brands.join()]), [
    ['WELC_138FS', 'TSM', 'Fresh Leads', 'QP2A'], ['TSM_ONLY_CODE', 'TSM', 'Fresh Leads', 'QP2C'],
  ]);
  const [am] = parseAmCodes(AM);
  assert.equal(am.brandsAll, true);
  assert.deepEqual(am.brands, ['QPRO1', 'QPRO2', 'QP2A']);
  assert.deepEqual(am.expectedOff, ['QP2A']);
  assert.equal(am.section, 'Free Spins — Gate of Olympus');
});

test('Live Codes by Campaign: one line → QP2/QPRO code + its FT_ WS1/WS2 twin (no claim)', () => {
  const rows = parseVmLiveByCampaign(LIVE);
  assert.deepEqual(rows.map((r) => [r.code, r.brands.join(), r.noClaim, r.wsCode]), [
    ['VM_FC_388_8X', 'QPRO2,QPRO3,QPRO5', false, 'FT_VM_FC_388_8X'],
    ['FT_VM_FC_388_8X', 'WS1,WS2', true, ''],
    ['VM_FC_588_8X', 'QP2A', false, ''],
  ]);
});

test('Bonus Menu: all QP2/QPRO brands; WS twin is its own row; same code in both columns = ALL + WS', () => {
  const rows = parseBonusMenu(MENU);
  assert.deepEqual(rows.map((r) => [r.code, r.brandsAll, r.brandsAllWs, r.brands.join(), r.noClaim, r.section]), [
    ['VM_DEP150_GET50_2X', true, false, '', false, 'Bonus Menu'],
    ['FT_VM_DEP150_GET50_2X', false, false, 'WS1,WS2', true, 'Bonus Menu'],
    ['VM_DEP1000_GET500_5X', true, false, '', false, 'Bonus Menu'],
    ['FT_VMFC_VARIABLE_3X', true, true, '', false, 'Bonus Menu'],
  ]);
});

test('parseSalesAll: Index wins, later tabs only add codes not seen before; per-brand Index rows kept', () => {
  const rows = parseSalesAll(ALL_TABS);
  const codes = rows.map((r) => r.code);
  assert.deepEqual(codes, [
    'WELC_138FS', 'WELC_138FS', 'VM_DEP150_GET50_2X',          // Index (2 rows for WELC_138FS kept)
    'FT_VM_DEP2000_GET700_5X', 'VM_FC_388_8X',                // VM All (VM_DEP150 already in Index)
    'TSM_ONLY_CODE',                                           // TSM
    'AM_FS_OLYMP_10',                                          // AM
    'FT_VM_FC_388_8X', 'VM_FC_588_8X',                         // Live by Campaign (VM_FC_388_8X already seen)
    'FT_VM_DEP150_GET50_2X', 'VM_DEP1000_GET500_5X', 'FT_VMFC_VARIABLE_3X', // Bonus Menu
  ]);
  assert.equal(rows.find((r) => r.code === 'VM_DEP150_GET50_2X').offer, 'Dep150'); // the Index row, not VM All
  assert.deepEqual(SALES_TABS, Object.keys(ALL_TABS));
});

test('a missing Sales tab is an error, not silently fewer codes', () => {
  const { 'Bonus Menu': _, ...without } = ALL_TABS;
  assert.throws(() => parseSalesAll(without), /Sales tab "Bonus Menu" not found/);
});

test('PARSERS take {tab: values} for every source', () => {
  assert.equal(PARSERS.Sales(ALL_TABS).length, 12);
  assert.equal(PARSERS.CEE({ 'CEE Codes': [['Section', 'Live Code (BO)', 'Brands'], ['X', 'C1', 'QP2A']] }).length, 1);
  assert.equal(PARSERS.CRM({ 'All CRM Codes': [['Stakeholder', 'Live Code (BO)', 'Brands'], ['Kien', 'C2', 'QP2B']] }).length, 1);
});

test('key owners: admins + keyOwners only; viewers alone are not owners', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pc-owner-'));
  const file = path.join(dir, 'viewers.json');
  const prev = process.env.PROMO_CODES_VIEWERS_PATH;
  process.env.PROMO_CODES_VIEWERS_PATH = file;
  try {
    writeFileSync(file, JSON.stringify({ emails: ['viewer@x.co', 'owner@x.co'], keyOwners: ['Owner@X.co'] }));
    assert.equal(canManagePromoCodesKey({ email: 'owner@x.co', role: 'promo-team' }), true);
    assert.equal(canManagePromoCodesKey({ email: 'viewer@x.co', role: 'promo-team' }), false);
    assert.equal(canManagePromoCodesKey({ email: 'boss@x.co', role: 'admin' }), true);
    assert.equal(canManagePromoCodesKey(null), false);
    writeFileSync(file, '{ bad');
    assert.equal(canManagePromoCodesKey({ email: 'owner@x.co', role: 'promo-team' }), false);
  } finally {
    if (prev === undefined) delete process.env.PROMO_CODES_VIEWERS_PATH; else process.env.PROMO_CODES_VIEWERS_PATH = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

// Minimal stand-in for the googleapis sheets client.
function fakeSheets({ rowCount = 0, status = [] } = {}) {
  const calls = [];
  const tabs = rowCount ? [{ properties: { title: 'Promo Codes', gridProperties: { rowCount } } }, { properties: { title: 'Promo Codes Status', gridProperties: { rowCount: 20 } } }] : [];
  return {
    calls,
    spreadsheets: {
      get: async () => ({ data: { sheets: tabs } }),
      batchUpdate: async (a) => { calls.push(['addSheet', a.requestBody.requests.map((r) => r.addSheet.properties.title)]); },
      values: {
        update: async (a) => { calls.push(['update', a.range, a.requestBody.values.length, a.valueInputOption]); },
        clear: async (a) => { calls.push(['clear', a.range]); },
        get: async () => ({ data: { values: status } }),
      },
    },
  };
}
const ROW = { source: 'CEE', code: 'C1', brands: ['QP2A'], regions: [], bo: { QP2A: 'active' }, mismatch: [] };

test('Ops sheet copy: new tabs created, data written RAW before status; no clear past the grid', async () => {
  const s = fakeSheets();
  await writeGoodRun(s, 'sheet', { pulledAt: 't', boCheckedAt: 't', rows: [ROW, ROW], sources: {}, siteErrors: [] });
  assert.deepEqual(s.calls, [
    ['addSheet', ['Promo Codes', 'Promo Codes Status']],
    ['update', `'Promo Codes'!A1:S3`, 3, 'RAW'],
    ['update', `'Promo Codes Status'!A1:B10`, 10, 'RAW'],
  ]);
  assert.equal(DATA_HEADERS.length, 19);
});

test('Ops sheet copy: leftover rows from a longer list are cleared; a failed run keeps last-good fields', async () => {
  const s = fakeSheets({ rowCount: 1400 });
  await writeGoodRun(s, 'sheet', { pulledAt: 't', boCheckedAt: 't', rows: [ROW], sources: {}, siteErrors: [] });
  assert.deepEqual(s.calls[1], ['clear', `'Promo Codes'!A3:S1400`]);
  const f = fakeSheets({ rowCount: 1400, status: [['Field', 'Value'], ['Last good update', 'G'], ['BO checked at', 'B']] });
  let written;
  f.spreadsheets.values.update = async (a) => { written = a.requestBody.values; };
  await writeFailedRun(f, 'sheet', { pulledAt: 'now', detail: 'BO down' });
  const kv = Object.fromEntries(written);
  assert.equal(kv.Result, 'FAILED');
  assert.equal(kv['Last good update'], 'G');
  assert.equal(kv['BO checked at'], 'B');
  assert.equal(kv.Detail, 'BO down');
});

test('WS1/WS2 are checked under the FT_ twin (listed pair first, else FT_ + code)', async () => {
  const { applyBoStatus } = await import('../src/qc-dashboard/promo-codes-parse.js');
  const idx = [
    ['Team', 'Brand / Platform', 'Region', 'Live Code (BO)', 'Bonus Name / Offer', '', 'Status'],
    ['VM', 'QP2/QPRO + WS', 'MY', 'VM_FC_VARIABLE_8X', '', '', 'Active\nLive: QP2A, WS2'],
    ['VM', 'QP2/QPRO + WS', 'MY', 'VM_FC_388_8X', '', '', 'Active\nLive: QPRO2, WS1'],
  ];
  const live = [
    ['Campaign', 'Code — QP2/QPRO', 'QP2/QPRO Brands', 'Code — WS1/WS2', 'Region', 'Bonus Name', 'TO'],
    ['', 'VM_FC_VARIABLE_8X', 'QP2A', 'FT_VM_FC_VARIABLE_8X_V2', 'MY', '', ''],
  ];
  const rows = parseSalesAll({ ...ALL_TABS, 'Index (All Teams)': idx, 'VM - Live Codes by Campaign': live });
  const variable = rows.find((r) => r.code === 'VM_FC_VARIABLE_8X');
  assert.equal(variable.wsCode, 'FT_VM_FC_VARIABLE_8X_V2'); // twin attached to the Index row
  const out = applyBoStatus(rows.filter((r) => ['VM_FC_VARIABLE_8X', 'VM_FC_388_8X'].includes(r.code)), {
    liveCodes: [
      { brand: 'QP2A', code: 'VM_FC_VARIABLE_8X' }, { brand: 'WS2', code: 'FT_VM_FC_VARIABLE_8X_V2' },
      { brand: 'QPRO2', code: 'VM_FC_388_8X' }, { brand: 'WS1_MY', code: 'FT_VM_FC_388_8X' },
    ],
    checkedBrands: ['QP2A', 'QPRO2', 'WS1_MY', 'WS2'],
    igmpSites: [{ brand: 'WS1_MY', region: 'MY' }, { brand: 'WS2', region: 'MY' }], allBrandKeys: ['QP2A', 'QPRO2'],
  });
  for (const r of out) assert.deepEqual(r.mismatch, [], r.code);
  assert.equal(out[0].bo.WS2, 'active');
  assert.equal(out[1].bo.WS1_MY, 'active');
  // QP2/QPRO brands are NOT matched via the FT_ fallback.
  const qp = applyBoStatus([{ ...out[1], brandsAll: false, brands: ['QPRO3'], expectedOff: [] }], {
    liveCodes: [{ brand: 'QPRO3', code: 'FT_VM_FC_388_8X' }], checkedBrands: ['QPRO3'], igmpSites: [], allBrandKeys: [],
  });
  assert.equal(qp[0].bo.QPRO3, 'inactive');
});
