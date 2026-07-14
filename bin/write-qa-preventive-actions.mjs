#!/usr/bin/env node
// Write Preventive Actions back to the Weekly QA Framework sheet for
// QA-W2-005 and QA-W2-019 through QA-W2-026.

import { getGoogleAuth, loadGoogleapis } from '../src/google-auth.js';

const QA_SHEET_ID = '1RXlyIy9hD1LbWnM32k1DGrT9CWJwWvlCBlJzOfE_Q9Q';
const TAB = 'Weekly QA Log';
const HEADER_ROW = 8;   // 1-indexed sheet row where headers live
const DATA_START = 9;   // first data row (1-indexed)

const PA = {
  'QA-W2-005':
    'Ensure the bot always fills in the promotion name before saving. Add a check that stops the save if the name is blank, so this is caught before it reaches the back office. QC team to verify promotion name is present as part of the standard post-save check.',

  'QA-W2-019':
    '1. Fix the bot to always remove restricted/blacklisted game providers from the list even when a game category filter is already applied — the two filters need to work together, not one or the other. 2. Add a check before saving to confirm that the bonus amount and turnover conditions match what was requested — if the numbers don\'t match, the save should be blocked until corrected. 3. QC team to spot-check game provider list and bonus conditions on high-value promos before approving.',

  'QA-W2-020':
    '1. Fix the bot to always remove restricted/blacklisted game providers from the list even when a game category filter is already applied — the two filters need to work together, not one or the other. 2. Add a check before saving to confirm that the bonus amount and turnover conditions match what was requested — if the numbers don\'t match, the save should be blocked until corrected. 3. QC team to spot-check game provider list and bonus conditions on high-value promos before approving.',

  'QA-W2-021':
    '1. Fix the bot to always remove restricted/blacklisted game providers from the list even when a game category filter is already applied — the two filters need to work together, not one or the other. 2. Add a check before saving to confirm that the bonus amount and turnover conditions match what was requested — if the numbers don\'t match, the save should be blocked until corrected. 3. QC team to spot-check game provider list and bonus conditions on high-value promos before approving.',

  'QA-W2-022':
    '1. Fix the bot to always remove restricted/blacklisted game providers from the list even when a game category filter is already applied — the two filters need to work together, not one or the other. 2. Add a check before saving to confirm that the bonus amount and turnover conditions match what was requested — if the numbers don\'t match, the save should be blocked until corrected. 3. QC team to spot-check game provider list and bonus conditions on high-value promos before approving.',

  'QA-W2-023':
    '1. Fix the bot to always remove restricted/blacklisted game providers from the list even when a game category filter is already applied — the two filters need to work together, not one or the other. 2. Add a check before saving to confirm that the bonus amount and turnover conditions match what was requested — if the numbers don\'t match, the save should be blocked until corrected. 3. QC team to spot-check game provider list and bonus conditions on high-value promos before approving.',

  'QA-W2-024':
    '1. Fix the bot to always remove restricted/blacklisted game providers from the list even when a game category filter is already applied — the two filters need to work together, not one or the other. 2. Add a check before saving to confirm that the bonus amount and turnover conditions match what was requested — if the numbers don\'t match, the save should be blocked until corrected. 3. QC team to spot-check game provider list and bonus conditions on high-value promos before approving.',

  'QA-W2-025':
    '1. Fix the bot to always remove restricted/blacklisted game providers from the list even when a game category filter is already applied — the two filters need to work together, not one or the other. 2. Add a check before saving to confirm that the bonus amount and turnover conditions match what was requested — if the numbers don\'t match, the save should be blocked until corrected. 3. QC team to spot-check game provider list and bonus conditions on high-value promos before approving.',

  'QA-W2-026':
    '1. Fix the bot to correctly calculate and apply the bonus amount (same issue as above). 2. Fix the bot to always tick all the relevant bank/payment options for both MY and SG when setting up a promo — currently it misses some deposit methods when the request doesn\'t spell them out explicitly. 3. QC team to verify payment method selection is complete for all regions before approving QP2 promos.',
};

const { client, email, mode } = await getGoogleAuth();
const { google } = await loadGoogleapis();
const sheets = google.sheets({ version: 'v4', auth: client });

// Read all rows to find row numbers and the Preventive Action column index
const res = await sheets.spreadsheets.values.get({
  spreadsheetId: QA_SHEET_ID,
  range: `'${TAB}'!A1:Z200`,
});

const rows = res.data.values || [];
const header = rows[HEADER_ROW - 1] || [];
const paColIndex = header.findIndex(h => /preventive.action/i.test(h));
if (paColIndex === -1) {
  console.error('Could not find "Preventive Action" column in header row.');
  process.exit(1);
}
// Convert 0-based index to A1 column letter
const colLetter = String.fromCharCode(65 + paColIndex);
console.log(`Preventive Action column: ${colLetter} (index ${paColIndex})`);
console.log('');

// Build batch update data
const data = [];
for (let i = DATA_START - 1; i < rows.length; i++) {
  const row = rows[i];
  const logId = (row[0] || '').trim();
  if (!PA[logId]) continue;
  const sheetRow = i + 1; // 1-indexed
  const range = `'${TAB}'!${colLetter}${sheetRow}`;
  console.log(`  → ${logId} at row ${sheetRow}: ${range}`);
  data.push({ range, values: [[PA[logId]]] });
}

if (data.length === 0) {
  console.log('No matching rows found.');
  process.exit(0);
}

// Batch write
await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: QA_SHEET_ID,
  requestBody: {
    valueInputOption: 'RAW',
    data,
  },
});

console.log('');
console.log(`✓ Written ${data.length} Preventive Action entries.`);
