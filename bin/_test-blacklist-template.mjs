// Unit tests for src/blacklist-template.js — parseTemplateName.
// Run: node bin/_test-blacklist-template.mjs
// No test runner required.

import { parseTemplateName } from '../src/blacklist-template.js';
import assert from 'node:assert/strict';

let pass = 0;
let fail = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ✓  ${label}`);
    pass++;
  } catch (e) {
    console.error(`  ✗  ${label}`);
    console.error(`       ${e.message}`);
    fail++;
  }
}

function setEq(a, b) {
  if (a === 'ALL' || b === 'ALL') return a === b;
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function eq(a, want, label) {
  assert(setEq(a, want),
    `${label}: got ${a === 'ALL' ? 'ALL' : `{${[...a].sort().join(', ')}}`} ` +
    `expected ${want === 'ALL' ? 'ALL' : `{${[...want].sort().join(', ')}}`}`);
}

console.log('\n─── QPRO existing names (must not regress) ───');

test('All games → ALL', () =>
  assert(parseTemplateName('All games') === 'ALL'));

test('Slots Only → {SLOTS}', () =>
  eq(parseTemplateName('Slots Only'), new Set(['SLOTS']), 'Slots Only'));

test('Slots only (lowercase) → {SLOTS}', () =>
  eq(parseTemplateName('Slots only'), new Set(['SLOTS']), 'Slots only'));

test('Live Casino Only → {LIVE CASINO}', () =>
  eq(parseTemplateName('Live Casino Only'), new Set(['LIVE CASINO']), 'Live Casino Only'));

test('Live Casino Only (uppercase) → {LIVE CASINO}', () =>
  eq(parseTemplateName('Live Casino only'), new Set(['LIVE CASINO']), 'Live Casino only'));

test('"Live Casino and Slots" → {LIVE CASINO, SLOTS}', () =>
  eq(parseTemplateName('Live Casino and Slots'), new Set(['LIVE CASINO', 'SLOTS']), 'LC and Slots'));

test('"Live Casino and Slot" (singular) → {LIVE CASINO, SLOTS}', () =>
  eq(parseTemplateName('Live Casino and Slot'), new Set(['LIVE CASINO', 'SLOTS']), 'LC and Slot'));

test('"Slots, Live Casino, Sports" → {SLOTS, LIVE CASINO, SPORT}', () =>
  eq(parseTemplateName('Slots, Live Casino, Sports'), new Set(['SLOTS', 'LIVE CASINO', 'SPORT']), 'SLC'));

test('"Sports and Esports only" → {SPORT, E-SPORTS}', () =>
  eq(parseTemplateName('Sports and Esports only'), new Set(['SPORT', 'E-SPORTS']), 'Sports and Esports'));

test('"Sports only" → {SPORT}', () =>
  eq(parseTemplateName('Sports only'), new Set(['SPORT']), 'Sports only'));

test('"Esports Only" → {E-SPORTS}', () =>
  eq(parseTemplateName('Esports Only'), new Set(['E-SPORTS']), 'Esports Only'));

test('"Fishing only" → {FISHING}', () =>
  eq(parseTemplateName('Fishing only'), new Set(['FISHING']), 'Fishing only'));

test('"Crash only" → {CRASH}', () =>
  eq(parseTemplateName('Crash only'), new Set(['CRASH']), 'Crash only'));

test('"Sports and Esports Only" (capital O) → {SPORT, E-SPORTS}', () =>
  eq(parseTemplateName('Sports and Esports Only'), new Set(['SPORT', 'E-SPORTS']), 'Sports and Esports Only'));

console.log('\n─── QP2 name variants (new — must parse correctly) ───');

test('"Sports & Esports Only" (& separator) → {SPORT, E-SPORTS}', () =>
  eq(parseTemplateName('Sports & Esports Only'), new Set(['SPORT', 'E-SPORTS']), 'Sports & Esports Only'));

test('"Sports + Esports Only" (+ separator) → {SPORT, E-SPORTS}', () =>
  eq(parseTemplateName('Sports + Esports Only'), new Set(['SPORT', 'E-SPORTS']), 'Sports + Esports Only'));

test('"Crash game only" (QP2 wording) → {CRASH}', () =>
  eq(parseTemplateName('Crash game only'), new Set(['CRASH']), 'Crash game only'));

test('"Live Casino & Slots" (& separator) → {LIVE CASINO, SLOTS}', () =>
  eq(parseTemplateName('Live Casino & Slots'), new Set(['LIVE CASINO', 'SLOTS']), 'Live Casino & Slots'));

test('"Live Casino + Slots" (+ separator) → {LIVE CASINO, SLOTS}', () =>
  eq(parseTemplateName('Live Casino + Slots'), new Set(['LIVE CASINO', 'SLOTS']), 'Live Casino + Slots'));

test('"Slots & Live Casino & Sports" (multi &) → {SLOTS, LIVE CASINO, SPORT}', () =>
  eq(parseTemplateName('Slots & Live Casino & Sports'), new Set(['SLOTS', 'LIVE CASINO', 'SPORT']), 'Slots & LC & Sports'));

console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
