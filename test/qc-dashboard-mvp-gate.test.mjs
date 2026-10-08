// Increment 8 (real-QC upgrade): brand rollout gate — MVP-only compare path.
//
// Locks in two invariants:
//
// 1. data/qc-dashboard-brands.json declares exactly the 10 MVP brands the
//    brief specified: QP2A, QP2B, QP2C, QP2D, QPRO1, QPRO5, WS1_MY. Adding an 8th silently
//    would put a brand under a comparator that hasn't been validated for
//    its platform quirks — every future MVP addition must show up in a
//    diff and pass this test explicitly.
//
// 2. bin/qc-dashboard.mjs only calls runComparisonWithSheetsFallback() when the selected
//    brand has qcRules.mvp === true. A future refactor that inlines the
//    call or drops the gate would silently expose non-MVP brands to a
//    comparator wired against unvalidated platform paths.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadQcBrandConfig } from '../src/qc-dashboard/brand-config.js';

const DASHBOARD_JS = readFileSync(path.resolve(process.cwd(), 'bin/qc-dashboard.mjs'), 'utf8');

test('Increment 8: MVP brand set is exactly QP2A-D / QPRO1,3,4,5,8 / WS1_MY', () => {
  const brands = loadQcBrandConfig();
  const mvp = brands.filter((b) => b.qcRules?.mvp === true).map((b) => b.id).sort();
  assert.deepEqual(mvp, ['QP2A', 'QP2B', 'QP2C', 'QP2D', 'QPRO1', 'QPRO3', 'QPRO4', 'QPRO5', 'QPRO8', 'WS1_MY']);
});

test('Increment 8: enabled brand set matches the MVP set', () => {
  // buildBrandList's `enabled` flag is what /api/brands surfaces to the UI —
  // it should be the same set the compare engine runs against.
  const brands = loadQcBrandConfig();
  const enabled = brands.filter((b) => b.enabled).map((b) => b.id).sort();
  assert.deepEqual(enabled, ['QP2A', 'QP2B', 'QP2C', 'QP2D', 'QPRO1', 'QPRO3', 'QPRO4', 'QPRO5', 'QPRO8', 'WS1_MY']);
});

test('Increment 8: compare engine call in /api/run-qc is gated by isMvpBrand', () => {
  // Any refactor must keep the compare invocation inside the `if (isMvpBrand)`
  // block. Ripgrep-style static check: the runComparisonWithSheetsFallback call must be
  // preceded (within 400 chars) by a `isMvpBrand` conditional.
  const runIx = DASHBOARD_JS.indexOf('runComparisonWithSheetsFallback(');
  assert.notEqual(runIx, -1, 'runComparisonWithSheetsFallback call missing from bin/qc-dashboard.mjs');
  const preContext = DASHBOARD_JS.slice(Math.max(0, runIx - 400), runIx);
  assert.match(
    preContext,
    /if\s*\(\s*isMvpBrand\s*\)/,
    'runComparisonWithSheetsFallback() must be inside an `if (isMvpBrand)` gate — non-MVP brands must not run the compare engine',
  );
});

test('Increment 8: isMvpBrand is derived from qcRules.mvp === true, not a hard-coded list', () => {
  assert.match(
    DASHBOARD_JS,
    /const\s+isMvpBrand\s*=\s*selected\.qcRules\?\.mvp\s*===\s*true/,
    'isMvpBrand must be derived from the brand config so operators can extend the MVP by editing data/qc-dashboard-brands.json — not by patching code',
  );
});
