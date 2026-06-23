/**
 * Makes the permanent PromoOps Data sheet publicly readable (anyone with link = Viewer).
 * Required so the dashboard API key can read it without OAuth.
 *
 * Run once: node bin/share-sheet-public.mjs
 */
import { google } from 'googleapis';
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';

const SHEET_ID = getOpsSheetId();

const { auth } = await getSheetsClient();
const drive = google.drive({ version: 'v3', auth });

console.log(`\nSharing sheet ${SHEET_ID} as public (anyone-with-link, reader)…`);

await drive.permissions.create({
  fileId: SHEET_ID,
  requestBody: {
    role: 'reader',
    type: 'anyone',
  },
});

console.log('✅ Done. Sheet is now publicly readable (viewer only).');
console.log(`   URL: https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`);
