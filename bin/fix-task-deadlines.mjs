#!/usr/bin/env node
// Force Task_Master deadline cells to display as ISO yyyy-mm-dd.
// Idempotent: sets number format pattern on K2:K, and re-writes any cells
// still stored as raw "d/m" strings to proper date values.
import { getGoogleAuth, loadGoogleapis } from '../src/google-auth.js';

const SHEET = '16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk';
const TAB = 'Task_Master';

function normalizeDeadline(raw) {
  if (!raw) return '';
  const m = String(raw).match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return raw;
  const day = parseInt(m[1], 10), mon = parseInt(m[2], 10);
  let year = m[3] ? parseInt(m[3], 10) : new Date().getUTCFullYear();
  if (year < 100) year += 2000;
  const iso = `${year}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const today = new Date();
  if ((today - new Date(iso + 'T00:00:00Z')) / 86400000 > 180) {
    return `${year+1}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  return iso;
}

const { client } = await getGoogleAuth();
const { google } = await loadGoogleapis();
const sheets = google.sheets({ version: 'v4', auth: client });

// Find tab + grid info
const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET, fields: 'sheets(properties(sheetId,title,gridProperties))' });
const sh = meta.data.sheets.find(s => s.properties.title === TAB);
if (!sh) { console.error('Tab not found'); process.exit(1); }
const sheetId = sh.properties.sheetId;
const rowCount = sh.properties.gridProperties.rowCount;

// Step 1: set yyyy-mm-dd format on column K (deadline), rows 2 onward
await sheets.spreadsheets.batchUpdate({
  spreadsheetId: SHEET,
  requestBody: {
    requests: [{
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: 10, endColumnIndex: 11 },
        cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    }],
  },
});
console.log(`✓ Set format yyyy-mm-dd on ${TAB}!K2:K`);

// Step 2: rewrite any cells still as raw "d/m" strings to ISO
const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET, range: `'${TAB}'!A1:Z` });
const data = r.data.values || [];
const headers = data[0] || [];
const idCol = headers.indexOf('Task_ID');
const deadCol = headers.indexOf('Deadline');
const colLetter = String.fromCharCode(65 + deadCol);

const updates = [];
for (let i = 1; i < data.length; i++) {
  const raw = String(data[i][deadCol] || '').trim();
  if (!raw || raw === '-') continue;
  const fixed = normalizeDeadline(raw);
  if (fixed && fixed !== raw) {
    updates.push({ range: `'${TAB}'!${colLetter}${i+1}`, values: [[fixed]] });
    console.log(`R${i+1} ${data[i][idCol]}: ${raw} → ${fixed}`);
  }
}

if (updates.length) {
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET,
    requestBody: { valueInputOption: 'USER_ENTERED', data: updates },
  });
  console.log(`✓ ${updates.length} cell(s) normalised`);
} else {
  console.log('No string-format deadlines to convert.');
}
