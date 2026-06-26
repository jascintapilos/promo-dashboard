/**
 * Pull YTD Smartico scheduled campaigns + orphan segments into the Weekly
 * Report 'CRM Assignment Log' tab.
 *
 * Logic:
 *   1. Pull all j_audience_scheduled (Scheduled Campaigns, SPA API format).
 *   2. Pull all j_segment (list + scan beyond 1000-record cap).
 *   3. Deduplicate: a segment whose name matches a campaign's audience_name is
 *      already represented → skip it. Only include segments with NO matching
 *      campaign ("orphan" segments — created for analysis/reuse, never blasted).
 *   4. Write: campaigns + orphan segments, sorted by create_date.
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
import { writeFileSync } from 'node:fs';
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
  const qm = (segName || '').match(/(?<![a-zA-Z])QPRO(\d+)(?![a-zA-Z])/i);
  if (qm && QPRO_REGIONS[parseInt(qm[1])]) return QPRO_REGIONS[parseInt(qm[1])];
  const m = (conditionsText || '').match(/\b(MYR|SGD|IDR|THB|KHR)\b/i);
  if (m) return CURRENCY_REGION[m[1].toUpperCase()] || '';
  return '';
}

// ── Main ──────────────────────────────────────────────────────────────────────

const client = smarticoClient();
console.log(`\nSmartico pull (campaigns + orphan segments) — YTD ${YEAR}  (token: ${client.capturedAt})`);
console.log(`Mode: ${WRITE ? 'WRITE' : 'DRY RUN'}\n`);

// ── Step 1: Scheduled Campaigns (SPA API — react-admin format is broken here) ─
console.log('Fetching scheduled campaigns (j_audience_scheduled, SPA API)...');
const allCampaigns = await client.listSPAAll(
  'j_audience_scheduled',
  { audience_exec_type_id: 3 },
  YEAR,
);
console.log(`Scheduled campaigns (YTD, all creators): ${allCampaigns.length}`);

// Build segment_id set for dedup — each campaign has a segment_id pointing to
// the j_segment record it uses as its audience. Segments in this set are already
// represented by a campaign and should not be double-counted.
const coveredSegmentIds = new Set(allCampaigns.map(a => a.segment_id).filter(Boolean));

// ── Step 2: Segments (list + scan beyond 1000-record cap) ────────────────────
console.log('\nFetching segment list (API cap: 1000 records)...');
const rawList = await client.list('j_segment', { _start: 0, _end: 10000, _sort: 'id', _order: 'ASC' });
const segList = Array.isArray(rawList) ? rawList : [];
const listMaxId = segList.length ? Math.max(...segList.map(s => s.id || 0)) : 35865;
console.log(`List returned: ${segList.length} segments  (max ID: ${listMaxId})`);

const MISS_THRESHOLD = parseInt(process.env.SMARTICO_SCAN_WINDOW || '1500');
console.log(`Scanning IDs ${listMaxId + 1}+ for newer segments (${MISS_THRESHOLD}-miss stop)...`);
const { segments: extraArr, maxScannedId } = await client.scanBeyondList(listMaxId + 1, {
  consecutiveMissThreshold: MISS_THRESHOLD,
  onProgress: (id, n) => process.stdout.write(`\r  scanned to ${id}, found ${n} new...`),
});
if (extraArr.length) process.stdout.write('\n');
console.log(`Incremental scan: ${extraArr.length} new segments (max ID seen: ${maxScannedId})`);

if (WRITE) {
  writeFileSync(path.resolve('smartico-scan-state.local.json'), JSON.stringify({
    lastScanCompletedAt: new Date().toISOString(),
    listMaxId,
    maxScannedId,
    extrasFound: extraArr.length,
    note: 'advisory only; scan always starts from listMaxId+1',
  }));
}

const allSegments = [...segList, ...extraArr];
const ytdSegments = allSegments.filter(s =>
  s.create_date &&
  s.create_date.slice(0, 10) >= `${YEAR}-01-01` &&
  TEAM[s.username]
);
console.log(`YTD team segments: ${ytdSegments.length}`);

// ── Step 3: Deduplicate — keep only segments not used by any campaign ─────────
const orphanSegments = ytdSegments.filter(s => !coveredSegmentIds.has(s.id));
const coveredCount   = ytdSegments.length - orphanSegments.length;
console.log(`  ${coveredCount} covered by a campaign (skipped) | ${orphanSegments.length} orphans (included)`);

// ── Step 4: Combine and sort ──────────────────────────────────────────────────
const teamCampaigns = allCampaigns
  .filter(a => TEAM[a.username])
  .map(a => ({
    create_date:         a.create_date || '',
    username:            a.username    || '',
    segment_name:        a.audience_name || String(a.id || ''),
    conditions_readable: a.conditions_readable || a.segment_conditions_readable || '',
    _source: 'campaign',
  }));

const orphanRows = orphanSegments.map(s => ({
  create_date:         s.create_date || '',
  username:            s.username    || '',
  segment_name:        s.name        || String(s.id || ''),
  conditions_readable: s.conditions_readable || '',
  _source: 'segment',
}));

const ytd = [...teamCampaigns, ...orphanRows];
ytd.sort((a, b) => (a.create_date || '').localeCompare(b.create_date || ''));

console.log(`\nTotal YTD rows: ${ytd.length} (${teamCampaigns.length} campaigns + ${orphanRows.length} orphan segments)`);

// Summary by team member
const byMember = {};
for (const r of ytd) {
  const name = TEAM[r.username];
  byMember[name] = (byMember[name] || 0) + 1;
}
console.log('By team member (YTD):');
for (const [name, n] of Object.entries(byMember).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${name}`);
}
console.log();

const HEADER = ['Date', 'Brand', 'Region', 'CRM Tool', 'Segment Name', 'Created By'];
const dataRows = ytd.map(r => [
  (r.create_date || '').slice(0, 10),
  extractBrand(r.segment_name || ''),
  extractRegion(r.segment_name || '', r.conditions_readable || ''),
  'Smartico',
  r.segment_name || '',
  TEAM[r.username] || r.username,
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

  const FORCE = process.argv.includes('--force');

  // ── Read existing tab: safety check + preserve non-Smartico rows (FT etc.) ──
  // Smartico clears the whole tab before writing. Without preservation, any
  // FastTrack rows already appended this session would be wiped.
  let preservedRows = [];
  if (dataRows.length === 0 && !FORCE) {
    console.error(`\n⛔ ABORT: 0 team records found. Refusing to wipe '${TAB}'.`);
    console.error(`   Re-run capture-smartico-session.mjs then retry. Pass --force to override.`);
    process.exit(3);
  }
  try {
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: OPS_ID, range: `'${TAB}'!A:F`,
    });
    const allData = (existing.data.values || []).slice(1).filter(r => r && r.length);
    const existingSmartCount = allData.filter(r => r[3] === 'Smartico').length;
    if (!FORCE && existingSmartCount > 100 && dataRows.length < existingSmartCount * 0.5) {
      console.error(`\n⛔ ABORT: new pull (${dataRows.length} rows) is < 50% of existing Smartico rows (${existingSmartCount}).`);
      console.error(`   Pass --force to override.`);
      process.exit(3);
    }
    preservedRows = allData.filter(r => r[3] !== 'Smartico');
    if (preservedRows.length) {
      console.log(`Preserving ${preservedRows.length} non-Smartico rows for re-insertion (FastTrack etc.).`);
    }
  } catch (e) {
    console.error(`   (Could not read existing tab: ${e.message}; proceeding without preservation.)`);
  }

  // ── Clear, write Smartico rows, then restore preserved rows ──────────────────
  await sheets.spreadsheets.values.clear({ spreadsheetId: OPS_ID, range: `'${TAB}'!A:Z` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: OPS_ID,
    range: `'${TAB}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });
  if (preservedRows.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: OPS_ID,
      range: `'${TAB}'!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: preservedRows },
    });
    console.log(`Re-appended ${preservedRows.length} preserved non-Smartico rows.`);
  }
  console.log(`\n✅ Wrote ${dataRows.length} Smartico rows to '${TAB}'${preservedRows.length ? ` + restored ${preservedRows.length} non-Smartico rows` : ''}.`);
} else {
  console.log('Sample rows (first 5):');
  for (const r of dataRows.slice(0, 5)) {
    console.log(' ', r.map(v => String(v).padEnd(20).slice(0, 20)).join(' | '));
  }
  console.log('\n(DRY RUN — re-run with --write to commit.)');
}
