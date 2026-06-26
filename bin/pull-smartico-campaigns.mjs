/**
 * Pull YTD Smartico segments AND activities created by the promo team into
 * the Weekly Report 'CRM Assignment Log' tab.
 *
 * Sources:
 *   j_segment            — Segments (created via Segment menu)
 *   j_audience_scheduled — Activities (created directly in the Activity tool)
 *
 * Columns: Date | Brand | Region | CRM Tool | Segment Name | Created By
 *
 * Team usernames in Smartico:
 *   Alysa@enigma, Booninn@enigma (Wen), Elyssa@enigma,
 *   Bangun@enigma, Gabrielle@enigma (Gaby), Jascinta@enigma, Waiyip@enigma
 *
 * Requires smartico-session.local.json (run capture-smartico-session.mjs first).
 * DRY RUN by default; --write commits.
 *
 * Usage:
 *   node bin/pull-smartico-campaigns.mjs
 *   node bin/pull-smartico-campaigns.mjs --write
 */
import { smarticoClient } from '../src/smartico-client.js';
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';
import { parseArgs } from './_args.js';
import { listSites } from '../src/sites.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const { flags } = parseArgs(process.argv.slice(2));
const WRITE = flags.write === true;
const OPS_ID = getOpsSheetId();
const YEAR = new Date().getFullYear();

// ── Team username → canonical name ───────────────────────────────────────────
const TEAM = {
  'Alysa@enigma':      'Alysa',
  'Booninn@enigma':    'Wen',
  'Elyssa@enigma':     'Elyssa',
  'Bangun@enigma':     'Bangun',
  'Gabrielle@enigma':  'Gaby',
  'Jascinta@enigma':   'Jascinta',
  'Waiyip@enigma':     'Wai Yip',
};

// ── Brand + Region extraction ─────────────────────────────────────────────────

function extractBrand(name) {
  const m = (name || '').match(/(?<![a-zA-Z])QPRO(\d+)(?![a-zA-Z])/i);
  return m ? `QPRO${m[1]}` : '';
}

// Build QPRO# → region string from sites.js ("MY", "MY/SG", "MY/SG/ID", etc.)
const QPRO_REGIONS = {};
for (const site of listSites()) {
  const qm = site.label.match(/QPRO(\d+)/);
  const rm = site.label.match(/\(([A-Z/]+)\)/);
  if (qm && rm) QPRO_REGIONS[parseInt(qm[1])] = rm[1];
}

const REGION_MAP = [
  [/(?<![a-zA-Z])MYS?(?![a-zA-Z])/,  'MY'],
  [/(?<![a-zA-Z])SGP?(?![a-zA-Z])/,  'SG'],
  [/(?<![a-zA-Z])IDN?(?![a-zA-Z])/,  'ID'],
  [/(?<![a-zA-Z])TH(?![a-zA-Z])/,    'TH'],
  [/(?<![a-zA-Z])KH(?![a-zA-Z])/,    'KH'],
];
const CURRENCY_REGION = { MYR: 'MY', SGD: 'SG', IDR: 'ID', THB: 'TH', KHR: 'KH' };

function extractRegion(segName, conditionsText) {
  for (const [re, code] of REGION_MAP) {
    if (re.test(segName || '')) return code;
  }
  // QPRO# → brand-supported regions (e.g. QPRO4 → MY, QPRO2 → MY/SG)
  const qm = (segName || '').match(/(?<![a-zA-Z])QPRO(\d+)(?![a-zA-Z])/i);
  if (qm && QPRO_REGIONS[parseInt(qm[1])]) return QPRO_REGIONS[parseInt(qm[1])];
  // currency in conditions
  const m = (conditionsText || '').match(/\b(MYR|SGD|IDR|THB|KHR)\b/i);
  if (m) return CURRENCY_REGION[m[1].toUpperCase()] || '';
  return '';
}

// ── Main ──────────────────────────────────────────────────────────────────────

const client = smarticoClient();
console.log(`\nSmartico pull (segments + activities) — YTD ${YEAR}  (token: ${client.capturedAt})`);
console.log(`Mode: ${WRITE ? 'WRITE' : 'DRY RUN'}\n`);

// ── Segments: fetch base list + scan beyond 1000-record cap ──────────────────
console.log('Fetching segment list (API cap: 1000 records)...');
const all = await client.list('j_segment', { _start: 0, _end: 10000, _sort: 'id', _order: 'ASC' });
const listArr = Array.isArray(all) ? all : [];
const listMaxId = listArr.length ? Math.max(...listArr.map(s => s.id || 0)) : 35865;
console.log(`List returned: ${listArr.length} segments  (max ID: ${listMaxId})`);

// Smartico's list endpoint returns the OLDEST 1000 segments by ID ASC. Any
// segments created after the 1000th one are invisible through list. We fetch
// them individually via GET /{id} starting from listMaxId+1.
const MISS_THRESHOLD = parseInt(process.env.SMARTICO_SCAN_WINDOW || '1500');
const scanStart = listMaxId + 1;
console.log(`Scanning IDs ${scanStart}+ for new segments (${MISS_THRESHOLD}-miss stop)...`);
const { segments: extraArr, maxScannedId } = await client.scanBeyondList(scanStart, {
  consecutiveMissThreshold: MISS_THRESHOLD,
  onProgress: (id, n) => process.stdout.write(`\r  scanned to ${id}, found ${n} new...`),
});
if (extraArr.length) process.stdout.write('\n');
console.log(`Incremental scan: ${extraArr.length} new segments found beyond list (max ID seen: ${maxScannedId})`);

if (WRITE) {
  writeFileSync(path.resolve('smartico-scan-state.local.json'), JSON.stringify({
    lastScanCompletedAt: new Date().toISOString(),
    listMaxId,
    maxScannedId,
    extrasFound: extraArr.length,
    note: 'advisory only; scan always starts from listMaxId+1',
  }));
}

const segmentArr = [...listArr, ...extraArr];
const ytdSegments = segmentArr.filter(s =>
  s.create_date &&
  s.create_date.slice(0, 10) >= `${YEAR}-01-01` &&
  TEAM[s.username]
);
console.log(`YTD team segments: ${ytdSegments.length}`);

// ── Activities: j_audience_scheduled (Scheduled Campaigns) ───────────────────
// NOTE: The react-admin list endpoint (_start/_end/_sort/_order) is broken for
// j_audience_scheduled — it ignores all params and always returns the same 1000
// oldest records. We use the SPA API format (listSPAAll) which actually works.
// audience_exec_type_id=3 selects Scheduled campaigns only.
console.log('\nFetching scheduled campaigns (j_audience_scheduled, SPA API)...');
let ytdActivities = [];
try {
  const actArr = await client.listSPAAll(
    'j_audience_scheduled',
    { audience_exec_type_id: 3 },
    YEAR,
  );
  console.log(`Scheduled campaigns (YTD): ${actArr.length} total`);

  ytdActivities = actArr
    .filter(a => TEAM[a.username])
    .map(a => ({
      create_date:         a.create_date || '',
      username:            a.username    || '',
      segment_name:        a.audience_name || String(a.id || ''),
      conditions_readable: a.conditions_readable || a.segment_conditions_readable || '',
      _type: 'Activity',
    }));
  console.log(`YTD team activities: ${ytdActivities.length}`);
} catch (e) {
  if (/errCode|expired/i.test(e.message)) throw e;
  console.warn(`  Activity pull skipped: ${e.message}`);
}

// ── Combine + sort ────────────────────────────────────────────────────────────
const ytdSegmentsTagged = ytdSegments.map(s => ({ ...s, _type: 'Segment' }));
const ytd = [...ytdSegmentsTagged, ...ytdActivities];
ytd.sort((a, b) => (a.create_date || '').localeCompare(b.create_date || ''));

console.log(`\nTotal YTD rows: ${ytd.length} (${ytdSegments.length} segments + ${ytdActivities.length} activities)`);

// Summary by team member
const byMember = {};
for (const s of ytd) {
  const name = TEAM[s.username];
  byMember[name] = (byMember[name] || 0) + 1;
}
console.log('By team member (YTD):');
for (const [name, n] of Object.entries(byMember).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${name}`);
}
console.log();

const HEADER = ['Date', 'Brand', 'Region', 'CRM Tool', 'Segment Name', 'Created By'];
const dataRows = ytd.map(s => [
  (s.create_date || '').slice(0, 10),
  extractBrand(s.segment_name || ''),
  extractRegion(s.segment_name || '', s.conditions_readable || ''),
  'Smartico',
  s.segment_name || '',
  TEAM[s.username] || s.username,
]);

const rows = [HEADER, ...dataRows];
console.log(`Rows to write: ${dataRows.length} data + 1 header = ${rows.length} total`);

const TAB = 'CRM Assignment Log';

if (WRITE) {
  const { sheets } = await getSheetsClient();

  const meta = await sheets.spreadsheets.get({ spreadsheetId: OPS_ID, fields: 'sheets.properties.title' });
  const tabExists = meta.data.sheets.some(s => s.properties.title === TAB);
  if (!tabExists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: OPS_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
    });
    console.log(`Created tab '${TAB}'.`);
  }

  // ── SAFETY CHECK: refuse to wipe the CRM tab on a suspiciously low pull ──
  // pull-smartico clears the entire tab before writing, then FT pulls append.
  // If this pull returns 0 / too-few rows (silent token failure, team filter
  // mismatch, partial API response), we'd wipe Smartico AND today's FT data
  // since FT appends run AFTER. Abort early in that case.
  const FORCE = process.argv.includes('--force');
  if (!FORCE) {
    if (dataRows.length === 0) {
      console.error(`\n⛔ ABORT: 0 team records found (segments + activities). Refusing to wipe '${TAB}'.`);
      console.error(`   Possible causes: Smartico session expired, team username changed, or API issue.`);
      console.error(`   Re-run capture-smartico-session.mjs, then this script. Pass --force to override.`);
      process.exit(3);
    }
    // Check against existing Smartico-only row count (col D = CRM Tool)
    try {
      const existing = await sheets.spreadsheets.values.get({
        spreadsheetId: OPS_ID, range: `'${TAB}'!A:F`,
      });
      const existingRows = (existing.data.values || []).slice(1).filter(r => r && r[3] === 'Smartico');
      const existingCount = existingRows.length;
      if (existingCount > 100 && dataRows.length < existingCount * 0.5) {
        console.error(`\n⛔ ABORT: new Smartico pull (${dataRows.length} rows) is < 50% of existing Smartico data (${existingCount}).`);
        console.error(`   Refusing to wipe '${TAB}' with suspiciously small dataset.`);
        console.error(`   If this is correct (e.g. team usernames changed), re-run with --force.`);
        process.exit(3);
      }
    } catch (e) {
      console.error(`   (Could not read existing tab size: ${e.message}; proceeding anyway.)`);
    }
  }

  await sheets.spreadsheets.values.clear({ spreadsheetId: OPS_ID, range: `'${TAB}'!A:Z` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: OPS_ID,
    range: `'${TAB}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });
  console.log(`\n✅ Wrote ${dataRows.length} rows to '${TAB}'.`);
} else {
  console.log('Sample rows (first 5):');
  for (const r of dataRows.slice(0, 5)) {
    console.log(' ', r.map(v => String(v).padEnd(20).slice(0, 20)).join(' | '));
  }
  console.log('\n(DRY RUN — re-run with --write to commit.)');
}
