// Fix: P180-P187 (FS + DEP rows) were written to W180:AX187 instead of A180:AB187.
// Clears the entire A180:AX187 range then re-writes all 8 rows to A180:AB187.
//
// Run: node bin/fix-whale-probe-row-offset.mjs
import { getSheetsClient, getSpreadsheetId, listTabs } from '../src/sheets-client.js';

const ALL_BRANDS = 'WS1, WS2, QP2A, QP2B, QP2C, QP2D, QPRO1, QPRO2, QPRO3, QPRO4, QPRO5, QPRO6, QPRO7, QPRO8, QPRO9, QPRO10, QPRO15, QPRO16';
const REGIONS   = 'MY, SG';
const DATE      = '11 Jul 2026';

function fsRow(pid, dep, spins, vps, maxWd, to, code) {
  return [
    '',          // A status
    'Info Ready',// B remark
    'No',        // C banner_needed
    pid,         // D request_id
    'JT',        // E requestor
    DATE,        // F date
    'Urgent',    // G priority
    'Urgent',    // H deadline
    ALL_BRANDS,  // I brands
    REGIONS,     // J regions
    'Whale - Probe', // K campaign
    'Free Spin', // L bonus_type
    `${spins} Free Spins - Gates of Olympus (Pragmatic Play), Min Dep ${dep}, Spin value: ${vps}, ${to}X TO, Max Withdraw ${maxWd}, Slots only`, // M name_details
    'TRUE',      // N inbox_message
    'TRUE',      // O popup_dialog
    '7',         // P validity
    '3',         // Q rewards_validity
    '',          // R expiry_minutes
    'One Time',  // S recurring
    '1',         // T max_per_player
    '',          // U change_type
    '',          // V change_details
    code,        // W promo_code
    `${spins} Free Spins (Gates of Olympus)\nWS1/WS2: Whale Probe ${spins}FS GOO`, // X promo_name_en
    '',          // Y promo_name_zhid
    'JT',        // Z stakeholder
    'No',        // AA no_deposit
    'WHALE_CRM_PROBE', // AB suggested_prefix
  ];
}

const WS1_LABEL = ['I', 'II', 'III', 'IV'];
function depRow(pid, dep, maxBonus, to, code, tierIdx) {
  return [
    '',          // A status
    'Info Ready',// B remark
    'No',        // C banner_needed
    pid,         // D request_id
    'JT',        // E requestor
    DATE,        // F date
    'Urgent',    // G priority
    'Urgent',    // H deadline
    ALL_BRANDS,  // I brands
    REGIONS,     // J regions
    'Whale - Probe', // K campaign
    'Deposit Bonus', // L bonus_type
    `Dep ${dep} get ${maxBonus}, ${to}X TO`, // M name_details
    'TRUE',      // N inbox_message
    'TRUE',      // O popup_dialog
    '7',         // P validity
    '3',         // Q rewards_validity
    '',          // R expiry_minutes
    'One Time',  // S recurring
    '1',         // T max_per_player
    '',          // U change_type
    '',          // V change_details
    code,        // W promo_code
    `50% Deposit Bonus\nWS1/WS2: Whale Probe DEP50 ${WS1_LABEL[tierIdx]}`, // X promo_name_en
    '',          // Y promo_name_zhid
    'JT',        // Z stakeholder
    'No',        // AA no_deposit
    'WHALE_CRM_PROBE', // AB suggested_prefix
  ];
}

const ALL_ROWS = [
  fsRow('P180', 6000,  50,  60, 30000, 10, 'WHALE_CRM_PROBE_GOO50FS_10X'),
  fsRow('P181', 3000,  60,  25, 15000, 12, 'WHALE_CRM_PROBE_GOO60FS_12X'),
  fsRow('P182', 1500,  75,  10,  7500, 12, 'WHALE_CRM_PROBE_GOO75FS_12X'),
  fsRow('P183', 1000, 100,   5,  5000, 12, 'WHALE_CRM_PROBE_GOO100FS_12X'),
  depRow('P184', 6000, 3000, 10, 'WHALE_CRM_PROBE_DEP50PCT_3K_10X',   0),
  depRow('P185', 3000, 1500, 12, 'WHALE_CRM_PROBE_DEP50PCT_1500_12X', 1),
  depRow('P186', 1500,  750, 12, 'WHALE_CRM_PROBE_DEP50PCT_750_12X',  2),
  depRow('P187', 1000,  500, 12, 'WHALE_CRM_PROBE_DEP50PCT_500_12X',  3),
];

const client = await getSheetsClient();
const { sheets } = client;
const sid = getSpreadsheetId();

const tabs = await listTabs(client);
const tab = tabs.find((t) => /july\s*2026/i.test(t.name));
if (!tab) throw new Error(`July 2026 tab not found. Tabs: ${tabs.map((t) => t.name).join(', ')}`);
const tabName = tab.name;

// Step 1: clear everything in A180:AX187 — wipes the shifted W-AX garbage
await sheets.spreadsheets.values.clear({
  spreadsheetId: sid,
  range: `'${tabName}'!A180:AX187`,
});
console.log('Cleared A180:AX187');

// Step 2: write correct 28-column data directly to A180:AB187
const res = await sheets.spreadsheets.values.update({
  spreadsheetId: sid,
  range: `'${tabName}'!A180:AB187`,
  valueInputOption: 'USER_ENTERED',
  requestBody: { values: ALL_ROWS },
});
console.log(`Written ${res.data.updatedRows} rows → ${res.data.updatedRange}`);
ALL_ROWS.forEach((r, i) => console.log(`  Row ${180 + i}: ${r[3]} | ${r[11]} | ${r[22]}`)  );
console.log('\nNext: node bin/ingest-requests.js');
