/**
 * Action Item Tracker — Sheets API updater
 * Usage:
 *   node bin/action-item-tracker-update.mjs          # create / refresh Jul 2026 tab
 *   node bin/action-item-tracker-update.mjs --append # append rows without wiping tab
 *
 * Requires: google-oauth-token.local.json (run bin/sheets-oauth.mjs first)
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const SPREADSHEET_ID = '1dZ4r-mUjRFfITCVwlMU2oeH6xIUGSZO2J1fJyiYg2SQ';
const TAB_NAME       = 'Jul 2026';
const CLIENT_FILE    = path.join(ROOT, 'google-oauth-client.local.json');
const TOKEN_FILE     = path.join(ROOT, 'google-oauth-token.local.json');

// ── Schema ────────────────────────────────────────────────────────────────────
const HEADERS = [
  'Date','Task #','Discussion / Topic','Category',
  'Action Item','Assignee','Priority','Due Date',
  'Status','Source','Source Link','Remarks',
];

// ── July 2026 seed rows (from Slack scan 2026-07-01 to 2026-07-22) ──────────
const SEED_ROWS = [
  ['7/7',  '1',  'Promo code batch P079-P086',               'Campaign',  'P079-P080 Jascinta; P081-P086 Gaby — batch code creation',                   'Jascinta, Gaby',       'High', '14/7',  'In Progress', 'Slack', 'https://the-company-team-hub.slack.com/archives/C03LF5QH5F0',          'Deadline 14 Jul; high priority per Jascinta message'],
  ['13/7', '2',  'Utilization data — recurring Monday SOP',  'Ops',       'Team submits utilization + manual entry data by 10am every Monday',           'Whole team',          'Med',  'Ongoing','Recurring',   'Slack', 'https://the-company-team-hub.slack.com/archives/C09LT8W2D70',          'Jascinta reminder 13 Jul'],
  ['14/7', '3',  'WS1 Promotion Suite linking',              'Ops',       'Confirm whether WS1 linking promo in Promotion Suite is working',              'Jascinta / Wai Yip',  'Med',  '',       'Pending',     'Slack', 'https://the-company-team-hub.slack.com/archives/C03LF5QH5F0',          ''],
  ['15/7', '4',  'Smartico discussion meeting',              'Training',  'Smartico strategy session — Ryan, Wai Yip, Wen, Alysa, Gaby, Bangun',         'Wen, Alysa, Gaby',    'Low',  '15/7',  'Completed',   'Slack', 'https://the-company-team-hub.slack.com/archives/C09LT8W2D70',          'Scheduled 10am 15 Jul'],
  ['17/7', '5',  'LC + Sportsbook blacklist template',       'Ops',       'Create live casino + sportsbook blacklist template for ALL brands',            'Promo team',          'High', '',       'Pending',     'Slack', 'https://the-company-team-hub.slack.com/archives/C09LT8W2D70',          'Requested by Wai Yip 17 Jul'],
  ['17/7', '6',  'Homepage banner overload',                 'Ops',       'Review overloaded homepage banners; trim and reorder by position rules',       'Alysa',               'Med',  '',       'Pending',     'Slack', 'https://the-company-team-hub.slack.com/archives/C09LT8W2D70',          'Flagged by Jascinta to Alysa'],
  ['20/7', '7',  'Weekly Report data verification',          'Reporting', 'Team verify Weekly Report dashboard data accuracy',                            'Promo team',          'Med',  '20/7',  'Completed',   'Slack', 'https://the-company-team-hub.slack.com/archives/C09LT8W2D70',          ''],
  ['20/7', '8',  'WhatsApp blast timing — low-VIP batch',   'Ops',       'Stop simultaneous WhatsApp blast + bonus trigger; send WA earlier than bonus', 'Jascinta / MIMI',     'Med',  '',       'Pending',     'Slack', 'https://the-company-team-hub.slack.com/archives/C09LT8W2D70',          'Players think they have second bonus if WA arrives late'],
  ['21/7', '9',  'QPRO BO Enhancement Suggestions',         'Campaign',  'Compile QPRO BO enhancement suggestions; team input needed by 4pm 21 Jul',    'Joel, Ryan, Claudia', 'High', '21/7',  'In Progress', 'Slack', 'https://the-company-team-hub.slack.com/archives/C09LT8W2D70',          'Jascinta compiled; awaiting responses'],
  ['21/7', '10', 'Banner end-date policy — winner list',    'Ops',       'Communicate policy: extend banner end date until winner list is posted',       'Jascinta',            'Med',  '',       'Pending',     'Slack', 'https://the-company-team-hub.slack.com/archives/C09LT8W2D70',          'Easier for CS to explain to players'],
  ['21/7', '11', 'Muhammad Ridwan onboarding',              'Admin',     'New joiner setup: QPRO1 BO access, Adspower install, Directory walkthrough',   'Jascinta, Bangun',    'High', '22/7',  'In Progress', 'Slack', 'https://the-company-team-hub.slack.com/archives/C09LT8W2D70',          'Ridwan joined 21 Jul; Bangun doing UG BO training'],
  ['21/7', '12', 'GM01 task scheduler — Gabrielle',         'Ops',       'Deployed Windows task scheduler for GM01 session; Gaby to monitor',           'Jascinta → Gaby',     'Low',  '21/7',  'Completed',   'Slack', 'https://the-company-team-hub.slack.com/archives/C09LT8W2D70',          'Gaby to solve CAPTCHA once; auto-runs after'],
  ['22/7', '13', 'Morning ops readiness SOP — Kasturi',     'Training',  'Upload SOP to Google Drive as editable Doc; add Calendar check as step 4',    'Kasturi',             'Med',  '23/7',  'In Progress', 'Slack', 'https://the-company-team-hub.slack.com/archives/C09LT8W2D70',          'Also: add Action Item + Utilization to Directory browser'],
  ['22/7', '14', 'Lindungan 24 Jam opt-in / opt-out',       'Admin',     'Kasturi and Wen to confirm opt-in or opt-out — cutoff 28 Jul',                'Kasturi, Wen',        'High', '28/7',  'Pending',     'Slack', 'https://the-company-team-hub.slack.com/archives/C09LT8W2D70',          'Wai Yip reminder 21 Jul; hard cutoff 28 Jul'],
];

// ── Auth ──────────────────────────────────────────────────────────────────────
function getAuth() {
  if (!fs.existsSync(TOKEN_FILE)) {
    console.error('Missing token. Run: node bin/sheets-oauth.mjs');
    process.exit(1);
  }
  const token  = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  const client = JSON.parse(fs.existsSync(CLIENT_FILE)
    ? fs.readFileSync(CLIENT_FILE, 'utf8') : '{"installed":{}}');
  const { client_id, client_secret } = client.installed || {};
  const auth = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3000/oauth2callback');
  auth.setCredentials(token);
  auth.on('tokens', t => {
    if (t.refresh_token) {
      const merged = { ...token, ...t };
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(merged, null, 2));
    }
  });
  return auth;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getOrCreateTab(sheets, spreadsheetId, tabName) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets.find(s => s.properties.title === tabName);
  if (existing) return existing.properties.sheetId;

  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
  });
  return res.data.replies[0].addSheet.properties.sheetId;
}

async function clearAndWriteTab(sheets, spreadsheetId, tabName, rows) {
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${tabName}!A:L` });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [HEADERS, ...rows] },
  });
}

async function applyFormatting(sheets, spreadsheetId, sheetId, rowCount) {
  const requests = [];

  // Header row — dark grey background, white bold text
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

  // Freeze header
  requests.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } });

  // Column widths [Date,Task#,Topic,Category,ActionItem,Assignee,Priority,DueDate,Status,Source,SourceLink,Remarks]
  const widths = [60, 55, 200, 90, 320, 160, 65, 70, 100, 65, 280, 220];
  widths.forEach((px, i) => {
    requests.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } });
  });

  // Status dropdowns (col 8, 0-indexed)
  requests.push({
    setDataValidation: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 1 + rowCount + 50, startColumnIndex: 8, endColumnIndex: 9 },
      rule: { condition: { type: 'ONE_OF_LIST', values: ['Pending','In Progress','Completed','Cancelled','Blocked','Recurring'].map(v => ({ userEnteredValue: v })) }, showCustomUi: true },
    },
  });

  // Priority dropdowns (col 6)
  requests.push({
    setDataValidation: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 1 + rowCount + 50, startColumnIndex: 6, endColumnIndex: 7 },
      rule: { condition: { type: 'ONE_OF_LIST', values: ['High','Med','Low'].map(v => ({ userEnteredValue: v })) }, showCustomUi: true },
    },
  });

  // Category dropdowns (col 3)
  requests.push({
    setDataValidation: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 1 + rowCount + 50, startColumnIndex: 3, endColumnIndex: 4 },
      rule: { condition: { type: 'ONE_OF_LIST', values: ['Campaign','Ops','Training','Admin','HR','Reporting'].map(v => ({ userEnteredValue: v })) }, showCustomUi: true },
    },
  });

  // Source dropdowns (col 9)
  requests.push({
    setDataValidation: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 1 + rowCount + 50, startColumnIndex: 9, endColumnIndex: 10 },
      rule: { condition: { type: 'ONE_OF_LIST', values: ['Meeting','Slack','Telegram','Internal','Email'].map(v => ({ userEnteredValue: v })) }, showCustomUi: true },
    },
  });

  // Conditional formatting for Status (col 8)
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
          ranges: [{ sheetId, startRowIndex: 1, endRowIndex: 1 + rowCount + 50, startColumnIndex: 8, endColumnIndex: 9 }],
          booleanRule: {
            condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: val }] },
            format: { backgroundColor: bg, textFormat: { foregroundColor: fg } },
          },
        },
        index: 0,
      },
    });
  });

  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

// ── Main ──────────────────────────────────────────────────────────────────────
const append = process.argv.includes('--append');

const auth    = getAuth();
const sheets  = google.sheets({ version: 'v4', auth });

console.log(`\n${append ? 'Appending to' : 'Creating/resetting'} tab "${TAB_NAME}" in tracker...`);

const sheetId = await getOrCreateTab(sheets, SPREADSHEET_ID, TAB_NAME);

if (append) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB_NAME}!A:L`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: SEED_ROWS },
  });
  console.log(`✓ Appended ${SEED_ROWS.length} rows to "${TAB_NAME}"`);
} else {
  await clearAndWriteTab(sheets, SPREADSHEET_ID, TAB_NAME, SEED_ROWS);
  await applyFormatting(sheets, SPREADSHEET_ID, sheetId, SEED_ROWS.length);
  console.log(`✓ Jul 2026 tab created with ${SEED_ROWS.length} rows + formatting/validation`);
}

console.log(`\nView: https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`);
