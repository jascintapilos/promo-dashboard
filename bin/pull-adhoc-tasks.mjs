/**
 * pull-adhoc-tasks.mjs
 *
 * Scan Slack (#promotions-team, #ba-promo) and Telegram (morning-chain
 * group, via bin/tg-bot-poll.mjs's local capture) for adhoc task
 * assignments and write new rows to the Weekly Report 'Adhoc Tasks' tab.
 *
 * The Telegram parser is a first pass, not yet tuned against real data the
 * way the Slack regexes below are (MEETING_RX/BOT_HEADER_RX/TEAM_TASK_RX
 * clearly took iteration) — expect to adjust deriveModule/hasAction-style
 * heuristics for tgParseTask() once real morning-chain messages flow in.
 * Telegram coverage only starts from whenever the bot was added to the
 * group — Bot API has no way to fetch history from before that.
 *
 * Schema: Date | Task Type | Task | Assignee
 *
 * DRY RUN by default — prints candidate rows for review.
 * Pass --commit to write to the sheet.
 *
 * Usage:
 *   node bin/pull-adhoc-tasks.mjs                # 45-day lookback, dry run
 *   node bin/pull-adhoc-tasks.mjs --days=14      # wider window
 *   node bin/pull-adhoc-tasks.mjs --commit       # write to sheet after review
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';
import { searchMessages as tgSearchMessages, getBotConfig as tgGetBotConfig } from '../src/tg-store.js';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const COMMIT  = flags.commit === true;
// 45-day default: rows are de-duplicated against the tab, so a wide look-back is
// safe and survives pull outages (Sep 2026: 10 days → 11-26 Sep never collected).
const DAYS    = Math.max(1, parseInt(flags.days || '45'));

// ── Slack auth ────────────────────────────────────────────────────────────────
let SLACK_TOKEN = process.env.SLACK_TOKEN;
if (!SLACK_TOKEN) {
  try {
    const __dir = dirname(fileURLToPath(import.meta.url));
    SLACK_TOKEN = JSON.parse(readFileSync(join(__dir, '..', 'slack-token.local.json'), 'utf8')).token;
  } catch (_) {}
}
if (!SLACK_TOKEN) { console.error('No SLACK_TOKEN. Create slack-token.local.json.'); process.exit(1); }

// ── Team map (mirrors sync-slack-tasks.mjs) ───────────────────────────────────
const SLACK_USER_MAP = {
  U097Q9DTK29: 'Jascinta',
  U03PNM6HZ5F: 'Wai Yip',
  U09R45VQTS4: 'Alysa',
  U0AGCJTPZ9T: 'Wen',
  U09LNJ8AJ6P: 'Elyssa',
  U0B188FCFB5: 'Diandra',
  U0AUBNBB9DK: 'Gaby',
};
const PROMO_TEAM_IDS   = new Set(Object.keys(SLACK_USER_MAP));
const PROMO_SUBTEAM_ID = 'S09V5EDERHS';

const CHANNELS = {
  team: { id: 'C09LT8W2D70', name: 'promotions-team' },
  ba:   { id: 'C07KKVD1GTE', name: 'ba-promo'         },
};

// ── Module → Task Type ────────────────────────────────────────────────────────
const MODULE_TO_TYPE = {
  Banners:     'Brand Setup & Config',
  Promo:       'Campaign & Coordination',
  Translation: 'Campaign & Coordination',
  Content:     'T&C Update',
  General:     'Housekeeping',
};

// ── Slack helpers ─────────────────────────────────────────────────────────────
async function slackGet(method, params = {}) {
  const url = new URL(`https://slack.com/api/${method}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url.toString(), { headers: { Authorization: 'Bearer ' + SLACK_TOKEN } });
  const json = await res.json();
  if (!json.ok) throw new Error(`Slack ${method}: ${json.error}`);
  return json;
}
async function fetchHistory(channelId, oldestTs) {
  const msgs = [];
  let cursor;
  do {
    const p = { channel: channelId, limit: 200, oldest: String(oldestTs) };
    if (cursor) p.cursor = cursor;
    const d = await slackGet('conversations.history', p);
    msgs.push(...(d.messages || []));
    cursor = d.response_metadata?.next_cursor;
  } while (cursor);
  return msgs;
}

function mentionedTeamIds(text) {
  const ids = [];
  for (const m of text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g)) {
    if (PROMO_TEAM_IDS.has(m[1])) ids.push(m[1]);
  }
  return ids;
}

function stripMarkup(text) {
  return text
    .replace(/<!subteam\^[A-Z0-9]+>/g, '')
    .replace(/<@[A-Z0-9]+(?:\|[^>]+)?>/g, '')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function deriveModule(text) {
  if (/translation request|translate/i.test(text)) return 'Translation';
  if (/banner/i.test(text))                         return 'Banners';
  if (/promo code|FC\d|RN\d|P\d{3}/i.test(text))   return 'Promo';
  if (/UAT|t&c|inbox|template/i.test(text))         return 'Content';
  return 'General';
}

// ── Noise-signal patterns ────────────────────────────────────────────────────
// Meeting/scheduling language (excludes real task words like "upload")
const MEETING_RX    = /\b(zoom(?: now)?|quick catch|weekly catch|team meeting|catch.?up at \d|reminder weekly|hi team.*meeting)\b/i;
// Automated report headers (Slack bot posts formatted in bold)
const BOT_HEADER_RX = /^\*Automated\b/;
// Team-broadcast structured task markers — broadcast with no marker = announcement
const TEAM_TASK_RX  = /\[banner\]|robocall|clickup|\bcampaign\b.*\b(?:upload|setup|launch)\b/i;

// ── Parse #promotions-team message → adhoc rows ───────────────────────────────
function parseTeam(msg) {
  const text = msg.text || '';
  const mentionsSubteam = text.includes(`<!subteam^${PROMO_SUBTEAM_ID}>`);
  const teamIds = mentionedTeamIds(text);

  if (!mentionsSubteam && !teamIds.length) return [];
  if (text.length < 15) return [];

  const stripped = stripMarkup(text);
  const firstLine = stripped.split('\n')[0].trim();

  // Drop: bot automated reports, meeting/scheduling messages
  if (BOT_HEADER_RX.test(stripped)) return [];
  if (MEETING_RX.test(stripped))    return [];

  // Drop: team broadcast (subteam mention, no individual) with no structured task noun
  if (!teamIds.length && mentionsSubteam && !TEAM_TASK_RX.test(stripped)) return [];

  // Improved question detection: also catches '?' within first 80 chars (mid-sentence)
  const looksQuestion = (/\?\s*$/.test(firstLine) && firstLine.length < 80)
                     || /^.{0,80}\?/.test(stripped);
  // "assign" removed — it appears in questions ("which module to assign?"), not imperatives
  const hasAction = /\b(help|please|kindly|update|amend|review|create|add|fix|do|prepare|translate|upload|deploy|submit|qc|verify|monitor|brief|join|need|check|remove|edit|send|share)\b/i.test(text);
  if (looksQuestion && !hasAction) return [];

  const date = new Date(parseFloat(msg.ts) * 1000).toISOString().slice(0, 10);
  const module = deriveModule(text);
  const taskType = MODULE_TO_TYPE[module] || 'Housekeeping';
  const task = firstLine.length > 5 ? firstLine.slice(0, 100) : stripped.slice(0, 100);

  if (teamIds.length) {
    return teamIds.map(id => ({
      date, taskType, task,
      assignee: SLACK_USER_MAP[id] || id,
      _source: '#promotions-team',
    }));
  }
  return [{ date, taskType, task, assignee: 'Team', _source: '#promotions-team' }];
}

// ── Parse #ba-promo message → adhoc rows ─────────────────────────────────────
function parseBa(msg) {
  const text = msg.text || '';
  if (!/task\s*:/i.test(text) || !/banner|upload|B\d+/i.test(text)) return [];

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const taskLine = lines.find(l => /^task\s*:/i.test(l));
  const campaign = taskLine ? taskLine.replace(/^task\s*:\s*/i, '').slice(0, 80) : 'Banner Upload';
  const date = new Date(parseFloat(msg.ts) * 1000).toISOString().slice(0, 10);

  const assignLines = lines.filter(l => /^B\d+/i.test(l) && (/@\w+/.test(l) || /<@[A-Z0-9]+/.test(l)));
  if (!assignLines.length) return [];

  return assignLines.map(line => {
    const bidsMatch = line.match(/^(B[\d\-–,\s]+)/i);
    const bids = bidsMatch ? bidsMatch[1].trim() : '';
    let assignee = 'Team';
    const slackRef = line.match(/<@([A-Z0-9]+)/);
    if (slackRef && SLACK_USER_MAP[slackRef[1]]) assignee = SLACK_USER_MAP[slackRef[1]];
    else {
      const atRef = line.match(/:?\s*@(\w+)\s*$/);
      if (atRef) assignee = atRef[1];
    }
    return {
      date,
      taskType: 'Brand Setup & Config',
      task: `[Banner] ${campaign}${bids ? ' — ' + bids : ''}`.slice(0, 100),
      assignee,
      _source: '#ba-promo',
    };
  });
}

// ── Telegram: morning-chain group ────────────────────────────────────────────
// Fill in as usernames are confirmed — unmapped mentions fall back to the
// raw @username, matching SLACK_USER_MAP's fallback behaviour.
const TG_USER_MAP = {};

function parseTg(msg) {
  const text = msg.text || '';
  if (text.length < 15) return [];
  if (BOT_HEADER_RX.test(text)) return [];
  if (MEETING_RX.test(text)) return [];

  const hasAction = /\b(help|please|kindly|update|amend|review|create|add|fix|do|prepare|translate|upload|deploy|submit|qc|verify|monitor|brief|join|need|check|remove|edit|send|share)\b/i.test(text);
  const mentions = (msg.entities || []).map((e) => e.username || e.text?.replace(/^@/, '')).filter(Boolean);
  if (!hasAction && !mentions.length) return [];

  const firstLine = text.split('\n')[0].trim();
  const date = msg.date.slice(0, 10);
  const module = deriveModule(text);
  const taskType = MODULE_TO_TYPE[module] || 'Housekeeping';
  const task = firstLine.length > 5 ? firstLine.slice(0, 100) : text.slice(0, 100);

  if (mentions.length) {
    return mentions.map((u) => ({
      date, taskType, task,
      assignee: TG_USER_MAP[u] || u,
      _source: 'TG morning-chain',
    }));
  }
  return [{ date, taskType, task, assignee: msg.from || 'Team', _source: 'TG morning-chain' }];
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`\n━━ Adhoc Tasks pull — ${new Date().toISOString().slice(0,10)} ━━`);
console.log(`Lookback: ${DAYS} days  Mode: ${COMMIT ? 'COMMIT' : 'DRY RUN'}\n`);

const oldestTs = ((Date.now() / 1000) - DAYS * 86400).toFixed(6);
const rows = [];

// Scan #promotions-team
process.stdout.write(`Scanning #promotions-team… `);
const teamMsgs = await fetchHistory(CHANNELS.team.id, oldestTs);
const teamRows = teamMsgs.flatMap(m => (m.type === 'message' && !m.subtype) ? parseTeam(m) : []);
console.log(`${teamMsgs.length} messages → ${teamRows.length} task row(s)`);
rows.push(...teamRows);

// Scan #ba-promo
process.stdout.write(`Scanning #ba-promo… `);
const baMsgs = await fetchHistory(CHANNELS.ba.id, oldestTs);
const baRows = baMsgs.flatMap(m => (m.type === 'message' && !m.subtype) ? parseBa(m) : []);
console.log(`${baMsgs.length} messages → ${baRows.length} task row(s)`);
rows.push(...baRows);

// Scan Telegram morning-chain group (local capture — see bin/tg-bot-poll.mjs)
const tgConfig = tgGetBotConfig();
if (tgConfig?.chatId) {
  process.stdout.write(`Scanning TG morning-chain… `);
  const sinceIso = new Date(Date.now() - DAYS * 86400 * 1000).toISOString().slice(0, 10);
  const tgMsgs = tgSearchMessages({ since: sinceIso, limit: 5000 });
  const tgRows = tgMsgs.flatMap(parseTg);
  console.log(`${tgMsgs.length} messages → ${tgRows.length} task row(s)`);
  rows.push(...tgRows);
} else {
  console.log('Skipping Telegram — not yet configured (see bin/tg-bot-poll.mjs setup).');
}

// Sort by date descending
rows.sort((a, b) => b.date.localeCompare(a.date));

console.log(`\nTotal candidate rows: ${rows.length}`);

if (!rows.length) {
  console.log('No new adhoc tasks found in the lookback window.');
  process.exit(0);
}

// ── Dedupe against existing Adhoc Tasks tab ───────────────────────────────────
const { sheets } = await getSheetsClient();
const OPS_ID = getOpsSheetId();
const ADHOC_TAB = 'Adhoc Tasks';

const existing = await sheets.spreadsheets.values.get({ spreadsheetId: OPS_ID, range: `'${ADHOC_TAB}'!A:D` });
const existingRows = (existing.data.values || []).slice(1);
// Dedup key: date + first 40 chars of task + assignee
const existingKeys = new Set(existingRows.map(r => `${r[0]}|||${(r[2]||'').slice(0,40)}|||${r[3]||''}`));
const fresh = rows.filter(r => !existingKeys.has(`${r.date}|||${r.task.slice(0,40)}|||${r.assignee}`));
const dupes = rows.length - fresh.length;

console.log(`Already in sheet: ${dupes}  |  New: ${fresh.length}\n`);

// ── Review table ──────────────────────────────────────────────────────────────
console.log('╔══════════════════════════════════════════════════════════════════════════════════════════════╗');
console.log('║  DRAFT — Proposed Adhoc Tasks rows                                                          ║');
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
