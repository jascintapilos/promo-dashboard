// Increment 1 regression: the Pass button in public/qc-hub/app.js must only
// be enabled for auto-SAFE. MANUAL_REQUIRED must NOT enable Pass — that path
// is exactly the R20 shortcut we're reverting because it would silently
// promote MANUAL_REQUIRED into a PASS record without live BO evidence.
//
// Static-audit style (matches R15's XSS test pattern) — reads the source and
// asserts the exact gate expression. Locks the fix in so a future edit can't
// silently re-enable the shortcut.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const APP_JS = readFileSync(path.resolve(process.cwd(), 'public/qc-hub/app.js'), 'utf8');

test('Increment 1: passBtn.disabled gate is auto-SAFE only', () => {
  // The reverted gate: $('passBtn').disabled = data.verdict !== 'SAFE';
  assert.ok(
    /\$\('passBtn'\)\.disabled\s*=\s*data\.verdict\s*!==\s*'SAFE'\s*;/.test(APP_JS),
    'passBtn.disabled must gate on data.verdict !== \'SAFE\' only — MANUAL_REQUIRED must not enable Pass',
  );
});

test('Increment 1: no code path enables Pass for MANUAL_REQUIRED', () => {
  // The R20 shortcut we removed: `!== 'SAFE' && data.verdict !== 'MANUAL_REQUIRED'`.
  // Any reintroduction of that exact pattern re-opens the invariant hole.
  assert.equal(
    /passBtn['"\)\]]*.disabled\s*=\s*[\s\S]{0,120}MANUAL_REQUIRED/.test(APP_JS),
    false,
    'Pass button gate must not reference MANUAL_REQUIRED — that would allow automated PASS without live BO evidence',
  );
});

test('Increment 1: verdictLabel treats MANUAL_PASS as distinct from PASS/MANUAL', () => {
  assert.ok(APP_JS.includes(`if (v === 'MANUAL_PASS') return 'MANUAL PASS';`), 'MANUAL_PASS must render as "MANUAL PASS" label');
});

test('Increment 1: verdictWords for MANUAL_REQUIRED describes the invariant, not a workaround', () => {
  // Copy must make clear WHY it's manual — live BO evidence unavailable —
  // rather than framing it as "you can still pass".
  assert.ok(
    APP_JS.includes(`MANUAL REVIEW REQUIRED - LIVE BO EVIDENCE UNAVAILABLE`),
    'MANUAL_REQUIRED verdict copy must reference the missing-live-BO-evidence invariant',
  );
});

test('Increment 1: MANUAL_PASS verdict words indicate override, not automated pass', () => {
  assert.ok(
    APP_JS.includes(`MANUAL PASS OVERRIDE RECORDED`),
    'MANUAL_PASS copy must make clear it is an override, not an automated pass',
  );
});
