/**
 * Reads the Jul 2026 tab, drops noise rows, re-categorizes, renumbers,
 * and rewrites the data range. Does NOT touch the header or formatting.
 *
 * Usage: node bin/rewrite-tracker.mjs [--dry-run]
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const CLIENT_FILE    = path.join(ROOT, 'google-oauth-client.local.json');
const TOKEN_FILE     = path.join(ROOT, 'google-oauth-token.local.json');
const SPREADSHEET_ID = '1dZ4r-mUjRFfITCVwlMU2oeH6xIUGSZO2J1fJyiYg2SQ';
const TAB_NAME       = 'Jul 2026';

const dryRun = process.argv.includes('--dry-run');

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

// ── Auth ──────────────────────────────────────────────────────────────────────
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

// ── Row filter (stateful — call via filterRows()) ────────────────────────────
// Cols: [0]=Date [1]=Seq [2]=Topic [3]=Category [4]=ActionItem
//       [5]=Assignee [6]=Priority [7]=DueDate [8]=Status [9]=Source
//       [10]=SourceLink [11]=Remarks

const MY_NAME_RX   = /jascinta/i;
const HEADER_RX    = /^[\w\s.]+\*{0,2}$/;   // short name-only lines (with optional **)

function filterRows(rows) {
  const kept = [];
  let inMySection = true; // default true for sources with no section structure

  for (const row of rows) {
    const src  = (row[9] || '').trim();
    const text = (row[4] || '').trim();
    if (!text) continue;

    // ── Telegram: drop everything (old filter was too loose) ────────────────
    if (src === 'Telegram') continue;

    // ── Meeting: track person-section state ─────────────────────────────────
    if (src === 'Meeting') {
      // Is this a section header line? (short, name-like, possible trailing **)
      const isHeader = HEADER_RX.test(text.replace(/\*\*/g,'').trim()) && text.length < 50
                       && !/\b(and|the|to|for|with|from|by|using|via)\b/i.test(text);
      if (isHeader) {
        inMySection = MY_NAME_RX.test(text);
        continue; // never emit headers
      }
      if (!inMySection) continue; // skip other people's tasks
      kept.push(row);
      continue;
    }

    // ── Slack: keep only Jascinta-specific tasks ─────────────────────────────
    if (src === 'Slack') {
      // Drop rows where another named person is the actor, not Jascinta
      if (/\b(gaby|kasturi|wen|ryan|bangun|alysa|eugene)\b.{0,30}\b(to |will |monitor|confirms?)\b/i.test(text)) continue;
      // Drop pure team-broadcast rows
      if (/^team\s+(submits|verify|verifi)/i.test(text)) continue;
      // Drop team-policy items with no personal assignee
      if (/stop simultaneous|kasturi and wen|smartico strategy session — ryan/i.test(text)) continue;
      kept.push(row);
      continue;
    }

    // Keep any other source (manual, etc.)
    kept.push(row);
  }

  return kept;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const auth   = getSheetsAuth();
const sheets = google.sheets({ version: 'v4', auth });

// 1. Read current data (skip row 0 = header)
const getRes = await sheets.spreadsheets.values.get({
  spreadsheetId: SPREADSHEET_ID,
  range: `${TAB_NAME}!A:L`,
});
const allRows = getRes.data.values || [];
const header  = allRows[0];
const dataRows = allRows.slice(1); // rows 1..n (0-indexed in the array)

console.log(`Read ${dataRows.length} data rows`);

// 2. Filter
const kept = filterRows(dataRows);
console.log(`Keeping ${kept.length} rows (dropped ${dataRows.length - kept.length})`);

// 2b. Deduplicate by normalised action item text (keep first occurrence)
const seenText = new Set();
const deduped  = kept.filter(row => {
  const key = (row[4] || '').trim()
    .replace(/\s*\(\d+:\d+(?::\d+)?\)\s*$/, '')  // strip trailing timestamps
    .toLowerCase().replace(/\s+/g,' ').slice(0, 120);
  if (seenText.has(key)) return false;
  seenText.add(key);
  return true;
});
console.log(`After dedup: ${deduped.length} rows (removed ${kept.length - deduped.length} duplicates)`);

// 3. Re-number + re-categorize
const cleaned = deduped.map((row, i) => {
  const text     = (row[4] || '').trim();
  const category = inferCategory(text);
  return [
    row[0] || '',          // A: Date
    String(i + 1),         // B: Seq (renumbered)
    row[2] || '',          // C: Topic
    category,              // D: Category (re-inferred)
    text,                  // E: Action Item
    row[5] || 'Jascinta',  // F: Assignee
    row[6] || '',          // G: Priority
    row[7] || '',          // H: Due Date
    row[8] || 'Pending',   // I: Status
    row[9] || '',          // J: Source
    row[10] || '',         // K: Source Link
    row[11] || '',         // L: Remarks
  ];
});

if (dryRun) {
  console.log('\n── Rows to write ──');
  cleaned.forEach((r, i) => console.log(`[${i+1}] ${r[3].padEnd(12)} | ${r[9].padEnd(9)} | ${r[4].slice(0,80)}`));
  process.exit(0);
}

// 4. Clear existing data rows (A2 downward) then write cleaned rows
await sheets.spreadsheets.values.clear({
  spreadsheetId: SPREADSHEET_ID,
  range: `${TAB_NAME}!A2:L1000`,
});

if (cleaned.length > 0) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB_NAME}!A2`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: cleaned },
  });
}

console.log(`✓ Rewrote ${cleaned.length} clean rows to "${TAB_NAME}"`);
