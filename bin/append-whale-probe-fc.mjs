// Append 4 Whale Probe FC rows (P176-P179) to the July 2026 sheet tab.
// Promo ladder: RM88 / RM118 / RM138 / RM148 Free Credit, 20X TO, no max transfer,
// No deposit, MY+SG, all brands, Validity 1d, Rewards 3d, One Time.
//
// Run: node bin/append-whale-probe-fc.mjs [--dry-run]
import { parseArgs } from './_args.js';
import { getSheetsClient, getSpreadsheetId, resolveCurrentMonthTab } from '../src/sheets-client.js';

const { flags } = parseArgs(process.argv.slice(2));
const dryRun = flags['dry-run'] === true;

const ALL_BRANDS = 'WS1, WS2, QP2A, QP2B, QP2C, QP2D, QPRO1, QPRO2, QPRO3, QPRO4, QPRO5, QPRO6, QPRO7, QPRO8, QPRO9, QPRO10, QPRO15, QPRO16';
const REGIONS   = 'MY, SG';
const DATE      = '11 Jul 2026';

// Column layout: MAR2026 (28 cols A-AB)
// [A status, B remark, C banner_needed, D request_id, E requestor, F date, G priority, H deadline,
//  I brands, J regions, K campaign, L bonus_type, M name_details, N inbox_message, O popup_dialog,
//  P validity, Q rewards_validity, R expiry_minutes, S recurring, T max_per_player,
//  U change_type, V change_details, W promo_code, X promo_name_en, Y promo_name_zhid,
//  Z stakeholder, AA no_deposit, AB suggested_prefix]
function row(pid, fcAmt, code) {
  return [
    '',                                           // A status
    'Info Ready',                                 // B remark
    'No',                                         // C banner needed
    pid,                                          // D request_id
    'VM',                                         // E requestor
    DATE,                                         // F date
    'Urgent',                                     // G priority
    'Urgent',                                     // H deadline
    ALL_BRANDS,                                   // I brands
    REGIONS,                                      // J regions
    'Whale - Probe',                              // K campaign
    'Free Credit',                                // L bonus_type
    `Free Credit ${fcAmt} - 20X TO, no max transfer`,  // M name_details
    'TRUE',                                       // N inbox_message
    'TRUE',                                       // O popup_dialog
    '1',                                          // P validity
    '3',                                          // Q rewards_validity
    '',                                           // R expiry_minutes (WS1 only)
    'One Time',                                   // S recurring
    '1',                                          // T max_per_player
    '',                                           // U change_type
    '',                                           // V change_details
    code,                                         // W promo_code
    `Free Credit ${fcAmt}`,                       // X promo_name_en
    '',                                           // Y promo_name_zhid
    'JT',                                         // Z stakeholder
    'Yes',                                        // AA no_deposit
    'WHALE_VM_PROBE_NODEP',                       // AB suggested_prefix
  ];
}

const ROWS = [
  row('P176', '88',  'WHALE_VM_PROBE_NODEP_FC88_20X'),
  row('P177', '118', 'WHALE_VM_PROBE_NODEP_FC118_20X'),
  row('P178', '138', 'WHALE_VM_PROBE_NODEP_FC138_20X'),
  row('P179', '148', 'WHALE_VM_PROBE_NODEP_FC148_20X'),
];

console.log(`Appending ${ROWS.length} rows to July 2026 tab`);
ROWS.forEach((r) => console.log(`  ${r[3]} | ${r[22]} | FC ${r[23]}`));

if (dryRun) {
  console.log('\nDRY-RUN — pass no args to append for real');
  process.exit(0);
}

const client = await getSheetsClient();
const tabName = await resolveCurrentMonthTab(client);
const { sheets } = client;

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
console.log('\nNext: node bin/ingest-requests.js → verify P176-P179 parsed correctly');
