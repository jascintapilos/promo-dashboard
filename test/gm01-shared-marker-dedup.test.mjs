import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../bin/gm01-commission-submit.mjs', import.meta.url), 'utf8');

// Regression guard for the cross-VDI double-submission bug (found 2026-08-12):
// a run with even one failure used to write no shared marker at all, so the
// other VDI's backup run had no way to know what had already succeeded and
// re-submitted every combo — including ones already paid out.

test('marker write is keyed off cumulative successful keys, not zero-failure-only', () => {
  assert.match(source, /succeededKeysForMarker\.size > 0/);
  assert.doesNotMatch(source, /passed > 0 && failed === 0/);
});

test('marker status can be PARTIAL, not just SUCCESS', () => {
  assert.match(source, /'PARTIAL'/);
  assert.match(source, /allDone \? 'SUCCESS' : 'PARTIAL'/);
});

test('a failed submission sets a non-zero exit code', () => {
  assert.match(source, /if \(failed > 0\)[\s\S]{0,400}process\.exitCode = 1;/);
});

test('the shared-marker read happens before the local already-submitted early-exit', () => {
  const markerCheckIdx = source.indexOf('readMarker(runDate)');
  const localExitIdx = source.indexOf('allKeys.every(k => ledger[k])');
  assert.ok(markerCheckIdx > -1, 'expected a readMarker(runDate) call');
  assert.ok(localExitIdx > -1, 'expected the local already-submitted early-exit check');
  assert.ok(
    markerCheckIdx < localExitIdx,
    'the shared marker must be read (and its keys merged into the local ledger) BEFORE the ' +
    'local early-exit check, or a PARTIAL marker\'s already-successful combos never get skipped'
  );
});

test('a PARTIAL marker\'s combo keys get merged into the local ledger, not just a SUCCESS marker', () => {
  assert.match(source, /marker\.combo_keys_ok/);
  assert.match(source, /if \(!ledger\[k\]\) ledger\[k\] = marker\.timestamp;/);
});

// Regression guard for the start-of-run race (found by strategic-design-advisor
// 2026-08-13): if the primary hangs at CAPTCHA and writes no marker, backup
// used to run and double-submit. Fix — primary writes a RUNNING marker BEFORE
// authentication, backup exits if it sees one within RUNNING_STALE_MS.

test('a fresh RUNNING marker blocks the run to prevent double-submit', () => {
  assert.match(source, /RUNNING_STALE_MS/);
  assert.match(source, /marker\.status === 'RUNNING'/);
  assert.match(source, /ANOTHER RUN IN PROGRESS/);
});

test('a stale RUNNING marker (> RUNNING_STALE_MS old) does not block the run', () => {
  assert.match(source, /Stale RUNNING marker/);
  assert.match(source, /treating as abandoned/);
});

test('the RUNNING marker is written BEFORE authentication', () => {
  const runningWriteIdx = source.indexOf("status: 'RUNNING'");
  // Match the CALL site (`await ensureAuthenticated(`), not the import line —
  // otherwise the import at the top of the file trivially precedes everything
  // and the test always passes even if the write actually happens after auth.
  const authCallIdx = source.indexOf('await ensureAuthenticated(');
  assert.ok(runningWriteIdx > -1, "expected a writeMarker call with status 'RUNNING'");
  assert.ok(authCallIdx > -1, 'expected an await ensureAuthenticated(...) call');
  assert.ok(
    runningWriteIdx < authCallIdx,
    'RUNNING marker must be written BEFORE authentication so a CAPTCHA hang still leaves a signal'
  );
});

test('a run that crashes writes a FAILED marker so the RUNNING row does not stay latest', () => {
  assert.match(source, /status: 'FAILED'/);
  assert.match(source, /catch \(err\)[\s\S]{0,2000}writeMarker[\s\S]{0,300}'FAILED'/);
});
