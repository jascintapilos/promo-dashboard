/**
 * One-time setup: creates the permanent "PromoOps Data" Google Sheet,
 * adds all required tabs with headers, and saves the sheet ID to
 * ops-sheet-id.local.json so all pull scripts can find it.
 *
 * Run once:
 *   node bin/setup-permanent-sheet.mjs
 *
 * After running, update the Apps Script (dashboard-data.gs) with the
 * printed sheet ID, then redeploy the web app.
 */
import { getSheetsClient } from '../src/sheets-client.js';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const CONFIG_FILE = path.resolve('ops-sheet-id.local.json');

if (existsSync(CONFIG_FILE)) {
  const existing = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  console.log(`\n⚠  ops-sheet-id.local.json already exists.`);
  console.log(`   Sheet ID: ${existing.sheetId}`);
  console.log(`   URL: https://docs.google.com/spreadsheets/d/${existing.sheetId}/edit`);
  console.log(`\n   Delete the file and re-run if you want to create a new sheet.\n`);
  process.exit(0);
}

const { sheets } = await getSheetsClient();

// ── Create the spreadsheet ────────────────────────────────────────────────
console.log('\nCreating permanent sheet…');
const create = await sheets.spreadsheets.create({
  requestBody: {
    properties: { title: 'PromoOps Data' },
    sheets: [
      { properties: { title: 'Promo Code Log',      index: 0 } },
      { properties: { title: 'Banner Log',           index: 1 } },
      { properties: { title: 'CRM Assignment Log',   index: 2 } },
      { properties: { title: 'New Games',            index: 3 } },
      { properties: { title: 'Utilisation',          index: 4 } },
      { properties: { title: 'BO Auto-pull (Promo)', index: 5 } },
      { properties: { title: 'BO Auto-pull (Banner)',index: 6 } },
    ],
  },
});

const sheetId = create.data.spreadsheetId;
const url = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
console.log(`✓ Created: ${url}`);

// ── Add headers to each tab ───────────────────────────────────────────────
const HEADERS = {
  'Promo Code Log':       ['Date', 'Code', 'Brand', 'Region', 'Created By', 'Type', 'Status'],
  'Banner Log':           ['Start', 'Brand', 'Region', 'Banner Title', 'End', 'Status'],
  'CRM Assignment Log':   ['Date', 'Brand', 'Region', 'CRM Tool', 'Campaign Name', 'Segment Name', 'Created By'],
  'New Games':            ['Date', 'Brand', 'Region', 'Game Name', 'Game Provider', 'Added By'],
  'Utilisation':          ['Staff', '% Utilisation', 'Notes'],
  'BO Auto-pull (Promo)': ['Date', 'Code', 'Brand', 'Region', 'Created By', 'Type', 'Status', 'Pulled at'],
  'BO Auto-pull (Banner)':['Start', 'Brand', 'Region', 'Banner Title', 'End', 'Status', 'Pulled at'],
};

const headerRequests = Object.entries(HEADERS).map(([tab, cols]) => ({
  range: `'${tab}'!A1`,
  values: [cols],
}));

await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: sheetId,
  requestBody: { valueInputOption: 'RAW', data: headerRequests },
});
console.log('✓ Headers added to all tabs');

// ── Save config ───────────────────────────────────────────────────────────
writeFileSync(CONFIG_FILE, JSON.stringify({ sheetId, url, createdAt: new Date().toISOString() }, null, 2));
console.log(`✓ Saved sheet ID → ops-sheet-id.local.json`);

// ── Final instructions ────────────────────────────────────────────────────
console.log(`
${'═'.repeat(60)}
  PERMANENT SHEET CREATED
${'═'.repeat(60)}

  URL: ${url}

  Next steps:
  1. Open the URL above and share it with your team
     (anyone with the link can edit)

  2. Update the Apps Script (dashboard-data.gs):
     Change line 5 from:
       var SHEET_ID = '1iGOcxKr9S9WFlrHihDfti_RsoUPgazDqnNKAPWMcPkI';
     To:
       var SHEET_ID = '${sheetId}';
     Then redeploy (Deploy → Manage deployments → pencil → New version)

  3. Run the nightly pull to test:
     node bin/pull-bo-to-sheet.mjs --write
     node bin/pull-bo-banners-to-sheet.mjs --write

${'═'.repeat(60)}
`);
