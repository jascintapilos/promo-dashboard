#!/usr/bin/env node
import { getGoogleAuth, loadGoogleapis } from '../src/google-auth.js';

const QA_SHEET_ID = '1RXlyIy9hD1LbWnM32k1DGrT9CWJwWvlCBlJzOfE_Q9Q';
const TAB = 'Weekly QA Log';
const targets = new Set(['QA-W2-005','QA-W2-016','QA-W2-017','QA-W2-018','QA-W2-026']);

const { client } = await getGoogleAuth();
const { google } = await loadGoogleapis();
const sheets = google.sheets({ version: 'v4', auth: client });

const res = await sheets.spreadsheets.values.get({
  spreadsheetId: QA_SHEET_ID,
  range: `'${TAB}'!A1:Z200`,
});

const rows = res.data.values || [];
const header = rows[7];

for (let i = 8; i < rows.length; i++) {
  const row = rows[i];
  const id = (row[0] || '').trim();
  if (!targets.has(id)) continue;
  console.log(`=== ${id} (sheet row ${i + 1}) ===`);
  for (let j = 0; j < header.length; j++) {
    const v = (row[j] || '').trim();
    if (!v) continue;
    console.log(`  ${String(header[j] || '').padEnd(28)}: ${v}`);
  }
  console.log('');
}
