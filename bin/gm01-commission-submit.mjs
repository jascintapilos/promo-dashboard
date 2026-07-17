#!/usr/bin/env node
// GM01 (UNTUNG28) commission submission with auto session refresh.
// If session is missing or expired, spawns the Playwright capture window
// so you can enter the CAPTCHA, then continues automatically.
//
// Usage:
//   node bin/gm01-commission-submit.mjs \
//     --bonusType=turnover \
//     --submissionType=API,FISH \
//     --startDate="16-07-2026 23:55" \
//     --endDate="17-07-2026 23:45"
//
// Defaults (if omitted):
//   --memberLevel=all  --bonusType=turnover  --submissionType=API,FISH
//   --checkDeposit=yes  --startDate=<yesterday 00:00>  --endDate=<today 23:59>

import { readFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SESSION_FILE = path.join(ROOT, 'gm01-session.local.json');
const BASE = 'https://utn.bo5w.com';
const SESSION_MAX_AGE_HOURS = 7; // re-capture if older than this

// ── CLI args ──────────────────────────────────────────────────────────────────
const cliArgs = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) cliArgs[m[1]] = m[2] ?? true;
}

function todayStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

const memberLevel  = cliArgs.memberLevel  ?? '';           // '' = all
const bonusType    = (cliArgs.bonusType   ?? 'turnover').toLowerCase();
const submitTypes  = (cliArgs.submissionType ?? 'API,FISH').toUpperCase().split(',').map(s => s.trim());
const checkDeposit = (cliArgs.checkDeposit ?? 'yes') !== 'no';
const startDate    = cliArgs.startDate ?? `${todayStr(-1)} 00:00`;
const endDate      = cliArgs.endDate   ?? `${todayStr()} 23:59`;

const BONUS_TYPE_MAP = { turnover: '20', cashback: '10', referral: '30' };
const bonusTypeId = BONUS_TYPE_MAP[bonusType] ?? bonusType;

// Member level: form has no "All" — must loop each level individually
// searchGroupType values: 0=Normal, 10=VIP, 20=Silver, 30=Gold, 40=Platinum
const LEVEL_MAP = { normal: '0', vip: '10', silver: '20', gold: '30', platinum: '40' };
const ALL_LEVELS = Object.values(LEVEL_MAP);
const requestedLevel = (cliArgs.memberLevel ?? 'all').toLowerCase();
const levelsToRun = requestedLevel === 'all' ? ALL_LEVELS : [LEVEL_MAP[requestedLevel] ?? requestedLevel];

// Submission type: 100=API, 150=Fish
const SUBTYPE_MAP = { api: '100', fish: '150', 'poker g1': '120', 'poker g2': '130' };
const submitTypeCodes = submitTypes.map(t => SUBTYPE_MAP[t.toLowerCase()] ?? t);

// ── Session helpers ───────────────────────────────────────────────────────────
function loadSession() {
  if (!existsSync(SESSION_FILE)) return null;
  try { return JSON.parse(readFileSync(SESSION_FILE, 'utf8')); } catch { return null; }
}

function sessionAge(session) {
  if (!session?.capturedAt) return Infinity;
  return (Date.now() - new Date(session.capturedAt).getTime()) / 3_600_000;
}

function cookieHeader(session) {
  return session.cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

async function isSessionAlive(session) {
  try {
    const res = await fetch(`${BASE}/secure/home.xhtml`, {
      headers: { Cookie: cookieHeader(session) },
      redirect: 'manual',
    });
    return res.status !== 302 && res.status !== 301;
  } catch { return false; }
}

// ── Auto session capture ──────────────────────────────────────────────────────
function captureSession() {
  console.log('\n[session] Session missing or expired — launching capture window…');
  console.log('[session] → A Chrome window will open. Enter the CAPTCHA and click Login.');
  console.log('[session] → This script will continue automatically once the session is saved.\n');

  const captureScript = path.join(ROOT, 'bin', 'gm01-session-capture.mjs');
  const result = spawnSync(
    process.execPath,
    [captureScript, '--user=mgrutngabrielle', '--pass=Gabrielle123321'],
    { stdio: 'inherit', cwd: ROOT }
  );

  if (result.status !== 0) {
    console.error('[session] ✗ Session capture failed or was cancelled. Aborting.');
    process.exit(1);
  }
  console.log('[session] ✓ Session captured. Proceeding with submission…\n');
}

// ── Ensure valid session ──────────────────────────────────────────────────────
let session = loadSession();
const age = sessionAge(session);

if (!session || age > SESSION_MAX_AGE_HOURS || !(await isSessionAlive(session))) {
  captureSession();
  session = loadSession();
  if (!session) { console.error('[session] ✗ Session file not found after capture. Aborting.'); process.exit(1); }
} else {
  console.log(`✓ Session valid (captured ${age.toFixed(1)}h ago)\n`);
}

const cookie = cookieHeader(session);

// ── Submit ────────────────────────────────────────────────────────────────────
const LEVEL_LABELS = { '0': 'Normal', '10': 'VIP', '20': 'Silver', '30': 'Gold', '40': 'Platinum' };
const SUBTYPE_LABELS = { '100': 'API', '150': 'Fish', '120': 'Poker G1', '130': 'Poker G2' };

console.log('GM01 Commission Submission');
console.log('══════════════════════════');
console.log(`  Member levels   : ${requestedLevel === 'all' ? 'All (Normal/VIP/Silver/Gold/Platinum)' : requestedLevel}`);
console.log(`  Bonus type      : ${bonusType} (id=${bonusTypeId})`);
console.log(`  Submission types: ${submitTypes.join(', ')}`);
console.log(`  Check deposit   : ${checkDeposit ? 'Yes' : 'No'}`);
console.log(`  Date range      : ${startDate} → ${endDate}`);
console.log(`  Total runs      : ${levelsToRun.length} levels × ${submitTypeCodes.length} types = ${levelsToRun.length * submitTypeCodes.length}`);
console.log('');

const results = [];

for (const levelCode of levelsToRun) {
  for (const typeCode of submitTypeCodes) {
    const lvLabel = LEVEL_LABELS[levelCode] ?? levelCode;
    const tvLabel = SUBTYPE_LABELS[typeCode] ?? typeCode;
    process.stdout.write(`  [${lvLabel.padEnd(8)} / ${tvLabel.padEnd(4)}] Submitting… `);

    const body = new URLSearchParams({
      searchGroupType: levelCode,
      searchSettingType: bonusTypeId,
      searchSubmissionType: typeCode,
      searchCheckDepo: checkDeposit ? '1' : '0',
      searchDateFrom: startDate,
      searchDateTo: endDate,
    });

    const res = await fetch(`${BASE}/secure/credit/action/submit.incentive.xhtml`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      redirect: 'manual',
    });

    const loc = res.headers.get('location') ?? '';
    const success = (res.status === 302 || res.status === 303) && !loc.includes('error');
    const status = success ? 'SUCCESS' : 'ERROR';
    console.log(success ? '✓' : `✗ → ${loc}`);
    results.push({ level: lvLabel, submissionType: tvLabel, status });
    await new Promise(r => setTimeout(r, 300));
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n──────────────────────────────');
console.log('Summary');
console.log('──────────────────────────────');
const passed = results.filter(r => r.status === 'SUCCESS').length;
results.forEach(r => {
  const icon = r.status === 'SUCCESS' ? '✓' : '✗';
  console.log(`  ${icon} ${r.level.padEnd(10)} ${r.submissionType.padEnd(6)} ${r.status}`);
});
console.log(`\n  ${passed}/${results.length} submissions confirmed successful.`);
if (passed < results.length) {
  console.log('\n  ⚠ Some submissions failed. Ensure member level is specified and date range is in the past.');
}
