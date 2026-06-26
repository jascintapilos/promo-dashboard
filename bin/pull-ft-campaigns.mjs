#!/usr/bin/env node
/**
 * Pull YTD FastTrack CRM segments (via Activities) into the Weekly Report
 * 'CRM Assignment Log' tab, appended after Smartico rows.
 *
 * Source: ActivityManager/Activities/GetActivities (signed in current year)
 *         → linked segment name via ByCategory/1 lookup
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
const APPEND = flags.append === true; // if true, append; if false + WRITE, overwrites (Smartico already wrote header)
const YEAR = new Date().getFullYear();

const TAB = 'CRM Assignment Log';
const OPS_ID = getOpsSheetId();

// TBP team — sourced from Directory sheet 'Team Contact Details'.
// FT display names may differ from Smartico/Directory nicknames.
// Update here if team changes; always re-verify against Directory before editing.
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

const SESSION_FILE = path.resolve(`ft-session-${INSTANCE}.local.json`);
if (!existsSync(SESSION_FILE)) {
  console.error(`No session file for "${INSTANCE}". Run: node bin/capture-ft-session.mjs --instance=${INSTANCE}`);
  process.exit(1);
}

const session = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
// Use origin only (strip /v2 path — QP2 loginUrl has /v2/ but API is at root)
const BASE = new URL(session.loginUrl).origin;

// Check portaltoken not expired
const portalCookie = session.cookies.find(c => c.name === 'portaltoken');
const portaltoken = portalCookie?.value || '';
const cookieExp = portalCookie?.expires || 0;
const URLS = { ws1: 'https://mb8.ft-crm.com/', qpro1: 'https://alpha-iota-qp1.ft-crm.com/', qp2: 'https://alpha-iota-qp2.ft-crm.com/v2/' };
function sessionExpiredMsg(inst) {
  return [
    `Session expired for ${inst}. To renew:`,
    `  1. Open ${URLS[inst] || inst} in Chrome and log in`,
    `  2. Press F12 → Application → Cookies → find "portaltoken" → copy the value`,
    `  3. Run: node bin/save-ft-token.mjs --instance=${inst} --token=<paste-value-here>`,
  ].join('\n');
}
if (!portaltoken) {
  console.error(sessionExpiredMsg(INSTANCE));
  process.exit(1);
}
const nowSec = Math.floor(Date.now() / 1000);
if (cookieExp > 0 && cookieExp < nowSec + 300) {
  console.error(sessionExpiredMsg(INSTANCE));
  process.exit(1);
}
if (cookieExp === 0) {
  // Session cookie — no expiry field to check. Validate with a lightweight ping.
  try {
    const pingRes = await fetch(`${BASE}/crm-api/Admin/User?_start=0&_end=1`, {
      headers: { authtoken: portaltoken, Accept: 'application/json' },
    });
    if (pingRes.status === 401) {
      console.error(sessionExpiredMsg(INSTANCE));
      process.exit(1);
    }
  } catch (e) {
    console.warn(`  Token pre-flight ping failed (${e.message}); continuing — will fail on first API call if expired.`);
  }
}
console.log(`\nFastTrack CRM pull — ${session.label} (${INSTANCE})`);
console.log(`Session valid until: ${cookieExp > 0 ? new Date(cookieExp * 1000).toISOString() : 'session cookie (no expiry)'}`);
console.log(`Mode: ${WRITE ? (APPEND ? 'WRITE (append)' : 'WRITE (overwrite FT section)') : 'DRY RUN'}\n`);

// ── HTTP helpers ──────────────────────────────────────────────────────────────

const AUTH_HEADERS = {
  authtoken: portaltoken,
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

async function apiFetch(urlPath, opts = {}) {
  const res = await fetch(`${BASE}${urlPath}`, {
    headers: AUTH_HEADERS,
    ...opts,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${urlPath}`);
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

async function apiGet(urlPath) {
  return apiFetch(urlPath, { method: 'GET' });
}

async function apiPost(urlPath, body) {
  return apiFetch(urlPath, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ── Fetch data ────────────────────────────────────────────────────────────────

// Deleted/renamed accounts that no longer appear in AdminUsers.
// User 71 signed 48/50 WS1 2026 activities — update this once identified.
const DELETED_USER_NAMES = {
  71: 'FT Team', // deleted AlphaIota BPO account, identity unknown — update when confirmed
};

console.log('Fetching admin users…');
const usersResp = await apiGet('/crm-api/Authentication/AdminUsers');
const userMap = { ...DELETED_USER_NAMES };
(usersResp?.Data || []).forEach(u => {
  userMap[u.UserId] = (u.Name || u.Username || '').replace(/\s+/g, ' ').trim();
});
console.log(`  ${Object.keys(userMap).length} users loaded`);

console.log('Fetching segments (ByCategory/1)…');
const segsResp = await apiGet('/crm-api/ActivityManager/Segments/ByCategory/1');
const segMap = {};
(segsResp?.Data || []).forEach(s => { segMap[s.SegmentId] = s.SegmentName; });
console.log(`  ${Object.keys(segMap).length} segments loaded`);

console.log('Fetching activities…');
const actResp = await apiPost('/crm-api/ActivityManager/Activities/GetActivities', {
  archived: false,
  activityTypeId: 1,
});
const allActivities = actResp?.Data || [];
console.log(`  ${allActivities.length} total activities`);

// ── YTD filter + one-off-only ─────────────────────────────────────────────────
// TriggerTypeId=1: event/recurring trigger (fires on deposit events, monthly schedules, etc.)
// TriggerTypeId=2: manual one-off (trigId=0, specific execDt, no campaign period)
// Keep only TriggerTypeId=2 — these are the team's manually-scheduled one-off blasts.

// WS1 doesn't use QA sign-off — activities have no SignedDate after Feb 2026.
// Use ExecutionDateTime as fallback so WS1 YTD data is complete.
const ytdAll = allActivities.filter(a => {
  const date = a.SignedDate || a.ExecutionDateTime || '';
  return date.slice(0, 4) === String(YEAR);
});

// Log distribution for verification
const trigDist = {};
ytdAll.forEach(a => { trigDist[a.TriggerTypeId] = (trigDist[a.TriggerTypeId] || 0) + 1; });
const distStr = Object.entries(trigDist)
  .map(([id, n]) => `type${id}×${n}`)
  .join(', ');
console.log(`  ${ytdAll.length} in ${YEAR} — TriggerType breakdown: ${distStr || '(none)'}`);

const ytdActivities = ytdAll.filter(a => a.TriggerTypeId === 2);
const excluded = ytdAll.length - ytdActivities.length;
if (excluded) console.log(`  Excluded ${excluded} recurring activities (TriggerTypeId ≠ 2)`);
console.log(`  ${ytdActivities.length} one-off activities`);

// ── Changelog lookup — resolve creator BEFORE dedup ──────────────────────────
// Creator must be known before dedup so team activities are never suppressed
// by a newer non-team blast on the same segment. Changelog is resolved for all
// one-off activities (not just dedup winners) — marginal extra API calls.
console.log('Fetching changelogs for creator attribution…');
const creatorByActId = {};
const CL_BATCH = 20;
let clFailCount = 0;
for (let i = 0; i < ytdActivities.length; i += CL_BATCH) {
  const batch = ytdActivities.slice(i, i + CL_BATCH);
  await Promise.all(batch.map(async a => {
    try {
      const clResp = await apiGet(`/crm-api/Changelog/Entity/activity/${a.ActivityId}`);
      const entries = clResp?.Data || [];
      const createEntry = [...entries].reverse().find(e => e.operationType === 'create');
      const fallbackEntry = entries[entries.length - 1];
      const creatorEntry = createEntry || fallbackEntry;
      if (creatorEntry?.userId) {
        creatorByActId[a.ActivityId] = userMap[creatorEntry.userId] || DELETED_USER_NAMES[creatorEntry.userId] || `uid:${creatorEntry.userId}`;
      }
    } catch { clFailCount++; }
  }));
  if (i + CL_BATCH < ytdActivities.length) {
    process.stdout.write(`\r  ${Math.min(i + CL_BATCH, ytdActivities.length)}/${ytdActivities.length} changelogs…`);
  }
}
console.log(`\r  ${Object.keys(creatorByActId).length} changelogs resolved         `);
if (clFailCount > 0) console.warn(`  ⚠️  ${clFailCount} changelog fetch(es) failed — those rows fall back to SignedBy for creator name.`);

// Team-filter BEFORE dedup — prevents a non-team blast on the same segment from
// winning the newest-first dedup and erasing a team member's activity.
const teamActivities = ytdActivities.filter(a => {
  const creator = creatorByActId[a.ActivityId] || userMap[a.SignedBy];
  return creator && TBP_TEAM.has(creator);
});
console.log(`  ${teamActivities.length} team-created activities`);

// Deduplicate by SegmentId across team activities only (newest team activity wins)
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
console.log(`  ${dedupedActivities.length} unique segments after dedup`);

// ── Brand / Region extraction ─────────────────────────────────────────────────

const CURRENCY_TO_REGION = { MYR: 'MY', SGD: 'SG', IDR: 'ID', THB: 'TH', KHR: 'KH' };

function extractRegion(text) {
  const t = (text || '').toUpperCase();
  // Currency codes — always unambiguous
  if (t.includes('MYR') || t.includes('RM')) {
    // Confirm RM is Ringgit (RM followed by digit, not part of a word like "TERM")
    if (t.includes('MYR') || /\bRM\d/.test(t)) return 'MY';
  }
  if (t.includes('SGD')) return 'SG';
  if (t.includes('IDR')) return 'ID';
  // Word-boundary region codes (e.g. "WS1 MYS FC", "QPRO1 SG 1000GET700")
  if (/\bMYS?\b/.test(t)) return 'MY';
  if (/\bSGP?\b/.test(t)) return 'SG';
  if (/\bIDN?\b/.test(t)) return 'ID';
  if (/\bTH\b/.test(t)) return 'TH';
  if (/\bKH\b/.test(t)) return 'KH';
  // Embedded in compact brand codes: QPMY0601, QP2AMY, QPRO1MY, BP9MY, WS1MY, MBMY0601, MBSG0601
  // Match brand prefix (QP/WS/BP/MB + optional chars) immediately followed by region code
  const embedded = t.match(/(?:QP|WS|BP|MB)[0-9A-Z]*(MY|SG|ID|TH|KH)/);
  if (embedded) return embedded[1];
  return '';
}

function extractBrand(actName, segName, instance) {
  const combined = `${actName || ''} ${segName || ''}`;
  if (instance === 'ws1') {
    // WS2 segments are explicitly labelled with a "WS2" prefix
    if (/^WS2\b/i.test((segName || '').trim())) return 'WS2';
    return 'WS1';
  }

  // QPRO1 / QP2 — extract from name
  const m = combined.match(/QPRO\s*(\d+)/i);
  if (m) return `QPRO${m[1]}`;
  const m2 = combined.match(/QP2([A-D])?/i);
  if (m2) return m2[1] ? `QP2${m2[1].toUpperCase()}` : 'QP2';
  return INSTANCES[instance]?.brand || instance.toUpperCase();
}

// ── Segment currency fallback (GetSelective) ──────────────────────────────────
// For segments whose name doesn't encode a region, fetch the filter JSON from
// GetSelective and read the user_details-currency rule value.

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

// IDs of segments that still need a region from the filter
const noRegionSegIds = [...new Set(
  dedupedActivities
    .filter(a => {
      const seg = segMap[a.SegmentId] || a.ActivityName || '';
      return !(extractRegion(seg) || extractRegion(a.ActivityName || ''));
    })
    .map(a => a.SegmentId)
    .filter(Boolean)
)];

const segCurrencyMap = {}; // segmentId → region string
if (noRegionSegIds.length > 0) {
  console.log(`Fetching segment filters for ${noRegionSegIds.length} no-region segments…`);
  const GS_BATCH = 50;
  for (let i = 0; i < noRegionSegIds.length; i += GS_BATCH) {
    const batch = noRegionSegIds.slice(i, i + GS_BATCH);
    try {
      const resp = await apiPost('/crm-api/ActivityManager/Segments/GetSelective', batch);
      for (const s of resp?.Data || []) {
        if (!s.SegmentFilter) continue;
        const currencies = parseCurrenciesFromFilter(s.SegmentFilter);
        if (currencies.length === 1) {
          segCurrencyMap[s.SegmentId] = CURRENCY_TO_REGION[currencies[0]] || '';
        } else if (currencies.length > 1) {
          // Multi-currency segment — join all found regions
          const regions = [...new Set(currencies.map(c => CURRENCY_TO_REGION[c]).filter(Boolean))];
          segCurrencyMap[s.SegmentId] = regions.join('/');
        }
      }
    } catch { /* non-fatal; region stays blank */ }
  }
  const resolved = Object.keys(segCurrencyMap).length;
  console.log(`  Resolved ${resolved}/${noRegionSegIds.length} via segment filter`);
}

// ── Build rows ────────────────────────────────────────────────────────────────

const crmTool = INSTANCES[INSTANCE].label;

const dataRows = dedupedActivities.map(a => {
  const segName = segMap[a.SegmentId] || a.ActivityName || '';
  // Prefer changelog creator; fall back to SignedBy; fall back to 'FT Team'
  const creatorName = creatorByActId[a.ActivityId] || userMap[a.SignedBy] || 'FT Team';
  const date = (a.SignedDate || a.ExecutionDateTime || '').slice(0, 10);
  const brand = extractBrand(a.ActivityName, segName, INSTANCE);
  const region = extractRegion(segName) || extractRegion(a.ActivityName) || segCurrencyMap[a.SegmentId] || '';
  return [date, brand, region, crmTool, segName, creatorName];
});

dataRows.sort((a, b) => b[0].localeCompare(a[0])); // sort by date desc (newest first)

// Filter to TBP team only — non-team accounts (Seahub Mimi, BPO staff, etc.) are excluded.
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

// ── Guard: verify tab has a header + at least one data row before appending ────
// If Smartico crashed after clearing the tab (leaving it empty), appending FT
// here would produce a headerless sheet with no Smartico data.
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

// Use append — auto-extends sheet rows, no need to pre-calculate start row
const appendResp = await sheets.spreadsheets.values.append({
  spreadsheetId: OPS_ID,
  range: `'${TAB}'!A1`,
  valueInputOption: 'RAW',
  insertDataOption: 'INSERT_ROWS',
  requestBody: { values: teamRows },
});

const updatedRange = appendResp.data.updates?.updatedRange || '?';
console.log(`\n✅ Appended ${teamRows.length} rows to '${TAB}' (${updatedRange}).`);
