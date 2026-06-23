/**
 * Auto-promote reviewed BO auto-pull rows into the live reporting tabs that
 * the dashboard reads. This is "Option C": the bot copies staging → reporting
 * by itself, dropping obvious junk (test/canary/dummy codes), so the dashboard
 * shows live data with no manual review step.
 *
 *   STAGING                        →  REPORTING (read by dashboard)
 *   'BO Auto-pull (Promo)'  (A:H)  →  'Promo Code Log'  (A:G)   [drops "Pulled at"]
 *   'BO Auto-pull (Banner)' (A:I)  →  'Banner Log'      (A:G)   [drops Uploaded[0] + Pulled at[8]]
 *
 * Idempotent: dedupes against rows already in the reporting tab.
 *   Promo  key = code|||brand
 *   Banner key = title|||brand|||start
 *
 * Junk filter (safety net — the pull already strips TEST_ at pull time):
 *   skips codes/titles matching JUNK_RX below.
 *   NOTE: does NOT filter on "Created By" — the pull stamps every auto-pulled
 *   promo with 'promo test bot' because the BO API has no real creator field,
 *   so that column is not a junk signal.
 *
 * DRY RUN by default — prints what it WOULD copy. Pass --write to commit.
 *
 * Usage:
 *   node bin/promote-staging.mjs            # dry run
 *   node bin/promote-staging.mjs --write    # copy clean rows into reporting tabs
 */
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const WRITE = flags.write === true;

const SHEET_ID = getOpsSheetId();

// Obvious non-production codes/titles. Pull already excludes /^TEST_/i, so this
// is a belt-and-suspenders net for anything that slips through.
const JUNK_RX = /(^|[_\s])(TEST|CANARY|DUMMY|SAMPLE|DEMO|QC|XXX|ABC123)([_\s]|$)/i;

// NOTE: Promos are no longer promoted here. 'Promo Code Log' is rewritten in
// full each run by bin/pull-bo-ytd.mjs (team-filtered, real creators, all
// statuses, YTD). Promoting last-7-day staging promos on top of that would
// re-introduce placeholder creators and non-team rows, so this job handles
// banners only.
const JOBS = [
  {
    label: 'Banner',
    staging: 'BO Auto-pull (Banner)',
    reporting: 'Banner Log',
    // Staging cols: [0]Uploaded [1]Start [2]Brand [3]Region [4]Banner Title [5]End [6]Status [7]Uploaded By [8]Pulled at
    // Report cols:  [0]Start    [1]Brand [2]Region [3]Banner Title [4]End    [5]Status [6]Uploaded By
    toReport: (r) => r.slice(1, 8),   // drop Uploaded[0] and Pulled at[8]
    reportCols: 7,    // A:G
    junkField: 4,     // Banner Title is at index 4 in staging
    stagingKey: (r) => `${(r[4] || '').trim()}|||${(r[2] || '').trim()}|||${(r[1] || '').trim()}`, // title[4]|||brand[2]|||start[1]
    reportKey:  (r) => `${(r[3] || '').trim()}|||${(r[1] || '').trim()}|||${(r[0] || '').trim()}`, // title[3]|||brand[1]|||start[0]
  },
];

const { sheets } = await getSheetsClient();

async function readRows(tab) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${tab}'!A:Z`,
    });
    return res.data.values || [];
  } catch {
    return []; // tab may not exist yet
  }
}

console.log(`\nPromote staging → reporting  (${WRITE ? 'WRITE' : 'DRY RUN'})`);
console.log('─'.repeat(72));

let grandTotal = 0;

for (const job of JOBS) {
  const stagingRows = await readRows(job.staging);
  const reportRows = await readRows(job.reporting);

  // Drop header rows (first row of each is the header).
  const stageData = stagingRows.slice(1).filter((r) => r && r.some((c) => String(c).trim()));
  const reportData = reportRows.slice(1).filter((r) => r && r.some((c) => String(c).trim()));

  const reportKeyFn  = job.reportKey  || job.key;
  const stagingKeyFn = job.stagingKey || job.key;
  const toReport     = job.toReport   || ((r) => r.slice(0, job.reportCols));

  const known = new Set(reportData.map(reportKeyFn));

  const fresh = [];
  let junk = 0;
  let dupes = 0;
  for (const r of stageData) {
    const probe = String(r[job.junkField] || '');
    if (JUNK_RX.test(probe)) { junk++; continue; }
    if (known.has(stagingKeyFn(r))) { dupes++; continue; }
    known.add(stagingKeyFn(r));
    fresh.push(toReport(r));
  }

  console.log(
    `\n${job.label.padEnd(7)} ${job.staging} → ${job.reporting}` +
    `\n  staging rows: ${stageData.length} · already in log: ${dupes} · junk skipped: ${junk} · NEW: ${fresh.length}`
  );

  if (fresh.length && WRITE) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `'${job.reporting}'!A:${String.fromCharCode(64 + job.reportCols)}`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: fresh },
    });
    console.log(`  ✅ Appended ${fresh.length} rows to '${job.reporting}'.`);
  }

  grandTotal += fresh.length;
}

console.log('\n' + '─'.repeat(72));
if (!WRITE) {
  console.log(`(DRY RUN — nothing written. Re-run with --write to promote ${grandTotal} new rows.)`);
} else {
  console.log(`Done. Promoted ${grandTotal} new rows into the reporting tabs.`);
}
