// Fix: the append landed data at W180:AX183 instead of A180:AB183.
// This script: clears the bad range, then uses values.update with an
// explicit row+column range so the 4 rows land in the right place.
//
// Run: node bin/fix-whale-probe-row-offset.mjs [--dry-run]
import { parseArgs } from './_args.js';
import { getSheetsClient, getSpreadsheetId, resolveCurrentMonthTab } from '../src/sheets-client.js';

const { flags } = parseArgs(process.argv.slice(2));
const dryRun = flags['dry-run'] === true;

const SPREADSHEET_ID = getSpreadsheetId();
const ALL_BRANDS = 'WS1, WS2, QP2A, QP2B, QP2C, QP2D, QPRO1, QPRO2, QPRO3, QPRO4, QPRO5, QPRO6, QPRO7, QPRO8, QPRO9, QPRO10, QPRO15, QPRO16';
const REGIONS   = 'MY, SG';
const DATE      = '11 Jul 2026';

function row(pid, fcAmt, code) {
  return [
    '',                                           // A  status
    'Info Ready',                                 // B  remark
    'No',                                         // C  banner_needed
    pid,                                          // D  request_id
    'VM',                                         // E  requestor
    DATE,                                         // F  date
    'Urgent',                                     // G  priority
    'Urgent',                                     // H  deadline
    ALL_BRANDS,                                   // I  brands
    REGIONS,                                      // J  regions
    'Whale - Probe',                              // K  campaign
    'Free Credit',                                // L  bonus_type
    `Free Credit ${fcAmt} - 20X TO, no max transfer`,  // M  name_details
    'TRUE',                                       // N  inbox_message
    'TRUE',                                       // O  popup_dialog
    '1',                                          // P  validity
    '3',                                          // Q  rewards_validity
    '',                                           // R  expiry_minutes
    'One Time',                                   // S  recurring
    '1',                                          // T  max_per_player
    '',                                           // U  change_type
    '',                                           // V  change_details
    code,                                         // W  promo_code
    `Free Credit ${fcAmt}`,                       // X  promo_name_en
    '',                                           // Y  promo_name_zhid
    'JT',                                         // Z  stakeholder
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

const client = await getSheetsClient();
const { sheets } = client;
const tabName = await resolveCurrentMonthTab(client);

// Find the last non-empty row in column D, then write AFTER it.
// Scan rows 2–200 to cover all data.
const scanRange = `'${tabName}'!D2:D200`;
const scan = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: scanRange });
const scanVals = scan.data.values || [];
// Last non-empty row (0-indexed offset within scan starting at row 2).
let lastNonEmptyOffset = -1;
for (let i = 0; i < scanVals.length; i++) {
  if (scanVals[i] && scanVals[i][0]) lastNonEmptyOffset = i;
}
// firstDataRow is the sheet row AFTER the last non-empty row.
const firstDataRow = 2 + lastNonEmptyOffset + 1; // 1-indexed

// Show last 5 non-empty entries for context.
const last5 = scanVals.slice(Math.max(0, lastNonEmptyOffset - 4), lastNonEmptyOffset + 1)
  .map((r, i, a) => `D${2 + lastNonEmptyOffset - (a.length - 1 - i)}: ${r[0]}`).join(', ');
console.log(`Last non-empty D rows: ${last5}`);
console.log(`Last non-empty D row: ${2 + lastNonEmptyOffset} → writing at row ${firstDataRow}`);

// Also clear the bad data written at W180:AX183.
const badRange = `'${tabName}'!W180:AX183`;
console.log(`\nWill clear bad range: ${badRange}`);

// Correct write range: explicit A<row>:AB<row+3>.
const lastRow = firstDataRow + ROWS.length - 1;
const writeRange = `'${tabName}'!A${firstDataRow}:AB${lastRow}`;
console.log(`Will write correct data to: ${writeRange}`);

ROWS.forEach((r, i) => console.log(`  Row ${firstDataRow + i}: ${r[3]} | ${r[22]}`));

if (dryRun) { console.log('\nDRY-RUN — remove --dry-run to apply'); process.exit(0); }

// Step 1: clear bad range.
await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: badRange });
console.log(`\n✓ Cleared ${badRange}`);

// Step 2: write correct data with explicit range (values.update, not append).
const res = await sheets.spreadsheets.values.update({
  spreadsheetId: SPREADSHEET_ID,
  range: writeRange,
  valueInputOption: 'USER_ENTERED',
  requestBody: { values: ROWS },
});
console.log(`✓ Written to ${res.data.updatedRange} (${res.data.updatedRows} rows × ${res.data.updatedColumns} cols)`);
console.log('\nNext: node bin/ingest-requests.js → verify P176-P179 parsed correctly');
