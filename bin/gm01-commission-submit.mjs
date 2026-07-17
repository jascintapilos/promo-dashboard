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

import { BASE, ensureAuthenticated, failScreenshot } from '../src/gm01-session.js';

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

// Login credentials for the interactive fallback (typed into the form only).
const USER = cliArgs.user ?? 'mgrutngabrielle';
const PASS = cliArgs.pass ?? '***REMOVED***';

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
  for (const levelCode of levelsToRun) {
    for (const typeCode of submitTypeCodes) {
      const lvLabel = LEVEL_LABELS[levelCode] ?? levelCode;
      const tvLabel = SUBTYPE_LABELS[typeCode] ?? typeCode;
      process.stdout.write(`  [${lvLabel.padEnd(8)} / ${tvLabel.padEnd(4)}] Submitting… `);

      // Request through the authenticated context — Playwright applies the
      // saved session cookies; we never read or attach them ourselves.
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
      results.push({ level: lvLabel, submissionType: tvLabel, status: success ? 'SUCCESS' : 'ERROR' });
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log('\n──────────────────────────────');
  console.log('Summary');
  console.log('──────────────────────────────');
  const passed = results.filter(r => r.status === 'SUCCESS').length;
  results.forEach(r => {
    console.log(`  ${r.status === 'SUCCESS' ? '✓' : '✗'} ${r.level.padEnd(10)} ${r.submissionType.padEnd(6)} ${r.status}`);
  });
  console.log(`\n  ${passed}/${results.length} submissions confirmed successful.`);
  if (passed < results.length) {
    console.log('\n  ⚠ Some submissions failed. Ensure the date range is in the past.');
  }
} catch (err) {
  console.error(`\n✗ Submission run failed: ${err.message}`);
  await failScreenshot(context, 'submit-error');
  await browser.close().catch(() => {});
  process.exit(1);
}

await browser.close();
