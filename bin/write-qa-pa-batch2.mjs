#!/usr/bin/env node
import { getGoogleAuth, loadGoogleapis } from '../src/google-auth.js';

const QA_SHEET_ID = '1RXlyIy9hD1LbWnM32k1DGrT9CWJwWvlCBlJzOfE_Q9Q';
const TAB = 'Weekly QA Log';

const PA = {
  'QA-W2-005': 'Ensure the bot validates that the promotion name is filled in for all target brands before any save is executed. If the name is empty, the save should stop and be flagged for manual review. Add promotion name verification to the QC checklist as a mandatory pass/fail item.',
  'QA-W2-016': 'Fix the bot to automatically select all applicable bank and payment deposit options for each region (MY and SG) when setting up a promo on QP2 brands. The bot should not rely on defaults or leave any deposit methods unticked. Add a QC check to verify deposit options are fully selected per region before the promo is approved.',
  'QA-W2-017': 'Fix the bot to automatically select all applicable bank and payment deposit options for each region (MY and SG) when setting up a promo on QP2 brands. The bot should not rely on defaults or leave any deposit methods unticked. Add a QC check to verify deposit options are fully selected per region before the promo is approved.',
  'QA-W2-018': 'Fix the bot to automatically select all applicable bank and payment deposit options for each region (MY and SG) when setting up a promo on QP2 brands. The bot should not rely on defaults or leave any deposit methods unticked. Add a QC check to verify deposit options are fully selected per region before the promo is approved.',
  'QA-W2-026': '1. Fix the bot to correctly calculate the bonus condition amount using the values stated in the request — the formula should be verified before saving, and any mismatch should block the save for manual review. 2. Fix the bot to automatically select all applicable bank and payment deposit options for each region (MY and SG) when setting up QP2 promos. QC team to verify deposit options and bonus conditions are correct for all active regions before approving.',
};

const { client } = await getGoogleAuth();
const { google } = await loadGoogleapis();
const sheets = google.sheets({ version: 'v4', auth: client });

const res = await sheets.spreadsheets.values.get({
  spreadsheetId: QA_SHEET_ID,
  range: `'${TAB}'!A1:Z200`,
});

const rows = res.data.values || [];
const header = rows[7];
const paColIndex = header.findIndex(h => /preventive.action/i.test(h));
const colLetter = String.fromCharCode(65 + paColIndex);

const data = [];
for (let i = 8; i < rows.length; i++) {
  const id = (rows[i][0] || '').trim();
  if (!PA[id]) continue;
  const sheetRow = i + 1;
  data.push({ range: `'${TAB}'!${colLetter}${sheetRow}`, values: [[PA[id]]] });
  console.log(`  → ${id} at row ${sheetRow}`);
}

await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: QA_SHEET_ID,
  requestBody: { valueInputOption: 'RAW', data },
});

console.log(`\n✓ Written ${data.length} entries.`);
