/**
 * Reads Pending / In Progress Telegram rows from the tracker sheet,
 * scans recent messages in each chat for replies that signal completion,
 * and updates the Status column automatically.
 *
 * Usage: node bin/status-sync.mjs [--dry-run]
 *
 * Source link format stored by telegram-capture: tg://msg/{dialogId}/{msgId}
 */

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const TG_CONFIG   = path.join(ROOT, 'telegram-config.local.json');
const LOG_FILE    = path.join(ROOT, 'logs', 'status-sync.log');
const CLIENT_FILE = path.join(ROOT, 'google-oauth-client.local.json');
const TOKEN_FILE  = path.join(ROOT, 'google-oauth-token.local.json');

const SPREADSHEET_ID = '1dZ4r-mUjRFfITCVwlMU2oeH6xIUGSZO2J1fJyiYg2SQ';
const MONTH_NAMES    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const dryRun = process.argv.includes('--dry-run');

// ── Signal patterns ───────────────────────────────────────────────────────────
const DONE_RX = /\b(done|completed?|finish(ed)?|resolved?|sorted|fixed|ok done|already done|siap|dah buat)\b|✅|☑/i;
const IN_PROGRESS_RX = /\b(in progress|wip|working on it|on it|in the process|noted|will do|okay will)\b/i;

// ── Helpers ───────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function currentTabName() {
  const now = new Date();
  return `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
}

function getSheetsAuth() {
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

// Parse "tg://msg/{dialogId}/{msgId}" → { dialogId: string, msgId: number }
function parseTgLink(link) {
  const m = (link || '').match(/^tg:\/\/msg\/(-?\d+)\/(\d+)$/);
  if (!m) return null;
  return { dialogIdStr: m[1], msgId: parseInt(m[2]) };
}

// Columns: [0]=Date [1]=Seq [2]=Topic [3]=Cat [4]=Item [5]=Assignee
//          [6]=Priority [7]=Due [8]=Status [9]=Source [10]=Link [11]=Remarks

// ── Main ──────────────────────────────────────────────────────────────────────
log(`Status sync${dryRun ? ' [DRY RUN]' : ''}`);

// 1. Read sheet
const tabName = currentTabName();
const auth    = getSheetsAuth();
const sheets  = google.sheets({ version: 'v4', auth });

const getRes = await sheets.spreadsheets.values.get({
  spreadsheetId: SPREADSHEET_ID,
  range: `${tabName}!A:L`,
});
const allRows = getRes.data.values || [];
const dataRows = allRows.slice(1); // skip header

// 2. Find Telegram rows that are Pending or In Progress and have a tg:// link
const targets = [];
dataRows.forEach((row, idx) => {
  const src    = (row[9] || '').trim();
  const status = (row[8] || '').trim();
  const link   = (row[10] || '').trim();

  if (src !== 'Telegram') return;
  if (!['Pending', 'In Progress'].includes(status)) return;
  const parsed = parseTgLink(link);
  if (!parsed) return;

  targets.push({ rowIndex: idx + 2, row, ...parsed, currentStatus: status }); // rowIndex is 1-based sheet row
});

log(`Found ${targets.length} Telegram row(s) to check`);
if (targets.length === 0) { log('Nothing to sync.'); process.exit(0); }

// 3. Group targets by dialogId
const byDialog = new Map();
for (const t of targets) {
  if (!byDialog.has(t.dialogIdStr)) byDialog.set(t.dialogIdStr, []);
  byDialog.get(t.dialogIdStr).push(t);
}

// 4. Connect to Telegram
const config = JSON.parse(fs.readFileSync(TG_CONFIG, 'utf8'));
const client = new TelegramClient(
  new StringSession(config.session),
  config.api_id,
  config.api_hash,
  { connectionRetries: 3 }
);
await client.connect();
log('Connected to Telegram');

const updates = []; // { rowIndex, newStatus }

// 5. For each dialog that has pending items, scan recent messages for replies
for await (const dialog of client.iterDialogs({ limit: 300 })) {
  const dialogIdStr = String(dialog.id);
  if (!byDialog.has(dialogIdStr)) continue;

  const pendingItems = byDialog.get(dialogIdStr);
  const pendingMsgIds = new Set(pendingItems.map(t => t.msgId));

  log(`  Checking "${dialog.title || dialog.name}" — ${pendingItems.length} pending item(s)`);

  try {
    for await (const msg of client.iterMessages(dialog.inputEntity, { limit: 80 })) {
      const replyToId = msg.replyTo?.replyToMsgId;
      if (!replyToId || !pendingMsgIds.has(replyToId)) continue;
      if (!msg.message) continue;

      // Found a reply to one of our tracked messages
      const target = pendingItems.find(t => t.msgId === replyToId);
      if (!target) continue;

      const text = msg.message;
      let newStatus = null;
      if (DONE_RX.test(text)) newStatus = 'Completed';
      else if (IN_PROGRESS_RX.test(text) && target.currentStatus !== 'In Progress') newStatus = 'In Progress';

      if (newStatus && newStatus !== target.currentStatus) {
        log(`    → Row ${target.rowIndex}: "${(target.row[4] || '').slice(0, 60)}" → ${newStatus}`);
        log(`      Reply: "${text.slice(0, 80)}"`);
        // Only take the latest-signal update per row
        const existing = updates.find(u => u.rowIndex === target.rowIndex);
        if (!existing) {
          updates.push({ rowIndex: target.rowIndex, newStatus });
        } else if (newStatus === 'Completed') {
          existing.newStatus = 'Completed'; // completed overrides in-progress
        }
      }
    }
  } catch (e) {
    log(`    Skip "${dialog.title}": ${e.message}`);
  }
}

await client.disconnect();
log(`Found ${updates.length} status update(s)`);

if (updates.length === 0) { log('No changes.'); process.exit(0); }

if (dryRun) {
  updates.forEach(u => console.log(`  Row ${u.rowIndex} → ${u.newStatus}`));
  process.exit(0);
}

// 6. Write status updates to sheet (update each cell individually)
for (const { rowIndex, newStatus } of updates) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabName}!I${rowIndex}`,    // col I = Status
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[newStatus]] },
  });
  log(`  ✓ Updated row ${rowIndex} → ${newStatus}`);
}

log('Done.');
