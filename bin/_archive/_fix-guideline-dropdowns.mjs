#!/usr/bin/env node
// Fix data validation on Guideline tab:
//   • Clear stale dropdown on column D (RN should be free text)
//   • Add Priority dropdown [Normal, High, Urgent] on column G — mirrors May 2026.
//
//   --apply   actually commit. Default is dry-run.
//
import {
  getSheetsClient,
  getSpreadsheetId,
} from '../src/sheets-client.js';

const APPLY = process.argv.includes('--apply');
const GUIDELINE_ID = 1519890897;

// Apply over the entire data area below the header (rows 2..1000).
const requests = [
  // 1) Clear data validation on column D (cols are 0-indexed: D = 3).
  {
    setDataValidation: {
      range: {
        sheetId: GUIDELINE_ID,
        startRowIndex: 1,
        endRowIndex: 1000,
        startColumnIndex: 3,
        endColumnIndex: 4,
      },
      // omitting `rule` clears existing validation
    },
  },
  // 2) Add Priority dropdown on column G (col index 6).
  {
    setDataValidation: {
      range: {
        sheetId: GUIDELINE_ID,
        startRowIndex: 1,
        endRowIndex: 1000,
        startColumnIndex: 6,
        endColumnIndex: 7,
      },
      rule: {
        condition: {
          type: 'ONE_OF_LIST',
          values: [
            { userEnteredValue: 'Normal' },
            { userEnteredValue: 'High' },
            { userEnteredValue: 'Urgent' },
          ],
        },
        inputMessage: 'Click and enter a value from the list of items',
        strict: true,
        showCustomUi: true,
      },
    },
  },
];

console.log(`Planned ${requests.length} requests on Guideline (sheetId=${GUIDELINE_ID}):`);
console.log('  • clear dropdown on D2:D1000');
console.log('  • set [Normal, High, Urgent] dropdown on G2:G1000');
console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

if (!APPLY) {
  console.log('\nDry run only — re-run with --apply to commit.');
  process.exit(0);
}

const client = await getSheetsClient();
const ssid = getSpreadsheetId();

const res = await client.sheets.spreadsheets.batchUpdate({
  spreadsheetId: ssid,
  requestBody: { requests },
});

console.log(`\n✓ batchUpdate completed: ${res.data.replies?.length || 0} replies`);
