/**
 * Debug: inspect raw date/deadline cell values from the promo request sheet.
 */
import { getSheetsClient, listTabs, readHeader, detectColumnMapFromHeader, getSpreadsheetId } from '../src/sheets-client.js';
import { google } from 'googleapis';

const TABS = ['Jan 2026', 'Feb 2026', 'March 2026', 'Apr 2026', 'May 2026', 'June 2026', 'July 2026'];

const client = await getSheetsClient();
const sheets = google.sheets('v4');
const spreadsheetId = getSpreadsheetId();

for (const tabName of TABS) {
  const header = await readHeader(client, tabName);
  const colMap = detectColumnMapFromHeader(header);
  const dateIdx = colMap['date'];
  const deadlineIdx = colMap['deadline'];
  const rnIdx = colMap['request_number'];
  const codeIdx = colMap['promo_code'];

  // Fetch raw values
  const res = await sheets.spreadsheets.values.get({
    auth: client.auth,
    spreadsheetId,
    range: `'${tabName}'!A:Z`,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = (res.data.values || []).slice(1);
  const sample = rows
    .filter(r => r[rnIdx] && /^P\d/.test(r[rnIdx] || ''))
    .filter(r => r[dateIdx] || r[deadlineIdx])
    .slice(0, 5);

  console.log(`\n=== ${tabName} ===`);
  for (const r of sample) {
    const rn = r[rnIdx] || '';
    const date = r[dateIdx] || '(empty)';
    const deadline = r[deadlineIdx] || '(empty)';
    const code = r[codeIdx] || '(empty)';
    console.log(`  ${rn.padEnd(8)} date="${date}"  deadline="${deadline}"  code=${code}`);
  }

  // Count how many rows have each date field non-empty
  const withDate = rows.filter(r => r[rnIdx] && /^P\d/.test(r[rnIdx] || '') && r[dateIdx]);
  const withDeadline = rows.filter(r => r[rnIdx] && /^P\d/.test(r[rnIdx] || '') && r[deadlineIdx]);
  console.log(`  → rows with date: ${withDate.length}, with deadline: ${withDeadline.length}`);
}
