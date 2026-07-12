// Final placement: write all 12 whale probe rows at rows 66-77 (right after P064 at row 65).
// P065-P068: Free Spin | P069-P072: Deposit Bonus | P073-P076: Free Credit
// Run: node bin/place-whale-probe-rows.mjs
import { getSheetsClient, getSpreadsheetId, listTabs } from '../src/sheets-client.js';

const ALL_BRANDS = 'WS1, WS2, QP2A, QP2B, QP2C, QP2D, QPRO1, QPRO2, QPRO3, QPRO4, QPRO5, QPRO6, QPRO7, QPRO8, QPRO9, QPRO10, QPRO15, QPRO16';
const REGIONS   = 'MY, SG';
const DATE      = '11 Jul 2026';

function fsRow(pid, dep, spins, vps, maxWd, to, code) {
  return [
    '', 'Info Ready', 'No', pid, 'JT', DATE, 'Urgent', 'Urgent',
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
    '', 'Info Ready', 'No', pid, 'JT', DATE, 'Urgent', 'Urgent',
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
    '', 'Info Ready', 'No', pid, 'VM', DATE, 'Urgent', 'Urgent',
    ALL_BRANDS, REGIONS, 'Whale - Probe', 'Free Credit',
    `Free Credit ${fcAmt} - 20X TO, no max transfer`,
    'TRUE', 'TRUE', '1', '3', '', 'One Time', '1', '', '',
    code,
    `Free Credit ${fcAmt}`,
    '', 'JT', 'Yes', 'WHALE_VM_PROBE_NODEP',
  ];
}

const ALL_ROWS = [
  fsRow('P065', 6000,  50,  60, 30000, 10, 'WHALE_CRM_PROBE_GOO50FS_10X'),
  fsRow('P066', 3000,  60,  25, 15000, 12, 'WHALE_CRM_PROBE_GOO60FS_12X'),
  fsRow('P067', 1500,  75,  10,  7500, 12, 'WHALE_CRM_PROBE_GOO75FS_12X'),
  fsRow('P068', 1000, 100,   5,  5000, 12, 'WHALE_CRM_PROBE_GOO100FS_12X'),
  depRow('P069', 6000, 3000, 10, 'WHALE_CRM_PROBE_DEP50PCT_3K_10X',   0),
  depRow('P070', 3000, 1500, 12, 'WHALE_CRM_PROBE_DEP50PCT_1500_12X', 1),
  depRow('P071', 1500,  750, 12, 'WHALE_CRM_PROBE_DEP50PCT_750_12X',  2),
  depRow('P072', 1000,  500, 12, 'WHALE_CRM_PROBE_DEP50PCT_500_12X',  3),
  fcRow('P073', '88',  'WHALE_VM_PROBE_NODEP_FC88_20X'),
  fcRow('P074', '118', 'WHALE_VM_PROBE_NODEP_FC118_20X'),
  fcRow('P075', '138', 'WHALE_VM_PROBE_NODEP_FC138_20X'),
  fcRow('P076', '148', 'WHALE_VM_PROBE_NODEP_FC148_20X'),
];

const client = await getSheetsClient();
const { sheets } = client;
const sid = getSpreadsheetId();

const tabs = await listTabs(client);
const tab = tabs.find(t => /july\s*2026/i.test(t.name));
if (!tab) throw new Error('July 2026 tab not found');
const tabName = tab.name;

// Clear the wrong-position rows (188-199)
await sheets.spreadsheets.values.clear({ spreadsheetId: sid, range: `'${tabName}'!A188:AB199` });
console.log('Cleared A188:AB199');

// Write all 12 rows at A66:AB77
const res = await sheets.spreadsheets.values.update({
  spreadsheetId: sid,
  range: `'${tabName}'!A66:AB77`,
  valueInputOption: 'USER_ENTERED',
  requestBody: { values: ALL_ROWS },
});
console.log(`Written ${res.data.updatedRows} rows → ${res.data.updatedRange}`);
ALL_ROWS.forEach((r, i) => console.log(`  Row ${66+i}: ${r[3]} | ${r[11]} | ${r[22]}`));
