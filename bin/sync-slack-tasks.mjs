#!/usr/bin/env node
/**
 * sync-slack-tasks.mjs
 *
 * Live Slack → Task_Master sync for the Promo Control Tower dashboard.
 *
 * Channels:
 *   • #ba-promo         (C07KKVD1GTE) — banner upload tasks (parseBanner)
 *   • #promotions-team  (C09LT8W2D70) — general team tasks (parseTeamMsg)
 *
 * Filter for #promotions-team: ONLY messages that tag the promo team subteam
 * (<!subteam^S09V5EDERHS>) OR one of the known promo team user IDs are kept.
 *
 * Output: upserts into Task_Master tab of the PromoOps_Control_Layer sheet.
 *
 * Usage:
 *   node bin/sync-slack-tasks.mjs                # full sync
 *   node bin/sync-slack-tasks.mjs --dry-run      # print only
 *   node bin/sync-slack-tasks.mjs --days=7       # lookback window
 *   node bin/sync-slack-tasks.mjs --channel=ba   # ba-promo only
 *   node bin/sync-slack-tasks.mjs --channel=team # promotions-team only
 */

import { getGoogleAuth, loadGoogleapis } from '../src/google-auth.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

// ── Constants ───────────────────────────────────────────────────────────────
const CHANNELS = {
  ba:   { id: 'C07KKVD1GTE', name: 'ba-promo',         parser: parseBanner },
  team: { id: 'C09LT8W2D70', name: 'promotions-team',  parser: parseTeamMsg },
};
const PROMO_SUBTEAM_ID = 'S09V5EDERHS';
const CONTROL_LAYER_ID = '16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk';
const TASK_MASTER_TAB  = 'Task_Master';

const SLACK_USER_MAP = {
  U097Q9DTK29: { name: 'Jascinta', email: 'jascinta.pilos@thebrandingpeople.co' },
  U03PNM6HZ5F: { name: 'Wai Yip',  email: 'waiyip@thebrandingpeople.co' },
  U09R45VQTS4: { name: 'Alysa',    email: 'alysa@thebrandingpeople.co' },
  U0AGCJTPZ9T: { name: 'Wen',      email: 'wen@thebrandingpeople.co' },
  U09LNJ8AJ6P: { name: 'Elyssa',   email: 'elyssa@thebrandingpeople.co' },
  U0B188FCFB5: { name: 'Diandra',  email: 'diandra@thebrandingpeople.co' },
  U0AUBNBB9DK: { name: 'Gaby',     email: 'gaby@thebrandingpeople.co' },
};
const PROMO_TEAM_IDS = new Set(Object.keys(SLACK_USER_MAP));

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN  = args.includes('--dry-run');
const daysArg  = args.find(a => a.startsWith('--days='));
const chanArg  = args.find(a => a.startsWith('--channel='));
const LOOKBACK = daysArg ? Math.max(1, parseInt(daysArg.split('=')[1]) || 30) : 30;
const chanFilter = chanArg ? chanArg.split('=')[1] : null;

// ── Token loading ───────────────────────────────────────────────────────────
let SLACK_TOKEN = process.env.SLACK_TOKEN;
if (!SLACK_TOKEN) {
  try {
    const __dir = dirname(fileURLToPath(import.meta.url));
    SLACK_TOKEN = JSON.parse(readFileSync(join(__dir, '..', 'slack-token.local.json'), 'utf8')).token;
  } catch (_) {}
}
if (!SLACK_TOKEN) { console.error('No SLACK_TOKEN.'); process.exit(1); }

// ── Slack API helpers ───────────────────────────────────────────────────────
async function slackGet(method, params = {}) {
  const url = new URL(`https://slack.com/api/${method}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url.toString(), { headers: { Authorization: 'Bearer ' + SLACK_TOKEN } });
  const json = await res.json();
  if (!json.ok) throw new Error(`Slack ${method}: ${json.error}`);
  return json;
}
async function fetchChannelHistory(channelId, oldestTs) {
  const messages = [];
  let cursor;
  do {
    const params = { channel: channelId, limit: 200, oldest: String(oldestTs) };
    if (cursor) params.cursor = cursor;
    const data = await slackGet('conversations.history', params);
    messages.push(...(data.messages || []));
    cursor = data.response_metadata?.next_cursor;
  } while (cursor);
  return messages;
}
async function fetchThreadReplies(channelId, ts) {
  try {
    const data = await slackGet('conversations.replies', { channel: channelId, ts, limit: 100 });
    return (data.messages || []).slice(1);
  } catch (_) { return []; }
}

// ── Date normaliser (D/M → ISO yyyy-mm-dd) ──────────────────────────────────
function normalizeDeadline(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  // Pattern: "21/5" or "21/5/26" or "21/5/2026"
  let m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (m) {
    const day = +m[1], mon = +m[2];
    let year = m[3] ? +m[3] : new Date().getUTCFullYear();
    if (year < 100) year += 2000;
    const iso = `${year}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    if ((new Date() - new Date(iso + 'T00:00:00Z')) / 86400000 > 180) {
      return `${year+1}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
    return iso;
  }
  // Pattern: "18 May", "18 May 2026", "18 May, 12pm"
  m = s.match(/^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?:\s+(\d{2,4}))?/i);
  if (m) {
    const monMap = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
    const day = +m[1], mon = monMap[m[2].toLowerCase().slice(0,3)];
    let year = m[3] ? +m[3] : new Date().getUTCFullYear();
    if (year < 100) year += 2000;
    return `${year}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  // Pattern: "EOD 20/5"
  m = s.match(/EOD\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i);
  if (m) {
    return normalizeDeadline(`${m[1]}/${m[2]}${m[3] ? '/'+m[3] : ''}`);
  }
  return '';
}

// ── Helpers shared by parsers ───────────────────────────────────────────────
function mentionedUserIds(text) {
  const ids = new Set();
  for (const m of text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g)) ids.add(m[1]);
  return [...ids];
}
function firstPromoMentionName(text) {
  const ids = mentionedUserIds(text);
  for (const id of ids) {
    if (SLACK_USER_MAP[id]) return SLACK_USER_MAP[id];
  }
  return { name: '', email: '' };
}
function getDeadlineFromLines(lines) {
  const dlLine = lines.find(l => /deadline\s*[:=]/i.test(l));
  if (!dlLine) return '';
  return dlLine.replace(/.*deadline\s*[:=]\s*/i, '').trim();
}

// ── Parser: #ba-promo banner upload ─────────────────────────────────────────
function parseBanner(msg) {
  const text = msg.text || '';
  if (!/task\s*:/i.test(text)) return [];
  if (!/banner|upload|B\d+/i.test(text)) return [];

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const taskLine = lines.find(l => /^task\s*:/i.test(l));
  const campaign = taskLine ? taskLine.replace(/^task\s*:\s*/i, '').trim() : 'Banner Upload';
  const deadline = normalizeDeadline(getDeadlineFromLines(lines));

  const assignLines = lines.filter(l =>
    /^B\d+/i.test(l) && (/@\w+/.test(l) || /<@[A-Z0-9]+/.test(l)));
  if (!assignLines.length) return [];

  return assignLines.map(line => {
    const bidsMatch = line.match(/^(B[\d\-–,\s]+)/i);
    const bids = bidsMatch ? bidsMatch[1].trim().replace(/\s+/g, '') : '';
    const brandsMatch = line.match(/\[([^\]]+)\]/);
    const brands = brandsMatch ? brandsMatch[1].trim() : '';

    let assigneeId = '', assigneeName = '';
    const slackRef = line.match(/<@([A-Z0-9]+)\|([^>]+)>/);
    if (slackRef) { assigneeId = slackRef[1]; assigneeName = slackRef[2]; }
    else { const atRef = line.match(/:?\s*@(\w+)\s*$/); assigneeName = atRef ? atRef[1] : ''; }
    const info = SLACK_USER_MAP[assigneeId] || {};

    return {
      Task_ID:     `BT-${msg.ts}-${bids.replace(/\W/g,'')}`,
      Module:      'Banners',
      Request_Ref: bids,
      Brand:       brands,
      Title:       `[Banner] ${campaign.slice(0, 48)} — ${bids}`,
      Owner:       info.name || assigneeName,
      Submitter:   info.email || '',
      Due_Date:    deadline,
      Posted_At:   new Date(parseFloat(msg.ts) * 1000).toISOString(),
      _ts:         msg.ts,
      _channel:    'ba-promo',
    };
  });
}

// ── Parser: #promotions-team team messages ─────────────────────────────────
// Filter: must mention the subteam OR a known promo team user
function parseTeamMsg(msg) {
  const text = msg.text || '';
  const mentionsSubteam = text.includes(`<!subteam^${PROMO_SUBTEAM_ID}>`);
  const mentionedIds = mentionedUserIds(text);
  const mentionsTeamMember = mentionedIds.some(id => PROMO_TEAM_IDS.has(id));

  if (!mentionsSubteam && !mentionsTeamMember) return [];
  if (text.length < 15) return []; // skip emoji-only or trivial pings

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const deadline = normalizeDeadline(getDeadlineFromLines(lines));

  // Skip chatter: question-only messages with no deadline and no actionable verb
  const firstNonMention = lines[0]?.replace(/<[^>]+>/g, '').trim() || '';
  const looksLikeQuestion = /\?\s*$/.test(firstNonMention) && firstNonMention.length < 80;
  const hasActionVerb = /\b(help|please|kindly|update|amend|review|create|add|fix|do|prepare|translate|upload|deploy|submit|qc|verify|monitor|delegate|brief|join|need)\b/i.test(text);
  if (looksLikeQuestion && !deadline && !hasActionVerb) return [];

  // Title: first non-empty line, stripped of <@...> mentions and <!subteam>
  let title = (lines[0] || text)
    .replace(/<!subteam\^[A-Z0-9]+>/g, '')
    .replace(/<@[A-Z0-9]+(?:\|[^>]+)?>/g, '')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
  if (title.length > 80) title = title.slice(0, 77) + '…';
  if (!title) title = '[Slack message]';

  // Owner: first promo-team member mentioned, else "team"
  const owner = firstPromoMentionName(text);

  // Module heuristic
  let module = 'General';
  if (/translation request|translate/i.test(text)) module = 'Translation';
  else if (/banner/i.test(text))                   module = 'Banners';
  else if (/promo code|FC\d|RN\d|P\d{3}/i.test(text)) module = 'Promo';
  else if (/UAT|t&c|inbox|template/i.test(text))   module = 'Content';

  return [{
    Task_ID:     `PT-${msg.ts.replace('.','')}`,
    Module:      module,
    Request_Ref: '',
    Brand:       '',
    Title:       title,
    Owner:       owner.name || (mentionsSubteam ? 'team' : ''),
    Submitter:   owner.email || '',
    Due_Date:    deadline,
    Posted_At:   new Date(parseFloat(msg.ts) * 1000).toISOString(),
    _ts:         msg.ts,
    _channel:    'promotions-team',
  }];
}

// ── Status derivation from thread replies ───────────────────────────────────
function deriveStatus(row, replies) {
  const DONE_RE = /\b(done|complete[d]?|uploaded?|finished|fixed|delivered)\b/i;
  for (const r of replies) {
    const text = r.text || '';
    const uid  = r.user || '';
    const uName = (SLACK_USER_MAP[uid]?.name || '').toLowerCase();
    if (DONE_RE.test(text) && (uName === (row.Owner||'').toLowerCase() || PROMO_TEAM_IDS.has(uid))) {
      return 'Done';
    }
  }
  if (replies.some(r => DONE_RE.test(r.text || ''))) return 'Done';
  return 'In Progress';
}

// ── Main ────────────────────────────────────────────────────────────────────
console.log(`\n━━ Slack Task Sync — ${new Date().toISOString()} ━━`);
const channels = Object.entries(CHANNELS).filter(([k]) => !chanFilter || k === chanFilter);
console.log(`Channels: ${channels.map(([_, c]) => '#' + c.name).join(', ')}`);
console.log(`Lookback: ${LOOKBACK} days${DRY_RUN ? ' · DRY-RUN' : ''}\n`);

const oldestTs = ((Date.now() / 1000) - LOOKBACK * 86400).toFixed(6);
const allRows = [];

for (const [_, ch] of channels) {
  process.stdout.write(`#${ch.name}…`);
  const messages = await fetchChannelHistory(ch.id, oldestTs);
  const parsed = messages.flatMap(m => (m.type === 'message' && !m.subtype) ? ch.parser(m) : []);
  console.log(` ${messages.length} msgs → ${parsed.length} task(s)`);

  // Thread-based status derivation
  const tsCache = new Map();
  for (const row of parsed) {
    if (!tsCache.has(row._ts)) tsCache.set(row._ts, await fetchThreadReplies(ch.id, row._ts));
    row.Status = deriveStatus(row, tsCache.get(row._ts));
    row.Source_Link = `https://the-company-team-hub.slack.com/archives/${ch.id}/p${row._ts.replace('.','')}`;
    row.Status_Updated_At = new Date().toISOString();
    allRows.push(row);
  }
}

console.log(`\nTotal task rows from Slack: ${allRows.length}`);
const byStatus = allRows.reduce((a,r) => (a[r.Status]=(a[r.Status]||0)+1, a), {});
console.log(`Status: ${Object.entries(byStatus).map(([k,v]) => `${k}=${v}`).join(' · ')}`);

if (DRY_RUN) {
  console.log('\nDRY-RUN — first 8 rows:');
  console.table(allRows.slice(0, 8).map(r => ({
    Channel: r._channel, Module: r.Module, Title: r.Title.slice(0,40),
    Owner: r.Owner, Due: r.Due_Date, Status: r.Status,
  })));
  process.exit(0);
}

// Write to Task_Master
console.log('\nConnecting to Google Sheets…');
const { client } = await getGoogleAuth();
const { google } = await loadGoogleapis();
const sheets = google.sheets({ version: 'v4', auth: client });

const existRes = await sheets.spreadsheets.values.get({
  spreadsheetId: CONTROL_LAYER_ID,
  range: `'${TASK_MASTER_TAB}'!A1:Z`,
});
const existing = existRes.data.values || [];
const tHeaders = (existing[0] || []).map(String);
const idCol = tHeaders.indexOf('Task_ID');
const existingIds = new Set(existing.slice(1).map(r => String(r[idCol] || '')));

const valueFor = (r, h) => {
  if (h === 'Task_ID')      return r.Task_ID;
  if (h === 'Module')       return r.Module;
  if (h === 'Request_Ref')  return r.Request_Ref || '';
  if (h === 'Brand')        return r.Brand || '';
  if (h === 'Submitter')    return r.Submitter || '';
  if (h === 'Submitted_At') return r.Posted_At;
  if (h === 'Title')        return r.Title;
  if (h === 'Source_Link')  return r.Source_Link;
  if (h === 'SOP_Ref')      return r._channel === 'ba-promo' ? 'SOP-Banner-Upload' : '';
  if (h === 'Priority')     return 'Normal';
  if (h === 'Due_Date')     return r.Due_Date || '';
  if (h === 'Deadline')     return r.Due_Date || '';   // legacy column tolerance
  if (h === 'Owner')        return r.Owner || '';
  if (h === 'Status')       return r.Status || '';
  if (h === 'Status_Updated_At') return r.Status_Updated_At;
  if (h === 'Notes')        return `From #${r._channel}`;
  return '';
};

// Append new rows
const newRows = allRows.filter(r => !existingIds.has(r.Task_ID));
if (newRows.length) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: CONTROL_LAYER_ID,
    range: `'${TASK_MASTER_TAB}'!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: newRows.map(r => tHeaders.map(h => valueFor(r, h))) },
  });
  console.log(`✓ ${newRows.length} new task(s) appended`);
} else {
  console.log('  No new tasks to append (all already tracked).');
}

// Update Status + Due_Date for existing
const statusCol = tHeaders.indexOf('Status');
const dueCol    = tHeaders.indexOf('Due_Date');
const updCol    = tHeaders.indexOf('Status_Updated_At');
const updates = [];
for (let i = 1; i < existing.length; i++) {
  const id = String(existing[i][idCol] || '');
  const fresh = allRows.find(r => r.Task_ID === id);
  if (!fresh) continue;
  const rowNum = i + 1;
  const col = c => String.fromCharCode(65 + c);
  if (statusCol >= 0) updates.push({ range: `'${TASK_MASTER_TAB}'!${col(statusCol)}${rowNum}`, values: [[fresh.Status]] });
  if (dueCol    >= 0 && fresh.Due_Date) updates.push({ range: `'${TASK_MASTER_TAB}'!${col(dueCol)}${rowNum}`, values: [[fresh.Due_Date]] });
  if (updCol    >= 0) updates.push({ range: `'${TASK_MASTER_TAB}'!${col(updCol)}${rowNum}`, values: [[fresh.Status_Updated_At]] });
}
if (updates.length) {
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: CONTROL_LAYER_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data: updates },
  });
  console.log(`✓ Refreshed ${updates.length/3} existing row(s)`);
}

// Ensure Due_Date column displays as yyyy-mm-dd
if (dueCol >= 0) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: CONTROL_LAYER_ID, fields: 'sheets(properties(sheetId,title,gridProperties))' });
  const sh = meta.data.sheets.find(s => s.properties.title === TASK_MASTER_TAB);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: CONTROL_LAYER_ID,
    requestBody: { requests: [{
      repeatCell: {
        range: { sheetId: sh.properties.sheetId, startRowIndex: 1, endRowIndex: sh.properties.gridProperties.rowCount, startColumnIndex: dueCol, endColumnIndex: dueCol + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    }] },
  });
}

console.log(`\nSheet: https://docs.google.com/spreadsheets/d/${CONTROL_LAYER_ID}`);
console.log('Done.\n');
