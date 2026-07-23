/**
 * Creates the next month's tab in the Action Item Tracker.
 * Run on the 1st of each month via Windows Task Scheduler.
 * Usage: node bin/create-monthly-tab.mjs [--month YYYY-MM]
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const SPREADSHEET_ID = '1dZ4r-mUjRFfITCVwlMU2oeH6xIUGSZO2J1fJyiYg2SQ';
const CLIENT_FILE    = path.join(ROOT, 'google-oauth-client.local.json');
const TOKEN_FILE     = path.join(ROOT, 'google-oauth-token.local.json');
const LOG_FILE       = path.join(ROOT, 'logs', 'monthly-tab.log');

const HEADERS = [
  'Date','Task #','Discussion / Topic','Category',
  'Action Item','Assignee','Priority','Due Date',
  'Status','Source','Source Link','Remarks',
];

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function tabName(year, month) {
  return `${MONTH_NAMES[month]} ${year}`;
}

function getAuth() {
  if (!fs.existsSync(TOKEN_FILE)) {
    console.error('Missing token. Run: node bin/sheets-oauth.mjs');
    process.exit(1);
  }
  const token  = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  const client = JSON.parse(fs.readFileSync(CLIENT_FILE, 'utf8'));
  const { client_id, client_secret } = client.installed;
  const auth = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3000/oauth2callback');
  auth.setCredentials(token);
  auth.on('tokens', t => {
    if (t.refresh_token) fs.writeFileSync(TOKEN_FILE, JSON.stringify({ ...token, ...t }, null, 2));
  });
  return auth;
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, line + '\n');
}

// Parse optional --month YYYY-MM override
let targetYear, targetMonth;
const monthArg = process.argv[process.argv.indexOf('--month') + 1];
if (monthArg && /^\d{4}-\d{2}$/.test(monthArg)) {
  [targetYear, targetMonth] = monthArg.split('-').map(Number);
  targetMonth -= 1; // 0-indexed
} else {
  const now = new Date();
  targetYear  = now.getFullYear();
  targetMonth = now.getMonth(); // current month (run on 1st → this IS the new month)
}

const TAB_NAME = tabName(targetYear, targetMonth);

log(`Target tab: "${TAB_NAME}"`);

const auth   = getAuth();
const sheets = google.sheets({ version: 'v4', auth });

// Check if tab already exists
const meta     = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
const existing = meta.data.sheets.find(s => s.properties.title === TAB_NAME);

if (existing) {
  log(`Tab "${TAB_NAME}" already exists (sheetId=${existing.properties.sheetId}). Nothing to do.`);
  process.exit(0);
}

// Create tab
const res = await sheets.spreadsheets.batchUpdate({
  spreadsheetId: SPREADSHEET_ID,
  requestBody: { requests: [{ addSheet: { properties: { title: TAB_NAME } } }] },
});
const sheetId = res.data.replies[0].addSheet.properties.sheetId;
log(`Created tab "${TAB_NAME}" sheetId=${sheetId}`);

// Write header row
await sheets.spreadsheets.values.update({
  spreadsheetId: SPREADSHEET_ID,
  range: `${TAB_NAME}!A1`,
  valueInputOption: 'USER_ENTERED',
  requestBody: { values: [HEADERS] },
});

// Formatting
const requests = [];

requests.push({
  repeatCell: {
    range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEADERS.length },
    cell: {
      userEnteredFormat: {
        backgroundColor: { red: 0.24, green: 0.24, blue: 0.24 },
        textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
        horizontalAlignment: 'CENTER',
      },
    },
    fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
  },
});

requests.push({
  updateSheetProperties: {
    properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
    fields: 'gridProperties.frozenRowCount',
  },
});

const widths = [60, 55, 200, 90, 320, 160, 65, 70, 100, 65, 280, 220];
widths.forEach((px, i) => {
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: px },
      fields: 'pixelSize',
    },
  });
});

const ROWS = 200;

const dropdowns = [
  { col: 8, values: ['Pending','In Progress','Completed','Cancelled','Blocked','Recurring'] },
  { col: 6, values: ['High','Med','Low'] },
  { col: 3, values: ['Campaign','Ops','Training','Admin','HR','Reporting'] },
  { col: 9, values: ['Meeting','Slack','Telegram','Internal','Email'] },
];
dropdowns.forEach(({ col, values }) => {
  requests.push({
    setDataValidation: {
      range: { sheetId, startRowIndex: 1, endRowIndex: ROWS, startColumnIndex: col, endColumnIndex: col + 1 },
      rule: {
        condition: { type: 'ONE_OF_LIST', values: values.map(v => ({ userEnteredValue: v })) },
        showCustomUi: true,
      },
    },
  });
});

const cfColors = {
  'Completed':   { bg: { red: 0.83, green: 0.93, blue: 0.83 }, fg: { red: 0.08, green: 0.34, blue: 0.14 } },
  'In Progress': { bg: { red: 0.80, green: 0.90, blue: 1.00 }, fg: { red: 0.00, green: 0.25, blue: 0.52 } },
  'Pending':     { bg: { red: 1.00, green: 0.95, blue: 0.80 }, fg: { red: 0.52, green: 0.39, blue: 0.02 } },
  'Blocked':     { bg: { red: 0.97, green: 0.84, blue: 0.85 }, fg: { red: 0.45, green: 0.11, blue: 0.14 } },
  'Cancelled':   { bg: { red: 0.89, green: 0.89, blue: 0.89 }, fg: { red: 0.22, green: 0.24, blue: 0.26 } },
  'Recurring':   { bg: { red: 0.89, green: 0.85, blue: 0.95 }, fg: { red: 0.29, green: 0.14, blue: 0.35 } },
};
Object.entries(cfColors).forEach(([val, { bg, fg }]) => {
  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [{ sheetId, startRowIndex: 1, endRowIndex: ROWS, startColumnIndex: 8, endColumnIndex: 9 }],
        booleanRule: {
          condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: val }] },
          format: { backgroundColor: bg, textFormat: { foregroundColor: fg } },
        },
      },
      index: 0,
    },
  });
});

await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests } });
log(`✓ Formatting applied. Tab "${TAB_NAME}" is ready.`);
