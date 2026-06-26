/**
 * pull-tg-tasks.mjs
 *
 * Scan Telegram groups for adhoc task assignments and append new rows to the
 * Weekly Report 'Adhoc Tasks' tab (same schema as pull-adhoc-tasks.mjs).
 *
 * Schema: Date | Task Type | Task | Assignee
 *
 * DRY RUN by default — pass --commit to write to the sheet.
 *
 * Prerequisites:
 *   1. telegram-creds.local.json  — { "apiId": <number>, "apiHash": "<string>" }
 *      from https://my.telegram.org → API development tools
 *   2. telegram-session.local.json — created by capture-telegram-session.mjs (one-time)
 *   3. TG_GROUP_IDS in this file — discover via capture-telegram-session.mjs output
 *
 * Usage:
 *   node bin/pull-tg-tasks.mjs                # 10-day lookback, dry run
 *   node bin/pull-tg-tasks.mjs --days=14      # wider window
 *   node bin/pull-tg-tasks.mjs --commit       # write to sheet after review
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';
import { parseArgs } from './_args.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, '..');

const { flags } = parseArgs(process.argv.slice(2));
const COMMIT = flags.commit === true;
const DAYS   = Math.max(1, parseInt(flags.days || '10'));

// ── Team member Telegram usernames/IDs ───────────────────────────────────────
// Run capture-telegram-session.mjs once to discover group IDs and member IDs.
// Populate these before first use.
//
// Format: telegram_user_id (number) → display name
// To discover IDs: after capture, run: node -e "..." or check the capture output
const TG_USER_MAP = {
  // Example — replace with real IDs after running capture-telegram-session.mjs:
  // 123456789: 'Jascinta',
  // 987654321: 'Wai Yip',
};

// Telegram group/supergroup IDs to scan — discover via capture-telegram-session.mjs
// Add as numbers (negative for groups/supergroups, positive for channels).
// Example: [-1001234567890]
const TG_GROUP_IDS = [
  // -1001234567890,  // Promotions Team (example — replace with real ID)
];

// ── Load credentials + session ────────────────────────────────────────────────
const CREDS_FILE   = join(ROOT, 'telegram-creds.local.json');
const SESSION_FILE = join(ROOT, 'telegram-session.local.json');

if (!existsSync(CREDS_FILE)) {
  console.error('⛔ telegram-creds.local.json not found. See capture-telegram-session.mjs.');
  process.exit(1);
}
if (!existsSync(SESSION_FILE)) {
  console.error('⛔ telegram-session.local.json not found. Run: node bin/capture-telegram-session.mjs');
  process.exit(1);
}
if (!TG_GROUP_IDS.length) {
  console.error('⛔ TG_GROUP_IDS is empty. Run capture-telegram-session.mjs to discover group IDs,');
  console.error('   then populate TG_GROUP_IDS in this file.');
  process.exit(1);
}

const creds  = JSON.parse(readFileSync(CREDS_FILE, 'utf8'));
const { session: sessionString } = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));

// ── GramJS client ─────────────────────────────────────────────────────────────
const { TelegramClient } = await import('telegram');
const { StringSession }  = await import('telegram/sessions/index.js');

const client = new TelegramClient(
  new StringSession(sessionString),
  Number(creds.apiId),
  creds.apiHash,
  { connectionRetries: 3 }
);

await client.connect();
if (!await client.isUserAuthorized()) {
  console.error('⛔ Telegram session expired. Run: node bin/capture-telegram-session.mjs');
  await client.disconnect();
  process.exit(1);
}

// ── Module → Task Type (matches pull-adhoc-tasks.mjs) ────────────────────────
const MODULE_TO_TYPE = {
  Banners:     'Brand Setup & Config',
  Promo:       'Campaign & Coordination',
  Translation: 'Campaign & Coordination',
  Content:     'T&C Update',
  General:     'Housekeeping',
};

function deriveModule(text) {
  if (/translation request|translate/i.test(text)) return 'Translation';
  if (/banner/i.test(text))                         return 'Banners';
  if (/promo code|FC\d|RN\d|P\d{3}/i.test(text))   return 'Promo';
  if (/UAT|t&c|inbox|template/i.test(text))         return 'Content';
  return 'General';
}

// ── Noise filters (same logic as pull-adhoc-tasks.mjs parseTeam) ──────────────
const MEETING_RX    = /\b(zoom(?: now)?|quick catch|weekly catch|team meeting|catch.?up at \d|reminder weekly)\b/i;
const BOT_HEADER_RX = /^\*Automated\b/;

function isNoise(text) {
  if (MEETING_RX.test(text))    return true;
  if (BOT_HEADER_RX.test(text)) return true;
  const hasAction = /\b(help|please|kindly|update|amend|review|create|add|fix|do|prepare|translate|upload|deploy|submit|qc|verify|monitor|brief|join|need|check|remove|edit|send|share)\b/i.test(text);
  const looksQuestion = /^.{0,80}\?/.test(text);
  if (looksQuestion && !hasAction) return true;
  return false;
}

// ── Fetch group history ───────────────────────────────────────────────────────
async function fetchGroupMessages(groupId, days) {
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  const msgs = [];
  let offsetId = 0;
  let retries = 0;

  while (true) {
    let batch;
    try {
      batch = await client.getMessages(groupId, { limit: 100, offsetId, reverse: false });
    } catch (err) {
      if (err.constructor?.name === 'FloodWaitError' && retries < 3) {
        const wait = (err.seconds || 30) + 2;
        console.warn(`  Rate limited — waiting ${wait}s…`);
        await new Promise(r => setTimeout(r, wait * 1000));
        retries++;
        continue;
      }
      throw err;
    }
    retries = 0;

    if (!batch || !batch.length) break;

    for (const msg of batch) {
      if (!msg.date || msg.date < cutoff) continue;
      if (msg.message) msgs.push(msg);
    }

    // If oldest message in batch is before cutoff, we're done
    const oldest = batch[batch.length - 1];
    if (!oldest || !oldest.date || oldest.date < cutoff) break;

    offsetId = batch[batch.length - 1].id;
    await new Promise(r => setTimeout(r, 400)); // polite pacing
  }

  return msgs;
}

// ── Parse TG message → adhoc rows ─────────────────────────────────────────────
function parseMsg(msg, groupTitle) {
  const text = msg.message || '';
  if (text.length < 15) return [];
  if (isNoise(text)) return [];

  // Find team member mentions: @username or by sender
  const mentionedIds = [];
  for (const [id] of Object.entries(TG_USER_MAP)) {
    if (new RegExp(`@${id}|\\bid ${id}\\b`, 'i').test(text)) {
      mentionedIds.push(Number(id));
    }
  }

  // Sender is always captured as a potential assignee
  const senderId = msg.fromId?.userId?.toString?.() || msg.senderId?.toString?.();
  const senderName = TG_USER_MAP[senderId] || null;

  if (!mentionedIds.length && !senderName) return [];

  const date = new Date(msg.date * 1000).toISOString().slice(0, 10);
  const module = deriveModule(text);
  const taskType = MODULE_TO_TYPE[module] || 'Housekeeping';
  const task = text.split('\n')[0].trim().slice(0, 100);

  if (mentionedIds.length) {
    return mentionedIds.map(id => ({
      date, taskType, task,
      assignee: TG_USER_MAP[id] || String(id),
      _source: `TG:${groupTitle}`,
    }));
  }
  return [{ date, taskType, task, assignee: senderName, _source: `TG:${groupTitle}` }];
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`\n━━ TG Adhoc Tasks pull — ${new Date().toISOString().slice(0,10)} ━━`);
console.log(`Lookback: ${DAYS} days  Mode: ${COMMIT ? 'COMMIT' : 'DRY RUN'}\n`);

const rows = [];
for (const groupId of TG_GROUP_IDS) {
  let groupTitle = String(groupId);
  try {
    const entity = await client.getEntity(groupId);
    groupTitle = entity.title || groupTitle;
  } catch (_) {}

  process.stdout.write(`Scanning ${groupTitle}… `);
  try {
    const msgs = await fetchGroupMessages(groupId, DAYS);
    const groupRows = msgs.flatMap(m => parseMsg(m, groupTitle));
    console.log(`${msgs.length} messages → ${groupRows.length} task row(s)`);
    rows.push(...groupRows);
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
  }
}

await client.disconnect();

rows.sort((a, b) => b.date.localeCompare(a.date));
console.log(`\nTotal candidate rows: ${rows.length}`);

if (!rows.length) {
  console.log('No new adhoc tasks found in the lookback window.');
  process.exit(0);
}

// ── Dedupe against existing Adhoc Tasks tab ───────────────────────────────────
const { sheets } = await getSheetsClient();
const OPS_ID    = getOpsSheetId();
const ADHOC_TAB = 'Adhoc Tasks';

const existing = await sheets.spreadsheets.values.get({ spreadsheetId: OPS_ID, range: `'${ADHOC_TAB}'!A:D` });
const existingRows = (existing.data.values || []).slice(1);
const existingKeys = new Set(existingRows.map(r => `${r[0]}|||${(r[2]||'').slice(0,40)}|||${r[3]||''}`));
const fresh = rows.filter(r => !existingKeys.has(`${r.date}|||${r.task.slice(0,40)}|||${r.assignee}`));
const dupes = rows.length - fresh.length;

console.log(`Already in sheet: ${dupes}  |  New: ${fresh.length}\n`);

// ── Review table ──────────────────────────────────────────────────────────────
console.log('╔══════════════════════════════════════════════════════════════════════════════════════════════╗');
console.log('║  DRAFT — Proposed Adhoc Tasks rows (from Telegram)                                          ║');
console.log('╠══════════════╦════════════════════════╦══════════════════════════════════════╦═════════════╣');
console.log('║  Date        ║  Task Type             ║  Task                                ║  Assignee   ║');
console.log('╠══════════════╬════════════════════════╬══════════════════════════════════════╬═════════════╣');
for (const r of fresh) {
  console.log(
    `║  ${r.date.padEnd(12)}║  ${r.taskType.padEnd(22)}║  ${r.task.slice(0, 36).padEnd(36)}║  ${r.assignee.padEnd(11)}║`
  );
}
console.log('╚══════════════╩════════════════════════╩══════════════════════════════════════╩═════════════╝');

if (!COMMIT) {
  console.log(`\n(DRY RUN — re-run with --commit to append ${fresh.length} row(s) to '${ADHOC_TAB}')`);
  process.exit(0);
}

// ── Commit ────────────────────────────────────────────────────────────────────
if (!fresh.length) { console.log('Nothing new to write.'); process.exit(0); }

await sheets.spreadsheets.values.append({
  spreadsheetId: OPS_ID,
  range: `'${ADHOC_TAB}'!A:D`,
  valueInputOption: 'USER_ENTERED',
  insertDataOption: 'INSERT_ROWS',
  requestBody: { values: fresh.map(r => [r.date, r.taskType, r.task, r.assignee]) },
});
console.log(`\n✅ Appended ${fresh.length} row(s) to '${ADHOC_TAB}'.`);
