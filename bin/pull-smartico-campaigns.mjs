/**
 * Pull YTD Smartico scheduled campaigns created by the promo team into
 * the Weekly Report 'CRM Assignment Log' tab.
 *
 * Source: j_audience_scheduled — Scheduled Campaigns (each has its segment attached).
 * Segments are not pulled separately — they are redundant once we have the campaign.
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
console.log(`\nSmartico pull (scheduled campaigns only) — YTD ${YEAR}  (token: ${client.capturedAt})`);
console.log(`Mode: ${WRITE ? 'WRITE' : 'DRY RUN'}\n`);

// ── Scheduled Campaigns: j_audience_scheduled (SPA API format) ───────────────
// The react-admin list endpoint (_start/_end/_sort/_order) is broken for
// j_audience_scheduled — ignores all params and returns the same 1000 oldest
// records. The SPA API format (listSPAAll) works correctly.
// audience_exec_type_id=3 selects Scheduled campaigns only.
console.log('Fetching scheduled campaigns (j_audience_scheduled, SPA API)...');
const actArr = await client.listSPAAll(
  'j_audience_scheduled',
  { audience_exec_type_id: 3 },
  YEAR,
);
console.log(`Scheduled campaigns (YTD, all creators): ${actArr.length}`);

const ytd = actArr
  .filter(a => TEAM[a.username])
  .map(a => ({
    create_date:         a.create_date || '',
    username:            a.username    || '',
    segment_name:        a.audience_name || String(a.id || ''),
    conditions_readable: a.conditions_readable || a.segment_conditions_readable || '',
  }));

ytd.sort((a, b) => (a.create_date || '').localeCompare(b.create_date || ''));
console.log(`\nTotal YTD rows: ${ytd.length} (team-only)`);

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
