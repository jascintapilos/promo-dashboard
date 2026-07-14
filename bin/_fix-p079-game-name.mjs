#!/usr/bin/env node
// Fix P079 row 80 col M: "MB8 Gate Of Olympus" → "MB8 Gates Of Olympus"
import { getGoogleAuth, loadGoogleapis } from '../src/google-auth.js';

const SPREADSHEET_ID = '1dqvCM9SoPLJ2iYNCQRe450wBk3S7HSHtbayuAJguodM';
const RANGE = "'July 2026'!M80";

const { client } = await getGoogleAuth();
const { google } = await loadGoogleapis();
const sheets = google.sheets({ version: 'v4', auth: client });

// Read current value first
const readRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: RANGE });
const cur = (readRes.data.values?.[0]?.[0] || '');
console.log('Current M80:', JSON.stringify(cur));

const fixed = cur.replace('MB8 Gate Of Olympus', 'MB8 Gates Of Olympus');
if (fixed === cur) { console.log('Already correct or pattern not found — no change.'); process.exit(0); }

await sheets.spreadsheets.values.update({
  spreadsheetId: SPREADSHEET_ID,
  range: RANGE,
  valueInputOption: 'RAW',
  requestBody: { values: [[fixed]] },
});
console.log('Updated M80:', JSON.stringify(fixed));
