// Append 4 Whale Probe Deposit Bonus rows (P184-P187) to the July 2026 sheet tab.
// All Games, 50% deposit bonus, MY+SG, all brands, One Time.
// Dep 6000→Max3000 10X | Dep 3000→Max1500 12X | Dep 1500→Max750 12X | Dep 1000→Max500 12X
//
// Run: node bin/append-whale-probe-dep.mjs [--dry-run]
import { parseArgs } from './_args.js';
import { getSheetsClient, getSpreadsheetId, listTabs } from '../src/sheets-client.js';

const { flags } = parseArgs(process.argv.slice(2));
const dryRun = flags['dry-run'] === true;

const ALL_BRANDS = 'WS1, WS2, QP2A, QP2B, QP2C, QP2D, QPRO1, QPRO2, QPRO3, QPRO4, QPRO5, QPRO6, QPRO7, QPRO8, QPRO9, QPRO10, QPRO15, QPRO16';
const REGIONS   = 'MY, SG';
const DATE      = '11 Jul 2026';

// Roman numeral suffixes for WS1/WS2 uniqueness (one per tier, high→low deposit order)
const WS1_LABEL = ['I', 'II', 'III', 'IV'];

// Column layout: MAR2026 (28 cols A-AB)
// [A status, B remark, C banner_needed, D request_id, E requestor, F date, G priority, H deadline,
//  I brands, J regions, K campaign, L bonus_type, M name_details, N inbox_message, O popup_dialog,
//  P validity, Q rewards_validity, R expiry_minutes, S recurring, T max_per_player,
//  U change_type, V change_details, W promo_code, X promo_name_en, Y promo_name_zhid,
//  Z stakeholder, AA no_deposit, AB suggested_prefix]
function row(pid, dep, maxBonus, to, code, tierIdx) {
  return [
    '',                                           // A status
    'Info Ready',                                 // B remark
    'No',                                         // C banner needed
    pid,                                          // D request_id
    'JT',                                         // E requestor
    DATE,                                         // F date
    'Urgent',                                     // G priority
    'Urgent',                                     // H deadline
    ALL_BRANDS,                                   // I brands
    REGIONS,                                      // J regions
    'Whale - Probe',                              // K campaign
    'Deposit Bonus',                              // L bonus_type
    `Dep ${dep} get ${maxBonus}, ${to}X TO`,      // M name_details  (ingest derives 50% from dep/get ratio)
    'TRUE',                                       // N inbox_message
    'TRUE',                                       // O popup_dialog
    '7',                                          // P validity (days)
    '3',                                          // Q rewards_validity (days)
    '',                                           // R expiry_minutes
    'One Time',                                   // S recurring
    '1',                                          // T max_per_player
    '',                                           // U change_type
    '',                                           // V change_details
    code,                                         // W promo_code
    `50% Deposit Bonus\nWS1/WS2: Whale Probe DEP50 ${WS1_LABEL[tierIdx]}`,  // X promo_name_en
    '',                                           // Y promo_name_zhid
    'JT',                                         // Z stakeholder
    'No',                                         // AA no_deposit
    'WHALE_CRM_PROBE',                            // AB suggested_prefix
  ];
}

const ROWS = [
  row('P184', 6000, 3000, 10, 'WHALE_CRM_PROBE_DEP50PCT_3K_10X',   0),
  row('P185', 3000, 1500, 12, 'WHALE_CRM_PROBE_DEP50PCT_1500_12X', 1),
  row('P186', 1500,  750, 12, 'WHALE_CRM_PROBE_DEP50PCT_750_12X',  2),
  row('P187', 1000,  500, 12, 'WHALE_CRM_PROBE_DEP50PCT_500_12X',  3),
];

console.log(`Appending ${ROWS.length} rows to July 2026 tab`);
ROWS.forEach((r) => console.log(`  ${r[3]} | ${r[22]} | ${r[23].split('\n')[0]}`));

if (dryRun) {
  console.log('\nDRY-RUN — pass no args to append for real');
  process.exit(0);
}

const client = await getSheetsClient();
const { sheets } = client;
const tabs = await listTabs(client);
const tab = tabs.find((t) => /july\s*2026/i.test(t.name));
if (!tab) throw new Error(`July 2026 tab not found. Tabs: ${tabs.map((t) => t.name).join(', ')}`);
const tabName = tab.name;

const range = `'${tabName}'!A:AB`;
const res = await sheets.spreadsheets.values.append({
  spreadsheetId: getSpreadsheetId(),
  range,
  valueInputOption: 'USER_ENTERED',
  insertDataOption: 'INSERT_ROWS',
  requestBody: { values: ROWS },
});

console.log(`\n✓ Appended ${res.data.updates?.updatedRows ?? ROWS.length} row(s)`);
console.log(`  Range written: ${res.data.updates?.updatedRange}`);
console.log('\nNext: node bin/ingest-requests.js → verify P184-P187 parsed correctly');
