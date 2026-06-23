#!/usr/bin/env node
// Quick inspector for Task_Master + Banner_Tasks
import { getGoogleAuth, loadGoogleapis } from '../src/google-auth.js';

const SHEET = '16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk';
const { client } = await getGoogleAuth();
const { google } = await loadGoogleapis();
const sheets = google.sheets({ version: 'v4', auth: client });

async function dump(tab, cols='A1:L') {
  try {
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET, range: `'${tab}'!${cols}` });
    const rows = r.data.values || [];
    console.log(`\n━━ ${tab} (${rows.length} rows) ━━`);
    if (rows.length) {
      console.log('Header:', rows[0].join(' | '));
      rows.slice(1, 6).forEach((r, i) => console.log(`Row ${i+1}:`, r.slice(0, 8).join(' | ')));
      if (rows.length > 6) console.log(`... +${rows.length - 6} more`);
    }
  } catch (e) {
    console.log(`${tab}: ${e.message}`);
  }
}

// Verify both old and new rows
const tm = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET, range: `'Task_Master'!A1:N50` });
const rows = tm.data.values || [];
console.log('Headers:', rows[0].join(' | '));
console.log('\n— Original tasks (rows 2-10) —');
rows.slice(1, 10).forEach((r, i) => console.log(`R${i+2}: ID=${r[0]} | Deadline="${r[10]}" | Owner="${r[11]}" | Status="${r[12]}"`));
console.log('\n— Banner tasks (rows 29-47) —');
rows.slice(28, 47).forEach((r, i) => console.log(`R${i+29}: ID=${r[0]} | Deadline="${r[10]}" | Owner="${r[11]}" | Status="${r[12]}"`));
