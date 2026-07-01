#!/usr/bin/env node
/**
 * Pull YTD FastTrack CRM segments (via Activities) into the Weekly Report
 * 'CRM Assignment Log' tab, appended after Smartico rows.
 *
 * Source: ActivityManager/Activities/GetActivities (signed in current year)
 *         → linked segment name via ByCategory/1 lookup
 *
 * Uses a Google Apps Script relay (same project as dashboard-data.gs) to
 * bypass the Cloudflare IP block on this machine. All FT API calls are made
 * from Google's servers; this script only processes and writes to the sheet.
 *
 * Instances:
 *   ws1    → https://mb8.ft-crm.com       (WS1/WS2 — brand MB8)
 *   qpro1  → https://alpha-iota-qp1.ft-crm.com  (QPRO1)
 *   qp2    → https://alpha-iota-qp2.ft-crm.com/v2 (QP2A–D)
 *
 * Run after pull-smartico-campaigns.mjs (which clears + writes first).
 *
 * Usage:
 *   node bin/pull-ft-campaigns.mjs --instance=ws1
 *   node bin/pull-ft-campaigns.mjs --instance=ws1 --write
 *   node bin/pull-ft-campaigns.mjs --instance=ws1 --write --append
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const INSTANCE = flags.instance || 'ws1';
const WRITE = flags.write === true;
const APPEND = flags.append === true;
const FROM_BROWSER = flags['from-browser-pull'] === true;
const YEAR = new Date().getFullYear();

const TAB = 'CRM Assignment Log';
const OPS_ID = getOpsSheetId();

// GAS relay — web app deployment (Execute as: Me, Access: Anyone, even anonymous).
// Proxies FT CRM API calls from Google's servers, bypassing the Cloudflare IP block.
const GAS_RELAY_URL = 'https://script.google.com/macros/s/AKfycbzRvLCwWLmw7VFSGpHr-lopzprsws3T__CyDoJYYoqfQLDoGTdWVucDCD04orBNj5txpw/exec';

// TBP team — sourced from Directory sheet 'Team Contact Details'.
// FT display names may differ from Smartico/Directory nicknames.
const TBP_TEAM = new Set([
  'Alysa',    // Foong Men Hua — FT ids 125 (old), 141
  'Elyssa',   // Elyssa Mae Cataag — FT ids 95 (old), 142
  'Jascinta', // Jascinta Pilos — FT ids 93 (old), 139
  'Wai Yip',  // Kan Wai Yip — FT id 140
  'WY',       // Kan Wai Yip old account — FT id 76
  'Boon Inn', // Wang Boon Inn (Wen in Smartico) — FT id 157
  'Michelle', // FT id 138 — included for YTD completeness
  'Bangun',   // Bangun Priambodo — FT account not yet observed
  'Gaby',     // Gabrielle Tiffany — FT account not yet observed
  'Gabrielle',
]);

// ── Instance config ───────────────────────────────────────────────────────────

const INSTANCES = {
  ws1:   { label: 'FastTrack WS1', brand: 'WS1' },
  qpro1: { label: 'FastTrack QPRO1', brand: '' },  // brand from activity name
  qp2:   { label: 'FastTrack QP2', brand: '' },
};

if (!INSTANCES[INSTANCE]) {
  console.error(`Unknown instance "${INSTANCE}". Use: ws1 | qpro1 | qp2`);
  process.exit(1);
}

// ── Session loading ────────────────────────────────────────────────────────────

const URLS = { ws1: 'https://mb8.ft-crm.com/', qpro1: 'https://alpha-iota-qp1.ft-crm.com/', qp2: 'https://alpha-iota-qp2.ft-crm.com/v2/' };
function sessionExpiredMsg(inst) {
  return [
    `Session expired for ${inst}. To renew:`,
    `  1. Open ${URLS[inst] || inst} in Chrome and log in`,
    `  2. Press F12 → Application → Cookies → find "portaltoken" → copy the value`,
    `  3. Run: node bin/save-ft-token.mjs --instance=${inst} --token=<paste-value-here>`,
  ].join('\n');
}

let portaltoken = '';
let cookieExp = 0;
if (!FROM_BROWSER) {
  const SESSION_FILE = path.resolve(`ft-session-${INSTANCE}.local.json`);
  if (!existsSync(SESSION_FILE)) {
    console.error(`No session file for "${INSTANCE}". Run: node bin/save-ft-token.mjs --instance=${INSTANCE} --token=<portaltoken>`);
    process.exit(1);
  }
  const session = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
  const portalCookie = session.cookies?.find(c => c.name === 'portaltoken');
  portaltoken = portalCookie?.value || session.token || '';
  if (!portaltoken) { console.error(sessionExpiredMsg(INSTANCE)); process.exit(1); }
  cookieExp = portalCookie?.expires || 0;
  const nowSec = Math.floor(Date.now() / 1000);
  if (cookieExp > 0 && cookieExp < nowSec + 300) { console.error(sessionExpiredMsg(INSTANCE)); process.exit(1); }
}

const modeLabel = INSTANCES[INSTANCE].label;
console.log(`\nFastTrack CRM pull — ${modeLabel} (${INSTANCE})`);
if (!FROM_BROWSER) console.log(`Token expires: ${cookieExp > 0 ? new Date(cookieExp * 1000).toISOString() : 'session cookie'}`);
console.log(`Mode: ${WRITE ? (APPEND ? 'WRITE (append)' : 'WRITE (overwrite FT section)') : 'DRY RUN'}\n`);

// ── GAS relay via web app ─────────────────────────────────────────────────────

async function gasRelayFetch(instance, token) {
  console.log('Calling GAS relay (fetching all FT data via Google servers)…');
  const res = await fetch(GAS_RELAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instance, token }),
  });
  if (!res.ok) throw new Error(`GAS relay HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (data.error) {
    if (data.error.startsWith('CF_BLOCKED')) {
      throw new Error(
        `Cloudflare blocked FT CRM even from GAS — portaltoken may be invalid or expired.\n` +
        sessionExpiredMsg(instance)
      );
    }
    throw new Error(`GAS relay error: ${data.error}`);
  }
  console.log(`  ${(data.users || []).length} users, ${(data.segments || []).length} segments, ${(data.activities || []).length} activities`);
  console.log(`  ${Object.keys(data.changelogs || {}).length} changelogs, ${Object.keys(data.segFilters || {}).length} segment filters`);
  return data;
}

// ── Fetch all data (browser relay or GAS relay) ───────────────────────────────

let raw;
if (FROM_BROWSER) {
  const tmpFile = path.resolve('tmp-ft-browser-pull.json');
  if (!existsSync(tmpFile)) {
    console.error('Missing tmp-ft-browser-pull.json — run pull-ft-via-browser.mjs first.');
    process.exit(1);
  }
  const pulled = JSON.parse(readFileSync(tmpFile, 'utf8'));
  console.log(`Reading browser-pulled data (${pulled.pulledAt})…`);
  console.log(`  ${(pulled.users||[]).length} users, ${(pulled.segments||[]).length} segments, ${(pulled.activities||[]).length} activities`);
  console.log(`  ${Object.keys(pulled.changelogs||{}).length} changelogs, ${Object.keys(pulled.segFilters||{}).length} segment filters`);
  raw = pulled;
} else {
  raw = await gasRelayFetch(INSTANCE, portaltoken);
}

// ── Build lookup maps ─────────────────────────────────────────────────────────

// Deleted/renamed accounts that no longer appear in AdminUsers.
const DELETED_USER_NAMES = {
  71: 'FT Team', // deleted AlphaIota BPO account, identity unknown
};

const userMap = { ...DELETED_USER_NAMES };
(raw.users || []).forEach(u => {
  userMap[u.UserId] = (u.Name || u.Username || '').replace(/\s+/g, ' ').trim();
});
console.log(`\n${Object.keys(userMap).length} users loaded`);

const segMap = {};
(raw.segments || []).forEach(s => { segMap[s.SegmentId] = s.SegmentName; });
console.log(`${Object.keys(segMap).length} segments loaded`);

// ── YTD filter + one-off-only ─────────────────────────────────────────────────
// TriggerTypeId=2: manual one-off blasts (the team's segment sends).
// WS1 doesn't use QA sign-off — use ExecutionDateTime as fallback.

const allActivities = raw.activities || [];
console.log(`${allActivities.length} total activities`);

const ytdAll = allActivities.filter(a => {
  const date = a.SignedDate || a.ExecutionDateTime || '';
  return date.slice(0, 4) === String(YEAR);
});

const trigDist = {};
ytdAll.forEach(a => { trigDist[a.TriggerTypeId] = (trigDist[a.TriggerTypeId] || 0) + 1; });
const distStr = Object.entries(trigDist).map(([id, n]) => `type${id}×${n}`).join(', ');
console.log(`${ytdAll.length} in ${YEAR} — TriggerType breakdown: ${distStr || '(none)'}`);

const ytdActivities = ytdAll.filter(a => a.TriggerTypeId === 2);
const excluded = ytdAll.length - ytdActivities.length;
if (excluded) console.log(`Excluded ${excluded} recurring activities (TriggerTypeId ≠ 2)`);
console.log(`${ytdActivities.length} one-off activities`);

// ── Creator attribution from changelogs ───────────────────────────────────────

const creatorByActId = {};
let clFailCount = 0;
for (const a of ytdActivities) {
  const entries = raw.changelogs?.[String(a.ActivityId)];
  if (!entries) { clFailCount++; continue; }
  const createEntry = [...entries].reverse().find(e => e.operationType === 'create');
  const fallbackEntry = entries[entries.length - 1];
  const creatorEntry = createEntry || fallbackEntry;
  if (creatorEntry?.userId) {
    creatorByActId[a.ActivityId] = userMap[creatorEntry.userId] || DELETED_USER_NAMES[creatorEntry.userId] || `uid:${creatorEntry.userId}`;
  }
}
console.log(`${Object.keys(creatorByActId).length} changelogs resolved`);
if (clFailCount > 0) console.warn(`  ⚠️  ${clFailCount} changelog(s) missing — those rows fall back to SignedBy for creator name.`);

// ── Team filter + dedup ───────────────────────────────────────────────────────

const teamActivities = ytdActivities.filter(a => {
  const creator = creatorByActId[a.ActivityId] || userMap[a.SignedBy];
  return creator && TBP_TEAM.has(creator);
});
console.log(`${teamActivities.length} team-created activities`);

const seenSegmentIds = new Set();
const dedupedActivities = [];
const sortDate = a => (a.SignedDate || a.ExecutionDateTime || '');
for (const a of teamActivities.sort((a, b) => sortDate(b).localeCompare(sortDate(a)))) {
  const key = a.SegmentId || `act_${a.ActivityId}`;
  if (!seenSegmentIds.has(key)) {
    seenSegmentIds.add(key);
    dedupedActivities.push(a);
  }
}
console.log(`${dedupedActivities.length} unique segments after dedup`);

// ── Brand / Region extraction ─────────────────────────────────────────────────

const CURRENCY_TO_REGION = { MYR: 'MY', SGD: 'SG', IDR: 'ID', THB: 'TH', KHR: 'KH' };

function extractRegion(text) {
  const t = (text || '').toUpperCase();
  if (t.includes('MYR') || /\bRM\d/.test(t)) return 'MY';
  if (t.includes('SGD')) return 'SG';
  if (t.includes('IDR')) return 'ID';
  if (/\bMYS?\b/.test(t)) return 'MY';
  if (/\bSGP?\b/.test(t)) return 'SG';
  if (/\bIDN?\b/.test(t)) return 'ID';
  if (/\bTH\b/.test(t)) return 'TH';
  if (/\bKH\b/.test(t)) return 'KH';
  const embedded = t.match(/(?:QP|WS|BP|MB)[0-9A-Z]*(MY|SG|ID|TH|KH)/);
  if (embedded) return embedded[1];
  return '';
}

function extractBrand(actName, segName, instance) {
  const combined = `${actName || ''} ${segName || ''}`;
  if (instance === 'ws1') {
    if (/^WS2\b/i.test((segName || '').trim())) return 'WS2';
    return 'WS1';
  }
  const m = combined.match(/QPRO\s*(\d+)/i);
  if (m) return `QPRO${m[1]}`;
  const m2 = combined.match(/QP2([A-D])?/i);
  if (m2) return m2[1] ? `QP2${m2[1].toUpperCase()}` : 'QP2';
  return INSTANCES[instance]?.brand || instance.toUpperCase();
}

// ── Segment currency fallback (from pre-fetched GAS segFilters) ───────────────

function parseCurrenciesFromFilter(filterJson) {
  const currencies = [];
  try {
    function walk(node) {
      if ((node.field === 'user_details-currency' || node.id === 'user_details-currency') && node.value) {
        const vals = Array.isArray(node.value) ? node.value : [node.value];
        currencies.push(...vals.filter(Boolean));
      }
      if (node.rules) node.rules.forEach(walk);
    }
    walk(JSON.parse(filterJson));
  } catch {}
  return currencies;
}

const segCurrencyMap = {};
for (const [segId, filterJson] of Object.entries(raw.segFilters || {})) {
  if (!filterJson) continue;
  const currencies = parseCurrenciesFromFilter(filterJson);
  if (currencies.length === 1) {
    segCurrencyMap[segId] = CURRENCY_TO_REGION[currencies[0]] || '';
  } else if (currencies.length > 1) {
    const regions = [...new Set(currencies.map(c => CURRENCY_TO_REGION[c]).filter(Boolean))];
    segCurrencyMap[segId] = regions.join('/');
  }
}

// ── Build rows ────────────────────────────────────────────────────────────────

const crmTool = INSTANCES[INSTANCE].label;

const dataRows = dedupedActivities.map(a => {
  const segName = segMap[a.SegmentId] || a.ActivityName || '';
  const creatorName = creatorByActId[a.ActivityId] || userMap[a.SignedBy] || 'FT Team';
  const date = (a.SignedDate || a.ExecutionDateTime || '').slice(0, 10);
  const brand = extractBrand(a.ActivityName, segName, INSTANCE);
  const region = extractRegion(segName) || extractRegion(a.ActivityName) || segCurrencyMap[a.SegmentId] || '';
  return [date, brand, region, crmTool, segName, creatorName];
});

dataRows.sort((a, b) => b[0].localeCompare(a[0]));

const teamRows = dataRows.filter(r => TBP_TEAM.has(r[5]));

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\nRows to write: ${teamRows.length}`);

const byCreator = {};
teamRows.forEach(r => { byCreator[r[5]] = (byCreator[r[5]] || 0) + 1; });
console.log('By creator (YTD):');
Object.entries(byCreator).sort((a, b) => b[1] - a[1]).forEach(([name, n]) =>
  console.log(`  ${String(n).padStart(4)}  ${name}`)
);

if (!WRITE) {
  console.log('\nSample rows (first 5):');
  teamRows.slice(0, 5).forEach(r =>
    console.log(' ', r.map(v => String(v).padEnd(20).slice(0, 20)).join(' | '))
  );
  console.log('\n(DRY RUN — re-run with --write to append to sheet)');
  process.exit(0);
}

// ── Write to sheet ────────────────────────────────────────────────────────────

const { sheets } = await getSheetsClient();

if (teamRows.length === 0) {
  console.log('\nNo team rows to write. Sheet unchanged.');
  process.exit(0);
}

// Guard: verify tab has a header + at least one data row before appending.
// If Smartico crashed after clearing the tab, abort rather than leave a headerless sheet.
try {
  const headerCheck = await sheets.spreadsheets.values.get({
    spreadsheetId: OPS_ID, range: `'${TAB}'!A1:A2`,
  });
  const vals = headerCheck.data.values || [];
  if (!vals[0] || vals[0][0] !== 'Date' || vals.length < 2) {
    console.error(`\n⛔ ABORT: '${TAB}' tab is empty or missing data rows.`);
    console.error(`   Smartico pull may have failed. Re-run pull-smartico-campaigns.mjs --write first.`);
    process.exit(4);
  }
} catch (e) {
  console.warn(`  (Could not verify tab header: ${e.message}; proceeding with append.)`);
}

const appendResp = await sheets.spreadsheets.values.append({
  spreadsheetId: OPS_ID,
  range: `'${TAB}'!A1`,
  valueInputOption: 'RAW',
  insertDataOption: 'INSERT_ROWS',
  requestBody: { values: teamRows },
});

const updatedRange = appendResp.data.updates?.updatedRange || '?';
console.log(`\n✅ Appended ${teamRows.length} rows to '${TAB}' (${updatedRange}).`);
