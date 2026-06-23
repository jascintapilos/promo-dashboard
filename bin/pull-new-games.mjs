/**
 * Pull new game additions from the New Games working sheet (2026 tab) into the
 * Weekly Report 'New Games' tab, which feeds the dashboard.
 *
 * Source: https://docs.google.com/spreadsheets/d/1DLcM9gU2t7qPwaELC4Z_ux_qNI1OEHyNCkWmDItaqgw
 * Target: Weekly Report → 'New Games' tab
 *
 * Column mapping:
 *   Working sheet      → New Games tab
 *   Date (A)           → Date          (DD/MM/YYYY)
 *   Wallet (C)         → Brand         ("Seamless" = all-brand)
 *   Region (B)         → Region        ("ALL")
 *   Name (H)           → Game Name
 *   Provider (E)       → Game Provider
 *   Category (D)       → Game Category (new column)
 *   —                  → Added By      (blank — not tracked in source)
 *   Status (K, date)   → Status        (Live / Scheduled / Pending)
 *
 * Rewrites the tab each run (source sheet is authoritative).
 * DRY RUN by default; --write commits.
 *
 * Usage:
 *   node bin/pull-new-games.mjs
 *   node bin/pull-new-games.mjs --write
 */
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const WRITE = flags.write === true;

const SOURCE_ID  = '1DLcM9gU2t7qPwaELC4Z_ux_qNI1OEHyNCkWmDItaqgw';
const SOURCE_TAB = '2026';
const TARGET_TAB = 'New Games';
const HEADERS    = ['Date', 'Brand', 'Region', 'Game Name', 'Game Provider', 'Game Category', 'Status'];

// Parse DD/MM/YYYY → Date (returns null if unparseable)
function parseDMY(s) {
  const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}

// Status = "Added" — promo team tracks addition only; live/not-live is tech's job.
function deriveStatus(_raw) { return 'Added'; }

const { sheets } = await getSheetsClient();
const OPS_ID = getOpsSheetId();

// ── Read source ──
const src = await sheets.spreadsheets.values.get({ spreadsheetId: SOURCE_ID, range: `'${SOURCE_TAB}'!A:K` });
const srcRows = src.data.values || [];
const hdr = srcRows[0] || [];
const ci = (name) => hdr.findIndex((c) => String(c).trim().toLowerCase() === name.toLowerCase());

const iDate = ci('Date'), iRegion = ci('Region'), iWallet = ci('Wallet');
const iCat  = ci('Category'), iProv = ci('Provider'), iName = ci('Name'), iStatus = 10; // col K

const games = [];
for (const r of srcRows.slice(1)) {
  const name = (r[iName] || '').trim();
  if (!name) continue;
  games.push([
    r[iDate]   || '',              // Date
    (r[iWallet] === 'Seamless' || !r[iWallet]) ? 'WS1/WS2' : r[iWallet],  // Brand
    (r[iRegion] === 'ALL'      || !r[iRegion]) ? 'MY/SG/ID/TH/KH' : r[iRegion],  // Region
    name,                          // Game Name
    r[iProv]   || '',              // Game Provider
    r[iCat]    || '',              // Game Category
    deriveStatus(r[iStatus] || ''),// Status
  ]);
}

// Sort descending by date (latest first)
games.sort((a, b) => {
  const da = parseDMY(a[0]), db = parseDMY(b[0]);
  if (!da && !db) return 0;
  if (!da) return 1;
  if (!db) return -1;
  return db - da;
});

console.log(`\nNew Games pull  (${WRITE ? 'WRITE' : 'DRY RUN'})`);
console.log(`Source: ${SOURCE_ID} → '${SOURCE_TAB}' tab`);
console.log(`Games found: ${games.length}`);

// Status breakdown
const statusCount = games.reduce((m, r) => { m[r[6]] = (m[r[6]] || 0) + 1; return m; }, {});
Object.entries(statusCount).forEach(([s, n]) => console.log(`  ${s.padEnd(12)} ${n}`));

// Provider breakdown
const provCount = games.reduce((m, r) => { m[r[4]] = (m[r[4]] || 0) + 1; return m; }, {});
console.log('\nBy provider:');
Object.entries(provCount).sort((a, b) => b[1] - a[1]).forEach(([p, n]) => console.log(`  ${p.padEnd(30)} ${n}`));

// Preview first 5
console.log(`\n  ${'Date'.padEnd(12)}${'Provider'.padEnd(24)}${'Game Name'.padEnd(30)}Status`);
for (const r of games.slice(0, 5)) {
  console.log(`  ${r[0].padEnd(12)}${r[4].padEnd(24)}${r[3].slice(0, 29).padEnd(30)}${r[6]}`);
}
if (games.length > 5) console.log(`  … +${games.length - 5} more`);

if (WRITE) {
  // Clear tab and rewrite (header + data)
  await sheets.spreadsheets.values.clear({ spreadsheetId: OPS_ID, range: `'${TARGET_TAB}'!A:Z` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: OPS_ID,
    range: `'${TARGET_TAB}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADERS, ...games] },
  });
  console.log(`\n✅ Wrote ${games.length} games to '${TARGET_TAB}' (+ header).`);
} else {
  console.log(`\n(DRY RUN — nothing written. Re-run with --write to overwrite ${games.length} rows.)`);
}
