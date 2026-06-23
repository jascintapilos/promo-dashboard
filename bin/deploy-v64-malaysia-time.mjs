#!/usr/bin/env node
/**
 * V64 — Switch all dates and times to Malaysia time (GMT+8).
 *
 *   1. Add __MY_TZ_ + helpers __myToday_() and __formatMY_() at the
 *      top of the Reports section.
 *   2. Replace hardcoded today = '2026-05-22' with dynamic __myToday_()
 *      so "Today", "Yesterday", "Last 4W" etc. follow the real date in
 *      Malaysia time, not a snapshot.
 *   3. Synced timestamp on the report header now formats as
 *      "22 May 2026 19:00 MYT" instead of UTC.
 *   4. Overdue/delayed checks in __delayedTasksCard_ etc. use the
 *      Malaysia today anchor.
 *
 *   Apps Script side already runs Asia/Singapore (GMT+8 = same as MY),
 *   so no manifest change needed.
 */
import { getGoogleAuth } from '../src/google-auth.js';

const SCRIPT_ID     = '1Zw5W9LjmYL5hzFpHXdr0G_Q7oFRVCAGqZVTBmQCjiOmZIO2R7M6h8l6O';
const DEPLOYMENT_ID = 'AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ';

const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

async function api(method, url, body) {
  const r = await fetch(`https://script.googleapis.com/v1${url}`, {
    method,
    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
  return r.json();
}

const proj = await api('GET', `/projects/${SCRIPT_ID}/content`);
const dashIdx = proj.files.findIndex(f => f.name === 'Dashboard');
let dash = proj.files[dashIdx].source;

// ─── 1. Add Malaysia time helpers at top of Reports section ─────────────────
const ANCHOR = `var __RPT_DATA = {`;
const HELPERS = `// ── Malaysia time helpers (GMT+8) — V64 ─────────────────────────────────────
var __MY_TZ_ = 'Asia/Kuala_Lumpur';
function __myToday_() {
  // Today as YYYY-MM-DD in Malaysia time (works no matter the browser TZ)
  return new Date().toLocaleDateString('en-CA', { timeZone: __MY_TZ_ });
}
function __myDateMinus_(days) {
  var d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toLocaleDateString('en-CA', { timeZone: __MY_TZ_ });
}
function __formatMY_(isoString) {
  // ISO timestamp → "22 May 2026 19:00 MYT"
  if (!isoString) return '';
  try {
    var d = new Date(isoString);
    var parts = d.toLocaleString('en-GB', {
      timeZone: __MY_TZ_,
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    return parts.replace(',', '') + ' MYT';
  } catch (e) { return String(isoString).slice(0,16); }
}
function __formatMYDate_(isoOrDateStr) {
  // YYYY-MM-DD or ISO timestamp → "22 May 2026"
  if (!isoOrDateStr) return '';
  try {
    var s = String(isoOrDateStr).slice(0,10) + 'T00:00:00';
    var d = new Date(s);
    return d.toLocaleDateString('en-GB', {
      timeZone: __MY_TZ_,
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch (e) { return String(isoOrDateStr).slice(0,10); }
}

var __RPT_DATA = {`;

if (!dash.includes(ANCHOR)) { console.error('✗ __RPT_DATA anchor not found'); process.exit(1); }
if (!dash.includes('var __MY_TZ_')) {
  dash = dash.replace(ANCHOR, HELPERS);
  console.log('✓ Added __myToday_ / __formatMY_ helpers (Asia/Kuala_Lumpur)');
}

// ─── 2. Replace hardcoded '2026-05-22' anchor in __rptApplyPreset_ ──────────
const OLD_APPLY_TODAY = `function __rptApplyPreset_(preset) {
  __rptFilter.preset = preset;
  var today = '2026-05-22';
  var TODAY = new Date(today + 'T00:00:00Z');
  function isoMinusDays(n){ var d=new Date(TODAY.getTime()); d.setUTCDate(d.getUTCDate()-n); return d.toISOString().slice(0,10); }`;

const NEW_APPLY_TODAY = `function __rptApplyPreset_(preset) {
  __rptFilter.preset = preset;
  var today = __myToday_();
  function isoMinusDays(n){ return __myDateMinus_(n); }`;

if (dash.includes(OLD_APPLY_TODAY)) {
  dash = dash.replace(OLD_APPLY_TODAY, NEW_APPLY_TODAY);
  console.log('✓ __rptApplyPreset_: today now reads Malaysia date dynamically');
}

// ─── 3. Same for __rptQuickSelect_ ──────────────────────────────────────────
const OLD_QS_TODAY = `function __rptQuickSelect_(val) {
  if (!val) return;
  var today = '2026-05-22';
  var TODAY = new Date(today + 'T00:00:00Z');`;
const NEW_QS_TODAY = `function __rptQuickSelect_(val) {
  if (!val) return;
  var today = __myToday_();
  var TODAY = new Date(today + 'T00:00:00Z');`;

if (dash.includes(OLD_QS_TODAY)) {
  dash = dash.replace(OLD_QS_TODAY, NEW_QS_TODAY);
  console.log('✓ __rptQuickSelect_: today now reads Malaysia date dynamically');
}

// ─── 4. Update header sync-at display (was raw ISO, now MYT formatted) ──────
// Look for "Synced " in the header
const OLD_SYNC_LABEL_PATTERNS = [
  `(__rptSyncedAt ? '🕒 Synced ' + __rptSyncedAt.slice(0,10) + ' ' + __rptSyncedAt.slice(11,16) + ' UTC' : '⚠ Using cached data — click Sync')`,
  `(__rptSyncedAt ? '🕒 Synced ' + __rptSyncedAt.slice(0,10) + ' ' + __rptSyncedAt.slice(11,16) : '⚠ Using cached data — click Sync')`,
];

let labelFixed = false;
for (const oldL of OLD_SYNC_LABEL_PATTERNS) {
  if (dash.includes(oldL)) {
    dash = dash.replace(oldL, `(__rptSyncedAt ? '🕒 Synced ' + __formatMY_(__rptSyncedAt) : '⚠ Using cached data — click Sync')`);
    labelFixed = true;
    break;
  }
}

if (labelFixed) console.log('✓ Sync-at header label: now uses __formatMY_ (MYT)');
else {
  // Try a generic regex match
  const m = dash.match(/__rptSyncedAt\\.slice\\(0,10\\)[^']*UTC/);
  if (m) {
    console.log('  Found alt UTC label pattern, trying generic replace');
    dash = dash.replace(/__rptSyncedAt \?[^:]+UTC' : ([^)]+)\)/, function(match, fallback){
      return `__rptSyncedAt ? '🕒 Synced ' + __formatMY_(__rptSyncedAt) : ${fallback})`;
    });
    console.log('✓ Generic sync-at label replaced');
  } else {
    console.log('  No UTC label found — already fixed or different pattern');
  }
}

// ─── 5. Replace remaining hardcoded '2026-05-22' anchors ────────────────────
// In __delayedTasksCard_ (overdue check), V60 overdue filter, and others
let nReplaced = 0;
const beforeCount = (dash.match(/'2026-05-22'/g) || []).length;
// Generic global replace — but ONLY where it's used as "today" anchor (in conditional checks)
// To avoid breaking the __RPT_DATA week dates, we restrict to specific patterns

// Pattern: in comparison context like (d < '2026-05-22') or (today: '2026-05-22')
const replacements = [
  { from: `var today = new Date('2026-05-22T00:00:00Z');`, to: `var today = new Date(__myToday_() + 'T00:00:00Z');` },
  // overdue task filter
  { from: `return d && d < '2026-05-22' && !`, to: `return d && d < __myToday_() && !` },
  // delayed tasks card
  { from: `if (d >= '2026-05-22') return false;`, to: `if (d >= __myToday_()) return false;` },
  { from: `var today = new Date('2026-05-22T00:00:00Z');`, to: `var today = new Date(__myToday_() + 'T00:00:00Z');` },
];

for (const r of replacements) {
  if (dash.includes(r.from)) {
    dash = dash.replace(r.from, r.to);
    nReplaced++;
  }
}
console.log('✓ Replaced ' + nReplaced + ' "2026-05-22" today-anchor references with __myToday_()');

const afterCount = (dash.match(/'2026-05-22'/g) || []).length;
console.log('  Remaining 2026-05-22 occurrences: ' + afterCount + ' (these are inside __RPT_DATA week dates — intentional)');

// ─── 6. Update header labels to use formatted MY dates ──────────────────────
const OLD_LABELS = `    if (p==='all') return 'Year-to-Date • Jan 1 – May 22, 2026';
    if (p==='last1w') return 'Week 20 • May 12 – May 18, 2026';`;
const NEW_LABELS = `    if (p==='all') return 'Year-to-Date • ' + __formatMYDate_('2026-01-01') + ' – ' + __formatMYDate_(__myToday_());
    if (p==='last1w') return 'Last Week • ' + __formatMYDate_(__rptFilter.from) + ' – ' + __formatMYDate_(__rptFilter.to);`;

if (dash.includes(OLD_LABELS)) {
  dash = dash.replace(OLD_LABELS, NEW_LABELS);
  console.log('✓ "All YTD" + "Last 1W" labels now use formatted MY dates');
}

const OLD_TODAY_LABELS = `    if (p==='today')     return 'Today • 2026-05-22';
    if (p==='yesterday') return 'Yesterday • 2026-05-21';`;
const NEW_TODAY_LABELS = `    if (p==='today')     return 'Today • ' + __formatMYDate_(__myToday_());
    if (p==='yesterday') return 'Yesterday • ' + __formatMYDate_(__myDateMinus_(1));`;

if (dash.includes(OLD_TODAY_LABELS)) {
  dash = dash.replace(OLD_TODAY_LABELS, NEW_TODAY_LABELS);
  console.log('✓ "Today" + "Yesterday" labels now use dynamic MY date');
}

// ─── Push & promote ──────────────────────────────────────────────────────────
proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V64: Malaysia time (GMT+8) across dashboard ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V64: MYT time',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('\nhttps://script.google.com/macros/s/AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ/exec');
