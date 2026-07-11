// Append 4 Whale Probe Free Spin rows (P180-P183) to the July 2026 sheet tab.
// Gates of Olympus (Pragmatic Play): 50/60/75/100 spins, MY+SG, all brands, One Time.
// Dep 6000→50FS VPS60 10X | Dep 3000→60FS VPS25 12X | Dep 1500→75FS VPS10 12X | Dep 1000→100FS VPS5 12X
//
// Run: node bin/append-whale-probe-fs.mjs [--dry-run]
import { parseArgs } from './_args.js';
import { getSheetsClient, getSpreadsheetId, listTabs } from '../src/sheets-client.js';

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
function row(pid, dep, spins, vps, maxWd, to, code) {
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
    'Free Spin',                                  // L bonus_type
    `${spins} Free Spins - Gates of Olympus (Pragmatic Play), Min Dep ${dep}, Spin value: ${vps}, ${to}X TO, Max Withdraw ${maxWd}, Slots only`,  // M name_details
    'TRUE',                                       // N inbox_message
    'TRUE',                                       // O popup_dialog
    '7',                                          // P validity (days)
    '3',                                          // Q rewards_validity (days)
    '',                                           // R expiry_minutes (WS1 only)
    'One Time',                                   // S recurring
    '1',                                          // T max_per_player
    '',                                           // U change_type
    '',                                           // V change_details
    code,                                         // W promo_code
    `${spins} Free Spins (Gates of Olympus)\nWS1/WS2: Whale Probe ${spins}FS GOO`,  // X promo_name_en
    '',                                           // Y promo_name_zhid
    'JT',                                         // Z stakeholder
    'No',                                         // AA no_deposit
    'WHALE_CRM_PROBE',                            // AB suggested_prefix
  ];
}

const ROWS = [
  row('P180', 6000,  50,  60, 30000, 10, 'WHALE_CRM_PROBE_GOO50FS_10X'),
  row('P181', 3000,  60,  25, 15000, 12, 'WHALE_CRM_PROBE_GOO60FS_12X'),
  row('P182', 1500,  75,  10,  7500, 12, 'WHALE_CRM_PROBE_GOO75FS_12X'),
  row('P183', 1000, 100,   5,  5000, 12, 'WHALE_CRM_PROBE_GOO100FS_12X'),
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
console.log('\nNext: node bin/ingest-requests.js → verify P180-P183 parsed correctly');
