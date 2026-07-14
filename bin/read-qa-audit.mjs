#!/usr/bin/env node
// One-off: read specific rows from Weekly QA Framework sheet.
// Usage: node bin/read-qa-audit.mjs

import { getSheetsClient } from '../src/sheets-client.js';
import { getGoogleAuth, loadGoogleapis } from '../src/google-auth.js';

const QA_SHEET_ID = '1RXlyIy9hD1LbWnM32k1DGrT9CWJwWvlCBlJzOfE_Q9Q';
const TAB = 'Weekly QA Log';
const TARGET_IDS = new Set([
  'QA-W2-005','QA-W2-019','QA-W2-020','QA-W2-021',
  'QA-W2-022','QA-W2-023','QA-W2-024','QA-W2-025','QA-W2-026',
]);

const { client, email, mode } = await getGoogleAuth();
const { google } = await loadGoogleapis();
const sheets = google.sheets({ version: 'v4', auth: client });

// Read all data from the tab
const res = await sheets.spreadsheets.values.get({
  spreadsheetId: QA_SHEET_ID,
  range: `'${TAB}'!A1:Z200`,
});

const rows = res.data.values || [];
if (rows.length === 0) { console.log('No data'); process.exit(0); }

// Title block occupies rows 1-7; actual column headers are on row 8 (index 7)
const HEADER_ROW_INDEX = 7;
const header = rows[HEADER_ROW_INDEX] || [];
console.log('HEADER:', header.join(' | '));
console.log('');

for (const row of rows.slice(HEADER_ROW_INDEX + 1)) {
  const logId = (row[0] || '').trim();
  if (!TARGET_IDS.has(logId)) continue;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (let i = 0; i < header.length; i++) {
    const val = (row[i] || '').trim();
    if (!val) continue;
    console.log(`  ${String(header[i] || '').padEnd(28)} : ${val}`);
  }
}

console.log('');
console.log('Done.');
