/**
 * Pulls action items from Fireflies.ai meeting summaries and appends them
 * to the current month's tab in the Action Item Tracker.
 *
 * Usage: node bin/fireflies-capture.mjs [--hours N] [--dry-run]
 *   --hours N    look back N hours (default 48)
 *   --dry-run    print matches without writing to sheet
 *
 * Config: fireflies-config.local.json  { "api_key": "..." }
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const FF_CONFIG   = path.join(ROOT, 'fireflies-config.local.json');
const SEEN_FILE   = path.join(ROOT, 'logs', 'fireflies-seen-ids.json');
const LOG_FILE    = path.join(ROOT, 'logs', 'fireflies-capture.log');
const CLIENT_FILE = path.join(ROOT, 'google-oauth-client.local.json');
const TOKEN_FILE  = path.join(ROOT, 'google-oauth-token.local.json');

const SPREADSHEET_ID = '1dZ4r-mUjRFfITCVwlMU2oeH6xIUGSZO2J1fJyiYg2SQ';
const MONTH_NAMES    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const FF_ENDPOINT    = 'https://api.fireflies.ai/graphql';

// ── CLI args ──────────────────────────────────────────────────────────────────
const args         = process.argv.slice(2);
const dryRun       = args.includes('--dry-run');
const hoursArg     = args[args.indexOf('--hours') + 1];
const LOOKBACK_HRS = hoursArg ? parseInt(hoursArg) : 48;

// ── Category inference (shared) ───────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────────
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
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...set].slice(-5000)));
}

function fmtDate(ts) {
  const d = new Date(ts);
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

// ── Fireflies GraphQL ─────────────────────────────────────────────────────────
async function fetchTranscripts(apiKey, fromDate) {
  const query = `
    query Transcripts($fromDate: DateTime) {
      transcripts(fromDate: $fromDate) {
        id
        title
        date
        organizer_email
        summary {
          action_items
          keywords
          overview
        }
        sentences {
          speaker_name
          text
        }
      }
    }
  `;

  const res = await fetch(FF_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, variables: { fromDate: fromDate.toISOString() } }),
  });

  if (!res.ok) throw new Error(`Fireflies API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json.data.transcripts || [];
}

// ── Main ──────────────────────────────────────────────────────────────────────
log(`Starting Fireflies capture — lookback ${LOOKBACK_HRS}h${dryRun ? ' [DRY RUN]' : ''}`);

if (!fs.existsSync(FF_CONFIG)) {
  console.error(`\nMissing ${FF_CONFIG}`);
  console.error('Create it:');
  console.error(JSON.stringify({ api_key: 'YOUR_FIREFLIES_API_KEY' }, null, 2));
  console.error('\nGet your API key at: https://app.fireflies.ai/account → Integrations → API');
  process.exit(1);
}

const { api_key } = JSON.parse(fs.readFileSync(FF_CONFIG, 'utf8'));
if (!api_key || api_key === 'YOUR_FIREFLIES_API_KEY') {
  console.error('Set your Fireflies API key in fireflies-config.local.json');
  process.exit(1);
}

const fromDate = new Date(Date.now() - LOOKBACK_HRS * 3600 * 1000);
const seen     = loadSeen();
const found    = [];

log(`Fetching transcripts since ${fromDate.toISOString()}`);
const transcripts = await fetchTranscripts(api_key, fromDate);
log(`Got ${transcripts.length} transcript(s)`);

for (const t of transcripts) {
  if (seen.has(t.id)) { log(`  Skip (seen): ${t.title}`); continue; }

  const raw = t.summary?.action_items;
  if (!raw || (typeof raw === 'string' ? raw.trim().length === 0 : raw.length === 0)) {
    log(`  No action items: ${t.title}`);
    seen.add(t.id);
    continue;
  }

  // Parse person-section structure. Fireflies formats action_items as:
  //   Jascinta Pilos**\n- task 1\n- task 2\n\nKan Wai Yip**\n- task 3
  // We only keep items under the Jascinta section.
  const MY_NAME_RX = /jascinta/i;
  // A "person header" line: just a name (possibly trailing **)
  const HEADER_RX  = /^[\w\s]+\*{0,2}$|^\*\*[\w\s]+\*\*$/;

  let inMySection = false;
  const items = [];

  const lines = Array.isArray(raw) ? raw : raw.split(/\n/);
  for (const line of lines) {
    const stripped = line.replace(/^[-•*\d.]+\s*/, '').replace(/\*\*/g, '').trim();
    if (!stripped) continue;

    // Detect a person-header line: short, no verb, matches name pattern
    if (HEADER_RX.test(stripped) && stripped.length < 60 && !/\b(and|the|to|for|with|from|by)\b/i.test(stripped)) {
      inMySection = MY_NAME_RX.test(stripped);
      continue;
    }

    if (!inMySection) continue;

    // Strip trailing timestamp like "(12:34)" or "(1:23:45)"
    const clean = stripped.replace(/\s*\(\d+:\d+(?::\d+)?\)\s*$/, '').trim();
    // Skip noise: too short, or just a name fragment
    if (clean.length < 10 || /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(clean)) continue;

    items.push(clean);
  }

  // Fallback: if structured parsing found nothing (no person headers), grab all items that mention Jascinta
  if (items.length === 0) {
    const allLines = lines.map(l => l.replace(/^[-•*\d.]+\s*/, '').replace(/\*\*/g, '').trim()).filter(l => l.length > 9);
    const mentioned = allLines.filter(l => MY_NAME_RX.test(l));
    items.push(...mentioned);
  }

  if (items.length === 0) {
    log(`  No items assigned to Jascinta: ${t.title}`);
    seen.add(t.id);
    continue;
  }

  log(`  ${t.title}: ${items.length} item(s) for Jascinta`);
  const dateStr = fmtDate(t.date);

  items.forEach(item => {
    found.push({
      transcriptId: t.id,
      date: dateStr,
      topic: t.title || 'Meeting',
      category: inferCategory(item),
      actionItem: item.slice(0, 300),
      assignee: 'Jascinta',
      priority: '',
      dueDate: '',
      status: 'Pending',
      source: 'Meeting',
      sourceLink: `https://app.fireflies.ai/view/${t.id}`,
      remarks: `Fireflies: ${t.title}`,
    });
  });

  seen.add(t.id);
}

log(`Found ${found.length} new action item row(s)`);

if (found.length === 0) { log('Nothing to write.'); process.exit(0); }

if (dryRun) {
  found.forEach((r, i) => console.log(`\n[${i + 1}] ${r.date} | ${r.topic}\n  ${r.actionItem}`));
  process.exit(0);
}

// ── Append to sheet ───────────────────────────────────────────────────────────
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

saveSeen(seen);
log(`✓ Appended ${found.length} rows to "${tabName}"`);
