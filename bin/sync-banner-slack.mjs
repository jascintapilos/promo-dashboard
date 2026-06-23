#!/usr/bin/env node
/**
 * sync-banner-slack.mjs
 *
 * Reads banner task assignment messages from #ba-promo (C07KKVD1GTE),
 * parses assignee → B-ID blocks, checks thread replies for completion status,
 * and writes results to:
 *   • Banner_Tasks tab  in PromoOps_Control_Layer sheet
 *   • Task_Master tab   auto-creates one task per in-progress assignment
 *
 * Message format detected (posted by Alysa / Jascinta):
 *   Task: Banner Upload for [Campaign Name]
 *   Deadline: 21/5
 *   [Banner Schedule link]
 *
 *   B22-B25 [WS1, WS2, QPRO1]: @Alysa
 *   B26-B30 [QPRO2-6]: <@U09LNJ8AJ6P|Elyssa>
 *   ...
 *
 * Usage:
 *   SLACK_TOKEN=xoxb-... node bin/sync-banner-slack.mjs
 *   SLACK_TOKEN=xoxb-... node bin/sync-banner-slack.mjs --dry-run
 *   SLACK_TOKEN=xoxb-... node bin/sync-banner-slack.mjs --days=14
 *
 * Prerequisites:
 *   SLACK_TOKEN  env var — Slack bot token (xoxb-) or user token (xoxp-)
 *                          Scopes needed: channels:history, channels:read
 *   Google OAuth token  — run once: node bin/sheets-oauth.mjs
 */

import { getGoogleAuth, loadGoogleapis } from '../src/google-auth.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

// ── Constants ────────────────────────────────────────────────────────────────
const BA_PROMO_CHANNEL = 'C07KKVD1GTE';
const CONTROL_LAYER_ID = '16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk';
const BANNER_TASKS_TAB = 'Banner_Tasks';
const TASK_MASTER_TAB  = 'Task_Master';
const DASHBOARD_URL    = 'https://script.google.com/a/macros/thebrandingpeople.co/s/AKfycbx-Hy_OFd55Fbwdsf29LQxh0NxSLWwXWbVsEQ6AFoecWGgANAtsohO88pSJoCHCuHawzQ/exec';

// Known Slack user ID → display name + email
const SLACK_USER_MAP = {
  U097Q9DTK29: { name: 'Jascinta',  email: 'jascintapilos@thebrandingpeople.co' },
  U03PNM6HZ5F: { name: 'Wai Yip',   email: 'waiyip@thebrandingpeople.co' },
  U09R45VQTS4: { name: 'Alysa',     email: '' },
  U0AGCJTPZ9T: { name: 'Wen',       email: '' },
  U09LNJ8AJ6P: { name: 'Elyssa',    email: '' },
  U0B188FCFB5: { name: 'Diandra',   email: '' },
  U0AUBNBB9DK: { name: 'Gaby',      email: '' },
};

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN  = args.includes('--dry-run');
const daysArg  = args.find(a => a.startsWith('--days='));
const LOOKBACK = daysArg ? Math.max(1, parseInt(daysArg.split('=')[1]) || 30) : 30;

// Load token: env var takes precedence, then slack-token.local.json
let SLACK_TOKEN = process.env.SLACK_TOKEN;
if (!SLACK_TOKEN) {
  try {
    const __dir = dirname(fileURLToPath(import.meta.url));
    const cfg = JSON.parse(readFileSync(join(__dir, '..', 'slack-token.local.json'), 'utf8'));
    SLACK_TOKEN = cfg.token;
  } catch (_) { /* file absent — will error below */ }
}
if (!SLACK_TOKEN) {
  console.error('Error: SLACK_TOKEN not set and slack-token.local.json not found.');
  console.error('  Provide a Slack bot token with groups:history scope.');
  console.error('  Set it: $env:SLACK_TOKEN="xoxb-..."   (PowerShell)');
  console.error('  Or create slack-token.local.json: {"token":"xoxb-..."}');
  process.exit(1);
}

// ── Slack API helpers ─────────────────────────────────────────────────────────
async function slackGet(method, params = {}) {
  const url = new URL(`https://slack.com/api/${method}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url.toString(), {
    headers: { Authorization: 'Bearer ' + SLACK_TOKEN },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from Slack ${method}`);
  const json = await res.json();
  if (!json.ok) throw new Error(`Slack ${method} error: ${json.error}`);
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
    return (data.messages || []).slice(1); // skip parent
  } catch (_) {
    return [];
  }
}

// ── Date helper ──────────────────────────────────────────────────────────────
// Convert Slack-style "21/5" → ISO "2026-05-21". Picks current year; if the
// resulting date is in the past by > 30 days assume next year.
function normalizeDeadline(raw) {
  if (!raw) return '';
  const m = String(raw).match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return raw;
  const day = parseInt(m[1], 10);
  const mon = parseInt(m[2], 10);
  let year = m[3] ? parseInt(m[3], 10) : new Date().getUTCFullYear();
  if (year < 100) year += 2000;
  const iso = `${year}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const today = new Date();
  const dt = new Date(iso + 'T00:00:00Z');
  if ((today - dt) / 86400000 > 180) {
    return `${year+1}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  return iso;
}

// ── Message parser ────────────────────────────────────────────────────────────
function parseBannerTaskMessage(msg) {
  const text = msg.text || '';

  // Must have "Task:" keyword + a B-number reference or "banner"/"upload"
  if (!/task\s*:/i.test(text)) return null;
  if (!/banner|upload|B\d+/i.test(text)) return null;

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Campaign name from "Task: Banner Upload for [name]"
  const taskLine = lines.find(l => /^task\s*:/i.test(l));
  const campaign = taskLine ? taskLine.replace(/^task\s*:\s*/i, '').trim() : 'Banner Upload';

  // Deadline from "Deadline: 21/5"
  const dlLine  = lines.find(l => /^deadline\s*:/i.test(l));
  const deadline = dlLine ? dlLine.replace(/^deadline\s*:\s*/i, '').trim() : '';

  // Assignment lines: must start with B-number(s) and contain a colon + mention
  // Examples:
  //   "B22-B25 [WS1, WS2, QPRO1]: @Alysa"
  //   "B26-B30 [QPRO2-6]: <@U09LNJ8AJ6P|Elyssa>"
  //   "B31-B34  [QPRO7-10]: <@U0B188FCFB5|Diandra>"
  const assignLines = lines.filter(l =>
    /^B\d+/i.test(l) && (/@\w+/.test(l) || /<@[A-Z0-9]+/.test(l))
  );
  if (!assignLines.length) return null;

  const assignments = assignLines.map(line => {
    // B-ID range: everything up to '[' or ':'
    const bidsMatch = line.match(/^(B[\d\-–,\s]+)/i);
    const bids = bidsMatch ? bidsMatch[1].trim().replace(/\s+/g, '') : '';

    // Brands: [WS1, WS2, QPRO1]
    const brandsMatch = line.match(/\[([^\]]+)\]/);
    const brands = brandsMatch ? brandsMatch[1].trim() : '';

    // Assignee: prefer "<@USERID|name>" over "@name"
    let assigneeId = '', assigneeName = '';
    const slackRef = line.match(/<@([A-Z0-9]+)\|([^>]+)>/);
    if (slackRef) {
      assigneeId   = slackRef[1];
      assigneeName = slackRef[2];
    } else {
      const atRef = line.match(/:?\s*@(\w+)\s*$/);
      assigneeName = atRef ? atRef[1] : '';
    }
    const info = SLACK_USER_MAP[assigneeId] || {};
    return {
      bids,
      brands,
      assigneeId,
      assigneeName: info.name || assigneeName,
      assigneeEmail: info.email || '',
    };
  });

  return {
    campaign,
    deadline,
    assignments,
    slack_ts:  msg.ts,
    posted_by: msg.user || '',
    posted_at: new Date(parseFloat(msg.ts) * 1000).toISOString(),
  };
}

// Infer per-assignee status from thread replies
function deriveStatus(assigneeName, assigneeId, replies) {
  const DONE_RE    = /\b(done|complete[d]?|uploaded?|finished)\b/i;
  const GOOD_RE    = /all good|lgtm|looks? good|qc.*ok|approved/i;

  for (const r of replies) {
    const text  = r.text || '';
    const uid   = r.user || '';
    const uInfo = SLACK_USER_MAP[uid];
    const uName = (uInfo?.name || '').toLowerCase();
    const isSelf = uid === assigneeId || uName === assigneeName.toLowerCase();

    if (isSelf && DONE_RE.test(text)) return 'Done';
    if (!isSelf && GOOD_RE.test(text) && replies.some(prev =>
      prev.user === assigneeId && DONE_RE.test(prev.text||''))) return 'Done';
  }
  // Fallback: any "done" in thread = likely done
  if (replies.some(r => DONE_RE.test(r.text || ''))) return 'Done';
  return 'In Progress';
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`\n━━ Banner Slack Sync — ${new Date().toISOString()} ━━`);
console.log(`Channel : #ba-promo (${BA_PROMO_CHANNEL})`);
console.log(`Lookback: ${LOOKBACK} days`);
if (DRY_RUN) console.log('Mode    : DRY-RUN (no sheet write)');
console.log('');

// 1. Fetch channel messages
const oldestTs = ((Date.now() / 1000) - LOOKBACK * 86400).toFixed(6);
process.stdout.write('Fetching #ba-promo history…');
const messages = await fetchChannelHistory(BA_PROMO_CHANNEL, oldestTs);
console.log(` ${messages.length} messages`);

// 2. Parse banner task messages
const taskMsgs = messages
  .filter(m => m.type === 'message' && !m.subtype)
  .map(parseBannerTaskMessage)
  .filter(Boolean);

console.log(`Banner task messages: ${taskMsgs.length}`);
if (!taskMsgs.length) {
  console.log('\nNo banner task messages found in the lookback window.');
  console.log(`Tip: try --days=60 to extend the search period.`);
  process.exit(0);
}

// 3. Fetch thread replies per task to determine status
console.log('\nFetching thread replies…');
const rows = [];
for (const task of taskMsgs) {
  const replies = await fetchThreadReplies(BA_PROMO_CHANNEL, task.slack_ts);
  for (const a of task.assignments) {
    const status = deriveStatus(a.assigneeName, a.assigneeId, replies);
    const taskId = `BT-${task.slack_ts}-${a.bids.replace(/\W/g, '')}`;
    rows.push({
      Task_ID:        taskId,
      Campaign:       task.campaign,
      Deadline:       normalizeDeadline(task.deadline),
      Slack_TS:       task.slack_ts,
      Channel:        BA_PROMO_CHANNEL,
      B_IDs:          a.bids,
      Brands:         a.brands,
      Assignee_Name:  a.assigneeName,
      Assignee_Email: a.assigneeEmail,
      Assignee_ID:    a.assigneeId,
      Status:         status,
      Posted_At:      task.posted_at,
      Synced_At:      new Date().toISOString(),
    });
    const doneFlag = status === 'Done' ? '✓' : '⏳';
    console.log(`  ${doneFlag} [${task.campaign.slice(0, 22).padEnd(22)}] ${a.bids.padEnd(14)} → ${a.assigneeName.padEnd(10)} [${status}]`);
  }
}

console.log(`\nTotal assignment rows: ${rows.length}`);
const doneCount = rows.filter(r => r.Status === 'Done').length;
console.log(`Status: ${doneCount} done · ${rows.length - doneCount} in progress`);

if (DRY_RUN) {
  console.log('\nDRY-RUN — rows that would be written:');
  console.table(rows.map(r => ({
    Campaign: r.Campaign.slice(0, 28), B_IDs: r.B_IDs,
    Assignee: r.Assignee_Name, Status: r.Status, Deadline: r.Deadline,
  })));
  process.exit(0);
}

// 4. Connect to Google Sheets
console.log('\nConnecting to Google Sheets…');
let sheetsApi;
try {
  const { client, email, mode } = await getGoogleAuth();
  const { google } = await loadGoogleapis();
  sheetsApi = google.sheets({ version: 'v4', auth: client });
  console.log(`  Auth: ${mode}  email: ${email || '(unknown)'}`);
} catch (e) {
  console.error('Auth failed:', e.message);
  console.error('  Run: node bin/sheets-oauth.mjs   to refresh the OAuth token.');
  process.exit(1);
}

// 5. Ensure Banner_Tasks tab
const meta = await sheetsApi.spreadsheets.get({
  spreadsheetId: CONTROL_LAYER_ID,
  fields: 'sheets.properties(title)',
});
const sheetTitles = (meta.data.sheets || []).map(s => s.properties.title);

if (!sheetTitles.includes(BANNER_TASKS_TAB)) {
  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: CONTROL_LAYER_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: BANNER_TASKS_TAB } } }] },
  });
  console.log(`  Created tab: ${BANNER_TASKS_TAB}`);
}

// 6. Write Banner_Tasks (full replace — idempotent, deduped by Task_ID)
const HEADERS = [
  'Task_ID', 'Campaign', 'Deadline', 'Slack_TS', 'Channel',
  'B_IDs', 'Brands', 'Assignee_Name', 'Assignee_Email', 'Assignee_ID',
  'Status', 'Posted_At', 'Synced_At',
];
const values = [HEADERS, ...rows.map(r => HEADERS.map(h => r[h] ?? ''))];
await sheetsApi.spreadsheets.values.update({
  spreadsheetId: CONTROL_LAYER_ID,
  range: `'${BANNER_TASKS_TAB}'!A1`,
  valueInputOption: 'USER_ENTERED',
  requestBody: { values },
});
console.log(`✓ ${rows.length} rows written to ${BANNER_TASKS_TAB}`);

// 7. Push banner tasks into Task_Master so they show in the dashboard.
//    All statuses are propagated (Done + In Progress). Idempotent by Task_ID.
if (sheetTitles.includes(TASK_MASTER_TAB)) {
  const existRes = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: CONTROL_LAYER_ID,
    range: `'${TASK_MASTER_TAB}'!A1:Z`,
  });
  const existing = existRes.data.values || [];
  const tHeaders = (existing[0] || []).map(String);
  const idCol = tHeaders.indexOf('Task_ID');
  const existingIds = new Set(existing.slice(1).map(r => String(r[idCol] || '')));

  // Map banner row → Task_Master row using the sheet's real header names
  const valueForHeader = (r, h) => {
    switch (h) {
      case 'Task_ID':            return r.Task_ID;
      case 'Module':             return 'Banners';
      case 'Request_Ref':        return r.B_IDs;
      case 'Brand':              return r.Brands;
      case 'Submitter':          return r.Assignee_Email || r.Assignee_Name;
      case 'Submitted_At':       return r.Posted_At;
      case 'Title':              return `[Banner] ${r.Campaign.slice(0, 48)} — ${r.B_IDs}`;
      case 'Source_Link':        return `https://the-company-team-hub.slack.com/archives/${r.Channel}/p${String(r.Slack_TS).replace('.', '')}`;
      case 'SOP_Ref':            return 'SOP-Banner-Upload';
      case 'Priority':           return 'Normal';
      case 'Deadline':           return r.Deadline || '';
      case 'Due_Date':           return r.Deadline || '';   // dashboard reads this key
      case 'Owner':              return r.Assignee_Name;
      case 'Status':             return r.Status;          // 'Done' or 'In Progress'
      case 'Status_Updated_At':  return r.Synced_At;
      case 'Notes':              return `Campaign: ${r.Campaign} · Brands: ${r.Brands}`;
      default:                   return '';
    }
  };

  const newTaskRows = rows
    .filter(r => !existingIds.has(r.Task_ID))
    .map(r => tHeaders.map(h => valueForHeader(r, h)));

  if (newTaskRows.length) {
    await sheetsApi.spreadsheets.values.append({
      spreadsheetId: CONTROL_LAYER_ID,
      range: `'${TASK_MASTER_TAB}'!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: newTaskRows },
    });
    console.log(`✓ ${newTaskRows.length} new task(s) added to ${TASK_MASTER_TAB}`);
  } else {
    console.log('  Task_Master: no new tasks (all already tracked)');
  }

  // Update Status + Deadline for rows already in Task_Master (in case status changed)
  if (idCol >= 0 && existing.length > 1) {
    const statusCol  = tHeaders.indexOf('Status');
    const deadCol    = tHeaders.indexOf('Due_Date') >= 0 ? tHeaders.indexOf('Due_Date') : tHeaders.indexOf('Deadline');
    const updCol     = tHeaders.indexOf('Status_Updated_At');
    const updates = [];
    for (let i = 1; i < existing.length; i++) {
      const id = String(existing[i][idCol] || '');
      const banner = rows.find(r => r.Task_ID === id);
      if (!banner) continue;
      const rowNum = i + 1; // 1-based + header
      if (statusCol >= 0) updates.push({ range: `'${TASK_MASTER_TAB}'!${String.fromCharCode(65 + statusCol)}${rowNum}`, values: [[banner.Status]] });
      if (deadCol   >= 0) updates.push({ range: `'${TASK_MASTER_TAB}'!${String.fromCharCode(65 + deadCol)}${rowNum}`,   values: [[banner.Deadline]] });
      if (updCol    >= 0) updates.push({ range: `'${TASK_MASTER_TAB}'!${String.fromCharCode(65 + updCol)}${rowNum}`,    values: [[banner.Synced_At]] });
    }
    if (updates.length) {
      await sheetsApi.spreadsheets.values.batchUpdate({
        spreadsheetId: CONTROL_LAYER_ID,
        requestBody: { valueInputOption: 'USER_ENTERED', data: updates },
      });
      console.log(`✓ Refreshed ${updates.length / 3} existing Task_Master row(s)`);
    }
  }
}

console.log(`\nSheet: https://docs.google.com/spreadsheets/d/${CONTROL_LAYER_ID}`);
console.log('Done.\n');
