// Update the Whale Probe reference sheet (rows 6-9) with the FC codes
// created for P176-P179. Replaces the placeholder deposit codes in E/F.
//
// Sheet: https://docs.google.com/spreadsheets/d/1BjtTtgc34zEdH5PSDdbyV_oLWumjvdu9/edit?gid=1196033092

import { getSheetsClient } from '../src/sheets-client.js';

const SPREADSHEET_ID = '1BjtTtgc34zEdH5PSDdbyV_oLWumjvdu9';
const TARGET_GID     = 1196033092;

const FC_CODES = [
  'WHALE_VM_PROBE_NODEP_FC88_20X',
  'WHALE_VM_PROBE_NODEP_FC118_20X',
  'WHALE_VM_PROBE_NODEP_FC138_20X',
  'WHALE_VM_PROBE_NODEP_FC148_20X',
];

// Auth via the project's existing Google auth module.
const client = await getSheetsClient();
const { sheets, auth } = client;

// Resolve sheet name from gid.
const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties' });
const sheetProps = meta.data.sheets.find(s => s.properties.sheetId === TARGET_GID)?.properties;
if (!sheetProps) { console.error(`Sheet gid=${TARGET_GID} not found`); process.exit(1); }
const sheetName = sheetProps.title;
console.log(`Sheet: "${sheetName}" (gid=${TARGET_GID})`);

// Read current E6:F9 to show before state.
const before = await sheets.spreadsheets.values.get({
  spreadsheetId: SPREADSHEET_ID,
  range: `'${sheetName}'!E6:F9`,
});
console.log('\nBefore:');
(before.data.values || []).forEach((row, i) => console.log(`  row ${6+i}: E=${row[0]||''}, F=${row[1]||''}`));

// Write FC codes to E6:F9 (same code in both QPRO and QP2 columns).
const updates = FC_CODES.map((code, i) => ({
  range: `'${sheetName}'!E${6+i}:F${6+i}`,
  values: [[code, code]],
}));

await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: SPREADSHEET_ID,
  requestBody: {
    valueInputOption: 'RAW',
    data: updates,
  },
});

// Read back to confirm.
const after = await sheets.spreadsheets.values.get({
  spreadsheetId: SPREADSHEET_ID,
  range: `'${sheetName}'!E6:F9`,
});
console.log('\nAfter:');
(after.data.values || []).forEach((row, i) => console.log(`  row ${6+i}: E=${row[0]||''}, F=${row[1]||''}`));
console.log('\nDone.');
