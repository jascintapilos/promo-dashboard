// Fixes the whale probe row placement.
// 1. Finds the true last data row in the July tab (scans col D for last P###)
// 2. Clears rows 180-187 (the wrong-position FS/DEP data)
// 3. Writes all 12 rows (FS x4, DEP x4, FC x4) immediately after last existing row
// 4. Assigns P numbers sequentially from (last_p_num + 1)
//
// Run: node bin/fix-whale-probe-all-rows.mjs
import { getSheetsClient, getSpreadsheetId, listTabs } from '../src/sheets-client.js';

const ALL_BRANDS = 'WS1, WS2, QP2A, QP2B, QP2C, QP2D, QPRO1, QPRO2, QPRO3, QPRO4, QPRO5, QPRO6, QPRO7, QPRO8, QPRO9, QPRO10, QPRO15, QPRO16';
const REGIONS   = 'MY, SG';
const DATE      = '11 Jul 2026';

function fsRow(pid, dep, spins, vps, maxWd, to, code) {
  return [
    '',          'Info Ready', 'No', pid, 'JT', DATE, 'Urgent', 'Urgent',
    ALL_BRANDS, REGIONS, 'Whale - Probe', 'Free Spin',
    `${spins} Free Spins - Gates of Olympus (Pragmatic Play), Min Dep ${dep}, Spin value: ${vps}, ${to}X TO, Max Withdraw ${maxWd}, Slots only`,
    'TRUE', 'TRUE', '7', '3', '', 'One Time', '1', '', '',
    code,
    `${spins} Free Spins (Gates of Olympus)\nWS1/WS2: Whale Probe ${spins}FS GOO`,
    '', 'JT', 'No', 'WHALE_CRM_PROBE',
  ];
}

const WS1_DEP = ['I', 'II', 'III', 'IV'];
function depRow(pid, dep, maxBonus, to, code, ti) {
  return [
    '',          'Info Ready', 'No', pid, 'JT', DATE, 'Urgent', 'Urgent',
    ALL_BRANDS, REGIONS, 'Whale - Probe', 'Deposit Bonus',
    `Dep ${dep} get ${maxBonus}, ${to}X TO`,
    'TRUE', 'TRUE', '7', '3', '', 'One Time', '1', '', '',
    code,
    `50% Deposit Bonus\nWS1/WS2: Whale Probe DEP50 ${WS1_DEP[ti]}`,
    '', 'JT', 'No', 'WHALE_CRM_PROBE',
  ];
}

function fcRow(pid, fcAmt, code) {
  return [
    '',          'Info Ready', 'No', pid, 'VM', DATE, 'Urgent', 'Urgent',
    ALL_BRANDS, REGIONS, 'Whale - Probe', 'Free Credit',
    `Free Credit ${fcAmt} - 20X TO, no max transfer`,
    'TRUE', 'TRUE', '1', '3', '', 'One Time', '1', '', '',
    code,
    `Free Credit ${fcAmt}`,
    '', 'JT', 'Yes', 'WHALE_VM_PROBE_NODEP',
  ];
}

const client = await getSheetsClient();
const { sheets } = client;
const sid = getSpreadsheetId();

const tabs = await listTabs(client);
const tab = tabs.find((t) => /july\s*2026/i.test(t.name));
if (!tab) throw new Error(`July 2026 tab not found. Tabs: ${tabs.map((t) => t.name).join(', ')}`);
const tabName = tab.name;

// --- Find last real data row by scanning column D (request_id) ---
const scan = await sheets.spreadsheets.values.get({
  spreadsheetId: sid,
  range: `'${tabName}'!D2:D300`,
  valueRenderOption: 'UNFORMATTED_VALUE',
});
const dVals = scan.data.values || [];
let lastOffset = -1;
let lastPNum = 0;
for (let i = 0; i < dVals.length; i++) {
  const v = dVals[i]?.[0];
  if (v && /^P\d+$/i.test(String(v))) {
    lastOffset = i;
    lastPNum = parseInt(String(v).slice(1), 10);
  }
}

if (lastOffset < 0) throw new Error('No P### values found in column D of July tab');

const lastDataRow = 2 + lastOffset;       // 1-indexed sheet row of last data
const firstNewRow = lastDataRow + 1;      // where new data goes
console.log(`Last existing: D${lastDataRow} = P${String(lastPNum).padStart(3,'0')} → writing from row ${firstNewRow}`);

// Assign 12 sequential P numbers: FS (x4), DEP (x4), FC (x4)
const p = (n) => `P${String(n).padStart(3, '0')}`;
let next = lastPNum + 1;

const FS_ROWS = [
  fsRow(p(next++), 6000,  50,  60, 30000, 10, 'WHALE_CRM_PROBE_GOO50FS_10X'),
  fsRow(p(next++), 3000,  60,  25, 15000, 12, 'WHALE_CRM_PROBE_GOO60FS_12X'),
  fsRow(p(next++), 1500,  75,  10,  7500, 12, 'WHALE_CRM_PROBE_GOO75FS_12X'),
  fsRow(p(next++), 1000, 100,   5,  5000, 12, 'WHALE_CRM_PROBE_GOO100FS_12X'),
];
const DEP_ROWS = [
  depRow(p(next++), 6000, 3000, 10, 'WHALE_CRM_PROBE_DEP50PCT_3K_10X',   0),
  depRow(p(next++), 3000, 1500, 12, 'WHALE_CRM_PROBE_DEP50PCT_1500_12X', 1),
  depRow(p(next++), 1500,  750, 12, 'WHALE_CRM_PROBE_DEP50PCT_750_12X',  2),
  depRow(p(next++), 1000,  500, 12, 'WHALE_CRM_PROBE_DEP50PCT_500_12X',  3),
];
const FC_ROWS = [
  fcRow(p(next++), '88',  'WHALE_VM_PROBE_NODEP_FC88_20X'),
  fcRow(p(next++), '118', 'WHALE_VM_PROBE_NODEP_FC118_20X'),
  fcRow(p(next++), '138', 'WHALE_VM_PROBE_NODEP_FC138_20X'),
  fcRow(p(next++), '148', 'WHALE_VM_PROBE_NODEP_FC148_20X'),
];

const ALL_ROWS = [...FS_ROWS, ...DEP_ROWS, ...FC_ROWS];
const lastNewRow = firstNewRow + ALL_ROWS.length - 1;

console.log('\nWill write:');
ALL_ROWS.forEach((r, i) => console.log(`  Row ${firstNewRow + i}: ${r[3]} | ${r[11]} | ${r[22]}`));

// --- Step 1: clear the bad rows 180-187 (wrong-position data from earlier) ---
await sheets.spreadsheets.values.clear({
  spreadsheetId: sid,
  range: `'${tabName}'!A180:AB187`,
});
console.log('\nCleared A180:AB187 (removed wrong-position data)');

// --- Step 2: write all 12 rows at correct position ---
const res = await sheets.spreadsheets.values.update({
  spreadsheetId: sid,
  range: `'${tabName}'!A${firstNewRow}:AB${lastNewRow}`,
  valueInputOption: 'USER_ENTERED',
  requestBody: { values: ALL_ROWS },
});
console.log(`Written ${res.data.updatedRows} rows → ${res.data.updatedRange}`);
