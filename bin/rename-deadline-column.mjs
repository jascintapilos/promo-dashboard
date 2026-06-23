#!/usr/bin/env node
// Rename Task_Master K1 from "Deadline" to "Due_Date" so the dashboard
// (which reads t.Due_Date) finds it. Idempotent.
import { getGoogleAuth, loadGoogleapis } from '../src/google-auth.js';

const SHEET = '16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk';
const TAB = 'Task_Master';

const { client } = await getGoogleAuth();
const { google } = await loadGoogleapis();
const sheets = google.sheets({ version: 'v4', auth: client });

const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET, range: `'${TAB}'!1:1` });
const headers = (r.data.values || [[]])[0];
const idx = headers.indexOf('Deadline');
if (idx < 0) {
  console.log('No "Deadline" column found — checking for Due_Date...');
  console.log('Current headers:', headers.join(' | '));
  process.exit(0);
}
const col = String.fromCharCode(65 + idx);
await sheets.spreadsheets.values.update({
  spreadsheetId: SHEET,
  range: `'${TAB}'!${col}1`,
  valueInputOption: 'RAW',
  requestBody: { values: [['Due_Date']] },
});
console.log(`✓ Renamed column ${col}1: "Deadline" → "Due_Date"`);
