/**
 * Scans ALL Telegram DMs and groups for action items and appends them
 * to the current month's tab in the Action Item Tracker.
 *
 * Reads as your own user account — sees everything you see in Telegram.
 * Deduplicates by message ID so it's safe to run multiple times per day.
 *
 * Usage: node bin/telegram-capture.mjs [--hours N] [--dry-run]
 *   --hours N    look back N hours (default 24)
 *   --dry-run    print matches without writing to sheet
 *
 * First run: node bin/telegram-auth.mjs  (one-time login)
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
const SEEN_FILE   = path.join(ROOT, 'logs', 'telegram-seen-ids.json');
const LOG_FILE    = path.join(ROOT, 'logs', 'telegram-capture.log');
const CLIENT_FILE = path.join(ROOT, 'google-oauth-client.local.json');
const TOKEN_FILE  = path.join(ROOT, 'google-oauth-token.local.json');

const SPREADSHEET_ID = '1dZ4r-mUjRFfITCVwlMU2oeH6xIUGSZO2J1fJyiYg2SQ';
const MONTH_NAMES    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const args         = process.argv.slice(2);
const dryRun       = args.includes('--dry-run');
const verbose      = args.includes('--verbose');
const hoursArg     = args[args.indexOf('--hours') + 1];
const LOOKBACK_HRS = hoursArg ? parseInt(hoursArg) : 24;

// ── Category inference ────────────────────────────────────────────────────────
function inferCategory(text) {
  const t = (text || '').toLowerCase();
  if (/\b(promo|bonus|reward|rebate|cashback|reactivation|activation)\b|\bcampaign|\boffer|\bcode\b|\blaunch\b/.test(t)) return 'Campaign';
  if (/\breport|\bdashboard\b|\bkpi\b|\bmetric|\banalysis\b|\bstatistic|\bstat\b/.test(t)) return 'Reporting';
  if (/\bbanner|\bpopup|\bpop-up\b|\bcreative\b|\bdesign\b|\bcontent\b|\bcopy\b|\btranslat|\bimage\b/.test(t)) return 'Content';
  if (/\bcrm\b|\bfasttrack\b|\bsmarticio\b|\bplayer\b|\bsegment\b|\bgrooming\b|\bretention\b|\bvip\b/.test(t)) return 'CRM';
  if (/\btrain\b|\bonboard\b|\bsop\b|\bguide\b|\blearn\b|\bmanual\b|\bdocument/.test(t)) return 'Training';
  if (/\bmeeting|\bagenda\b|\bcalendar\b|\bpayroll\b|\bleave\b|\bhr\b|\badmin\b|\binvoice\b|\bbudget\b/.test(t)) return 'Admin';
  return 'Ops';
}

// ── Action-item detection ─────────────────────────────────────────────────────
// In groups we require an explicit name mention + a task keyword.
// In DMs the whole conversation is already directed at Jascinta, so keyword alone suffices.
const MY_NAME_RX = /\bjas\b|\bjascinta\b|@jascinta/i;

const ACTION_KEYWORDS = [
  /\baction item\b/i,
  /\bAI:\s/,
  /\bto-do\b/i,                  // hyphenated only — avoids "want to do later"
  /\bfollow[- ]up\b/i,
  /\b(please|pls)\b.{0,60}\b(check|send|update|prepare|make|get|share|submit|review|follow|assist|advise|help)\b/i,
  /\bcan (you|u)\b.{0,60}\b(check|send|update|prepare|make|get|share|submit|review|assist|advise|help)\b/i,
  /\bto (prepare|check|send|update|get|share|submit|review)\b.{0,40}\b(codes?|promo|list|report|file|link|template)\b/i,
  /\bbrief.{0,30}\bto (prepare|check|send|update|get|share)\b/i,
  /\bneed.{0,30}\bby\b/i,
  /\bby EOD\b/i,
  /\bby end of\b/i,
  /\bdeadline[:\s]/i,
  /\breminder[:\s]/i,
  /\bdue\s+(by|on|date)\b/i,
  /\bby\s+\d+\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
];

// msg.mentioned = true when Telegram's server marks you as @-tagged (any username)
function isActionItem(text, isDm, mentioned) {
  if (!text || text.length < 10) return false;
  const hasKeyword  = ACTION_KEYWORDS.some(rx => rx.test(text));
  const nameInText  = MY_NAME_RX.test(text);
  if (isDm) return hasKeyword;
  // Groups: @-tag (server-side) OR name in text, PLUS an action keyword
  return (mentioned || nameInText) && hasKeyword;
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function loadSeen() {
  if (!fs.existsSync(SEEN_FILE)) return new Set();
  return new Set(JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')));
}
function saveSeen(set) {
  fs.mkdirSync(path.dirname(SEEN_FILE), { recursive: true });
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...set].slice(-10000)));
}

function fmtDate(ts) {
  const d = new Date(ts * 1000);
  return `${d.getDate()}/${d.getMonth() + 1}`;
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

// ── Main ──────────────────────────────────────────────────────────────────────
log(`Telegram capture — lookback ${LOOKBACK_HRS}h${dryRun ? ' [DRY RUN]' : ''}`);

const config = JSON.parse(fs.readFileSync(TG_CONFIG, 'utf8'));
if (!config.session) {
  console.error('No session found. Run: node bin/telegram-auth.mjs');
  process.exit(1);
}

const client = new TelegramClient(
  new StringSession(config.session),
  config.api_id,
  config.api_hash,
  { connectionRetries: 3 }
);

await client.connect();
log('Connected to Telegram');

const cutoff = Math.floor(Date.now() / 1000) - LOOKBACK_HRS * 3600;
const seen   = loadSeen();
const found  = [];

for await (const dialog of client.iterDialogs({ limit: 300 })) {
  // Skip broadcast channels (no personal action items there)
  if (dialog.isChannel && !dialog.entity?.megagroup) continue;

  const isDm      = dialog.isUser;
  const chatName  = dialog.title || dialog.name || 'DM';

  try {
    for await (const msg of client.iterMessages(dialog.inputEntity, { limit: 50 })) {
      if (msg.date < cutoff) break;
      if (!msg.message) continue;

      const uid = `${dialog.id}:${msg.id}`;
      if (seen.has(uid)) continue;
      if (msg.out) continue; // skip messages Jascinta sent herself
      const matched = isActionItem(msg.message, isDm, msg.mentioned);
      if (verbose && !matched) {
        const tag     = isDm ? 'DM' : (msg.mentioned ? 'GRP/@me' : 'GRP');
        const preview = msg.message.slice(0, 80).replace(/\n/g, ' ');
        console.log(`  SKIP [${tag}] "${chatName}": ${preview}`);
      }
      if (!matched) continue;

      const sender = msg.sender
        ? [msg.sender.firstName, msg.sender.lastName].filter(Boolean).join(' ')
        : 'Unknown';

      found.push({
        uid,
        date: fmtDate(msg.date),
        topic: chatName,
        category: inferCategory(msg.message),
        actionItem: msg.message.slice(0, 300).replace(/\n/g, ' '),
        assignee: config.my_name || 'Jascinta',
        priority: '',
        dueDate: '',
        status: 'Pending',
        source: 'Telegram',
        sourceLink: `tg://msg/${dialog.id}/${msg.id}`,
        remarks: `From: ${sender}`,
      });
    }
  } catch (e) {
    log(`  Skip "${chatName}": ${e.message}`);
  }
}

await client.disconnect();
log(`Found ${found.length} new action item(s)`);

if (found.length === 0) { log('Nothing to write.'); process.exit(0); }

if (dryRun) {
  found.forEach((r, i) => console.log(`\n[${i + 1}] ${r.date} | ${r.topic}\n  ${r.actionItem}`));
  process.exit(0);
}

// ── Write to sheet ────────────────────────────────────────────────────────────
const tabName = currentTabName();
const auth    = getSheetsAuth();
const sheets  = google.sheets({ version: 'v4', auth });

const existing = await sheets.spreadsheets.values.get({
  spreadsheetId: SPREADSHEET_ID,
  range: `${tabName}!B:B`,
});
const rowCount = (existing.data.values || []).filter(r => r[0] && !isNaN(r[0])).length;
const nextNum  = rowCount + 1;

const newRows = found.map((r, i) => [
  r.date, String(nextNum + i), r.topic, r.category,
  r.actionItem, r.assignee, r.priority, r.dueDate,
  r.status, r.source, r.sourceLink, r.remarks,
]);

await sheets.spreadsheets.values.append({
  spreadsheetId: SPREADSHEET_ID,
  range: `${tabName}!A:L`,
  valueInputOption: 'USER_ENTERED',
  requestBody: { values: newRows },
});

found.forEach(r => seen.add(r.uid));
saveSeen(seen);
log(`✓ Appended ${found.length} rows to "${tabName}"`);
