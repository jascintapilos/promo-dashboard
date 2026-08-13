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
