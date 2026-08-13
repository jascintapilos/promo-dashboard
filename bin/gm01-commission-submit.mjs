#!/usr/bin/env node
// GM01 (UNTUNG28) commission submission.
//
// Reuses a saved, authorized Playwright session (storageState). On the first
// run — or when the session has expired — it PAUSES and opens a visible browser
// for you to log in and complete the CAPTCHA yourself, then continues. It never
// solves, bypasses, or outsources the CAPTCHA. All requests go through the
// authenticated browser context, so cookies are applied by Playwright and never
// handled by hand. Nothing secret is printed.
//
// Usage:
//   node bin/gm01-commission-submit.mjs \
//     --submissionType=API,FISH \
//     --startDate="16-07-2026 00:00" \
//     --endDate="16-07-2026 23:59"
//
// Defaults:
//   --memberLevel=all  --bonusType=turnover  --submissionType=API,FISH
//   --checkDeposit=yes  --startDate=<yesterday 00:00>  --endDate=<yesterday 23:59>

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { BASE, ensureAuthenticated, failScreenshot } from '../src/gm01-session.js';
import { readMarker, writeMarker, getRole, loadMarkerConfig } from '../src/gm01-shared-marker.js';

const ROOT        = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER_FILE = path.join(ROOT, 'gm01-submit-ledger.local.json');
const CREDS_FILE  = path.join(ROOT, 'gm01-credentials.local.json');
const DEAD_FLAG   = path.join(ROOT, 'gm01-session-dead.local.json');

// Load credentials from local file (gitignored); CLI args override for one-off use.
function loadCredentials() {
  if (existsSync(CREDS_FILE)) {
    try { return JSON.parse(readFileSync(CREDS_FILE, 'utf8')); } catch { /* fall through */ }
  }
  return {};
}

// ── CLI args ────────────────────────────────────────────────────────────────
const cliArgs = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) cliArgs[m[1]] = m[2] ?? true;
}

function dayStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}

const bonusType    = (cliArgs.bonusType ?? 'turnover').toLowerCase();
const submitTypes  = (cliArgs.submissionType ?? 'API,FISH').split(',').map(s => s.trim());
const checkDeposit = (cliArgs.checkDeposit ?? 'yes') !== 'no';
const startDate    = cliArgs.startDate ?? `${dayStr(-1)} 00:00`;
const endDate      = cliArgs.endDate   ?? `${dayStr(-1)} 23:59`;

// Credentials: local file first, CLI args override, hard-fail if neither present.
const savedCreds = loadCredentials();
const USER = cliArgs.user ?? savedCreds.user;
const PASS = cliArgs.pass ?? savedCreds.pass;
if (!USER || !PASS) {
  console.error('✗ No credentials found.');
  console.error(`  Create ${CREDS_FILE} with {"user":"...","pass":"..."}`);
  console.error('  or pass --user=<u> --pass=<p> on the command line.');
  process.exit(1);
}

if (existsSync(DEAD_FLAG)) {
  console.error('✗ Session is dead — re-capture before submitting.');
  console.error('  node bin/gm01-session-capture.mjs');
  process.exit(1);
}

const BONUS_TYPE_MAP = { turnover: '20', cashback: '10', referral: '30' };
const bonusTypeId = BONUS_TYPE_MAP[bonusType] ?? bonusType;

// Member level has no "All" option — each level must be its own submission.
const LEVEL_MAP = { normal: '0', vip: '10', silver: '20', gold: '30', platinum: '40' };
const requestedLevel = (cliArgs.memberLevel ?? 'all').toLowerCase();
const levelsToRun = requestedLevel === 'all'
  ? Object.values(LEVEL_MAP)
  : [LEVEL_MAP[requestedLevel] ?? requestedLevel];

const SUBTYPE_MAP = { api: '100', fish: '150', 'poker g1': '120', 'poker g2': '130' };
const submitTypeCodes = submitTypes.map(t => SUBTYPE_MAP[t.toLowerCase()] ?? t);

const LEVEL_LABELS = { '0': 'Normal', '10': 'VIP', '20': 'Silver', '30': 'Gold', '40': 'Platinum' };
const SUBTYPE_LABELS = { '100': 'API', '150': 'Fish', '120': 'Poker G1', '130': 'Poker G2' };

// ── Duplicate-submission guard (per-submission) ──────────────────────────────
// Key includes bonusTypeId, dates, levelCode, typeCode, and checkDeposit so that
// a Normal-only run never blocks an All-levels run, and partial re-runs only
// skip the combos that already succeeded.
//
// --force requires the exact run date (DD-MM-YYYY) to prevent accidental replay:
//   --force=29-07-2026   ← only accepted if startDate begins with that date
//   --force              ← rejected (no date = no proof of intent)

const forceArg = cliArgs.force;
const runDate  = startDate.split(' ')[0]; // "DD-MM-YYYY" portion of startDate

if (forceArg !== undefined) {
  if (forceArg === true || forceArg !== runDate) {
    console.error('✗ --force requires the exact run date to prevent accidental double-submission.');
    console.error(`  Use: --force=${runDate}`);
    process.exit(1);
  }
}
const force = forceArg === runDate;

function loadLedger() {
  if (!existsSync(LEDGER_FILE)) return {};
  try { return JSON.parse(readFileSync(LEDGER_FILE, 'utf8')); } catch { return {}; }
}
function submissionKey(levelCode, typeCode) {
  return `${bonusTypeId}|${startDate}|${endDate}|${levelCode}|${typeCode}|${checkDeposit ? '1' : '0'}`;
}
function recordSubmission(key) {
  const l = loadLedger();
  l[key] = new Date().toISOString();
  writeFileSync(LEDGER_FILE, JSON.stringify(l, null, 2));
}

const ledger = loadLedger();
const allKeys = levelsToRun.flatMap(lv => submitTypeCodes.map(tc => submissionKey(lv, tc)));

// ── Shared-marker check (cross-VDI dedup) ─────────────────────────────────────
// Read BEFORE the local "already submitted" check below, so a PARTIAL marker's
// already-successful keys get merged into this run's ledger and are correctly
// skipped — not just a full-SUCCESS marker, which was the original gap: a run
// with even one failure wrote no marker at all, so the other VDI re-attempted
// every combo, including ones already paid out.
//
// Also handles the start-of-run race: if the primary is actively running (RUNNING
// marker within the last RUNNING_STALE_MS), backup exits to avoid double-submit.
// Otherwise a primary stuck at CAPTCHA writes nothing and backup would happily
// re-submit every combo — the exact double-payout scenario this file exists to
// prevent.
const RUNNING_STALE_MS = 25 * 60 * 1000; // 25 min — shorter than the 30-min stagger
const role = getRole();
if (loadMarkerConfig() && !force) {
  try {
    const marker = await readMarker(runDate);
    if (marker && marker.status === 'SUCCESS') {
      console.log(`✓ ALREADY SUBMITTED cross-VDI — ${marker.machine} (${marker.role}) succeeded at ${marker.timestamp.slice(0, 19)}.`);
      console.log(`  ${marker.combos_ok} combos ok, ${marker.combos_err} errors. Skipping to prevent double payout.`);
      process.exit(0);
    }
    if (marker && marker.status === 'RUNNING') {
      const ageMs = Date.now() - new Date(marker.timestamp).getTime();
      if (ageMs < RUNNING_STALE_MS) {
        console.log(`⚠ ANOTHER RUN IN PROGRESS — ${marker.machine} (${marker.role}) started ${Math.round(ageMs/60000)} min ago.`);
        console.log('  Skipping to avoid double-submission. If that run has actually failed, wait 25 min and re-run.');
        process.exit(0);
      } else {
        console.log(`⚠ Stale RUNNING marker from ${marker.machine} (${marker.role}, ${Math.round(ageMs/60000)} min ago) — treating as abandoned and proceeding.`);
      }
    }
    if (marker && marker.combo_keys_ok?.length) {
      for (const k of marker.combo_keys_ok) {
        if (!ledger[k]) ledger[k] = marker.timestamp;
      }
      console.log(`  (merged ${marker.combo_keys_ok.length} already-successful combo(s) from ${marker.machine}/${marker.role})`);
    }
  } catch (err) {
    console.warn(`⚠ Shared marker read failed: ${err.message} — proceeding without cross-VDI check.`);
  }
}

if (force) {
  const alreadyDone = allKeys.filter(k => ledger[k]);
  if (alreadyDone.length > 0) {
    console.warn('⚠ ──────────────────────────────────────────────────────────');
    console.warn('⚠  FORCE MODE — re-submitting already-ledgered combos:');
    alreadyDone.forEach(k => console.warn(`⚠    ${k}  (was: ${ledger[k].slice(0, 19)})`));
    console.warn('⚠ ──────────────────────────────────────────────────────────');
    console.warn('');
  }
}

// Exit early only if every combo in this run is already recorded.
if (!force && allKeys.every(k => ledger[k])) {
  console.log('⚠ ALREADY SUBMITTED — all combos for this run are in the ledger.');
  console.log(`  ${bonusType} | ${startDate} → ${endDate} | ${submitTypes.join(', ')}`);
  console.log('  Re-run with --force to submit again.');
  process.exit(2);
}

// ── Write RUNNING marker BEFORE authentication ───────────────────────────────
// Authentication can hang on a CAPTCHA challenge (visible browser opens waiting
// for a human). Without this write, a stuck primary leaves NO marker at all —
// backup then treats the day as unsubmitted and double-pays. Seed the marker
// with whatever keys are already known-successful (local ledger + merged from
// the other VDI) so the cumulative record survives if this run also fails.
const seededKeys = allKeys.filter(k => ledger[k]);
if (loadMarkerConfig() && !force) {
  try {
    await writeMarker(runDate, {
      role,
      status: 'RUNNING',
      combosOk: seededKeys.length,
      combosErr: allKeys.length - seededKeys.length,
      comboKeysOk: seededKeys,
    });
    console.log(`  ⏵ Shared marker written (${role}, RUNNING).`);
  } catch (err) {
    console.warn(`  ⚠ RUNNING marker write failed: ${err.message} — cross-VDI dedup degraded for this run.`);
  }
}

// ── Authenticate (reuse saved state; pause for manual login if expired) ───────
const { browser, context } = await ensureAuthenticated({ user: USER, pass: PASS });

try {
  console.log('GM01 Commission Submission');
  console.log('══════════════════════════');
  console.log(`  Member levels   : ${requestedLevel === 'all' ? 'All (Normal/VIP/Silver/Gold/Platinum)' : requestedLevel}`);
  console.log(`  Bonus type      : ${bonusType} (id=${bonusTypeId})`);
  console.log(`  Submission types: ${submitTypes.join(', ')}`);
  console.log(`  Check deposit   : ${checkDeposit ? 'Yes' : 'No'}`);
  console.log(`  Date range      : ${startDate} → ${endDate}`);
  console.log(`  Total runs      : ${levelsToRun.length} × ${submitTypeCodes.length} = ${levelsToRun.length * submitTypeCodes.length}`);
  console.log('');

  const results = [];
  // Seeded with everything already known-successful (this machine's own prior
  // runs + whatever was merged in from the other VDI's marker above) so the
  // marker written at the end always carries the full cumulative picture,
  // not just this run's own contribution.
  const succeededKeysForMarker = new Set(allKeys.filter(k => ledger[k]));
  for (const levelCode of levelsToRun) {
    for (const typeCode of submitTypeCodes) {
      const lvLabel = LEVEL_LABELS[levelCode] ?? levelCode;
      const tvLabel = SUBTYPE_LABELS[typeCode] ?? typeCode;
      const key = submissionKey(levelCode, typeCode);

      // Skip combos already in the ledger (from a previous partial run).
      if (!force && ledger[key]) {
        const when = ledger[key].slice(0, 10);
        console.log(`  [${lvLabel.padEnd(8)} / ${tvLabel.padEnd(4)}] SKIPPED — already submitted ${when}`);
        results.push({ level: lvLabel, submissionType: tvLabel, status: 'SKIPPED' });
        continue;
      }

      process.stdout.write(`  [${lvLabel.padEnd(8)} / ${tvLabel.padEnd(4)}] Submitting… `);

      const res = await context.request.post(
        `${BASE}/secure/credit/action/submit.incentive.xhtml`,
        {
          form: {
            searchGroupType: levelCode,
            searchSettingType: bonusTypeId,
            searchSubmissionType: typeCode,
            searchCheckDepo: checkDeposit ? '1' : '0',
            searchDateFrom: startDate,
            searchDateTo: endDate,
          },
          maxRedirects: 0,
          timeout: 20_000,
        }
      );

      const loc = res.headers()['location'] ?? '';
      const success = (res.status() === 302 || res.status() === 303) && !loc.includes('error');
      console.log(success ? '✓' : `✗ (${res.status()} → ${loc || 'no redirect'})`);

      // Record immediately on success so a partial failure doesn't lose completed work.
      if (success) { recordSubmission(key); succeededKeysForMarker.add(key); }

      results.push({ level: lvLabel, submissionType: tvLabel, status: success ? 'SUCCESS' : 'ERROR' });
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log('\n──────────────────────────────');
  console.log('Summary');
  console.log('──────────────────────────────');
  const passed  = results.filter(r => r.status === 'SUCCESS').length;
  const skipped = results.filter(r => r.status === 'SKIPPED').length;
  const failed  = results.filter(r => r.status === 'ERROR').length;
  results.forEach(r => {
    const icon = r.status === 'SUCCESS' ? '✓' : r.status === 'SKIPPED' ? '–' : '✗';
    console.log(`  ${icon} ${r.level.padEnd(10)} ${r.submissionType.padEnd(6)} ${r.status}`);
  });
  console.log(`\n  ${passed} submitted, ${skipped} skipped, ${failed} failed.`);
  if (failed > 0) {
    console.log('\n  ⚠ Some submissions failed. Re-run to retry only the failed combos.');
    // Non-zero so Task Scheduler's retry policy and the operator both see
    // that this run needs attention — a partial failure used to exit 0.
    process.exitCode = 1;
  }

  // ── Write shared marker (cross-VDI dedup) ──────────────────────────────────
  // Cumulative across both VDIs: status is SUCCESS only once every combo for
  // today is accounted for (merged-in + this run's own), else PARTIAL — so a
  // run with some failures still records what DID succeed, and the other
  // VDI's next run (or this machine's own retry) picks up only what's left,
  // instead of silently writing nothing and re-attempting everything.
  if (loadMarkerConfig() && succeededKeysForMarker.size > 0) {
    const allDone = succeededKeysForMarker.size === allKeys.length;
    try {
      await writeMarker(runDate, {
        role,
        status: allDone ? 'SUCCESS' : 'PARTIAL',
        combosOk: succeededKeysForMarker.size,
        combosErr: allKeys.length - succeededKeysForMarker.size,
        comboKeysOk: [...succeededKeysForMarker],
      });
      console.log(`  ${allDone ? '✓' : '⚠'} Shared marker written (${role}, ${allDone ? 'SUCCESS' : 'PARTIAL'}).`);
    } catch (err) {
      console.warn(`  ⚠ Shared marker write failed: ${err.message}`);
    }
  }
} catch (err) {
  console.error(`\n✗ Submission run failed: ${err.message}`);
  await failScreenshot(context, 'submit-error');
  // Write FAILED marker so the RUNNING row we wrote pre-auth doesn't stay as
  // the latest status and block the other VDI's backup run. Preserves whatever
  // combos DID succeed before the crash so those don't get re-submitted.
  if (loadMarkerConfig()) {
    const doneKeys = allKeys.filter(k => ledger[k]);
    try {
      await writeMarker(runDate, {
        role,
        status: 'FAILED',
        combosOk: doneKeys.length,
        combosErr: allKeys.length - doneKeys.length,
        comboKeysOk: doneKeys,
      });
      console.error(`  ⚠ Shared marker written (${role}, FAILED).`);
    } catch (mErr) {
      console.warn(`  ⚠ FAILED marker write failed: ${mErr.message}`);
    }
  }
  await browser.close().catch(() => {});
  process.exit(1);
}

await browser.close();
