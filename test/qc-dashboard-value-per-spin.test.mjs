// Blocker: QPRO/QP2 Free Spin value-per-spin unit conversion.
//
// Direct comparison of source.value_per_spin against BO's amount_per_line
// produced a false FAIL (0.40 vs 0.02 for PP games where lines_per_spin=20).
// Adapters now derive valuePerSpin = amount_per_line × lines_per_spin using
// the same resolver the canary uses (src/fs-lines-resolver.js).

import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveValuePerSpin } from '../src/qc-dashboard/canonical/value-per-spin.js';
import { liveFromQpro } from '../src/qc-dashboard/canonical/qpro-adapter.js';
import { liveFromQp2 } from '../src/qc-dashboard/canonical/qp2-adapter.js';
import { expectedFromSource } from '../src/qc-dashboard/canonical/expected-adapter.js';
import { compare } from '../src/qc-dashboard/compare-engine.js';
import { _resetCatalogCache } from '../src/fs-lines-resolver.js';

test.beforeEach(() => _resetCatalogCache());

// ── Derivation table ────────────────────────────────────────────────────

test('derive: normal PP conversion — 0.02 × 20 = 0.40 via game-code catalog', () => {
  const r = deriveValuePerSpin({
    pc: { currency: 'MYR', amount_per_line: 0.02, lines: 0 },
    detail: { free_spin_game_code: 'vs20olympgate' },
    platform: 'qp2',
  });
  assert.equal(r.valuePerSpin, 0.4);
  assert.equal(r.linesPerSpin, 20);
  assert.equal(r.source, 'game-code');
  assert.equal(r.inconclusive, false);
  assert.match(r.note, /value-per-spin = 0\.02 × 20/);
});

test('derive: decimal rounding — 0.03 × 20 = 0.60 (avoid 0.6000000001)', () => {
  const r = deriveValuePerSpin({
    pc: { currency: 'MYR', amount_per_line: 0.03, lines: 0 },
    detail: { free_spin_game_code: 'vs20olympgate' },
    platform: 'qp2',
  });
  assert.equal(r.valuePerSpin, 0.6);
});

test('derive: QPRO uses row-lines (operator standard 10), no game-code lookup needed', () => {
  const r = deriveValuePerSpin({
    pc: { currency: 'MYR', amount_per_line: 0.04, lines: 10 },
    detail: {}, // no game_code — the row-lines path wins
    platform: 'qpro',
  });
  assert.equal(r.valuePerSpin, 0.4);
  assert.equal(r.linesPerSpin, 10);
  assert.equal(r.source, 'row-lines');
});

test('derive: Playtech gpas_*_pop convention → lines_per_spin = 1', () => {
  const r = deriveValuePerSpin({
    pc: { currency: 'MYR', amount_per_line: 0.5, lines: 0 },
    detail: { free_spin_game_code: 'gpas_gwizard_pop' },
    platform: 'qp2',
  });
  assert.equal(r.valuePerSpin, 0.5);
  assert.equal(r.linesPerSpin, 1);
  assert.equal(r.source, 'playtech-1');
});

test('derive: amount_per_line missing → inconclusive with clear note (row-lines path)', () => {
  const r = deriveValuePerSpin({
    pc: { currency: 'MYR', lines: 10 },
    detail: {},
    platform: 'qpro',
  });
  assert.equal(r.valuePerSpin, null);
  assert.equal(r.linesPerSpin, 10);
  assert.equal(r.inconclusive, true);
  assert.match(r.note, /amount_per_line missing/);
});

test('derive: missing game_code + row lines=0 → inconclusive (no false PASS or FAIL)', () => {
  const r = deriveValuePerSpin({
    pc: { currency: 'MYR', amount_per_line: 0.05, lines: 0 },
    detail: {},
    platform: 'qp2',
  });
  assert.equal(r.valuePerSpin, null);
  assert.equal(r.linesPerSpin, null);
  assert.equal(r.source, null);
  assert.equal(r.inconclusive, true);
  assert.match(r.note, /no free_spin_game_code/);
});

test('derive: unknown game_code not in catalog → inconclusive with specific reason', () => {
  const r = deriveValuePerSpin({
    pc: { currency: 'MYR', amount_per_line: 0.05, lines: 0 },
    detail: { free_spin_game_code: 'unknown_game_xyz' },
    platform: 'qp2',
  });
  assert.equal(r.valuePerSpin, null);
  assert.equal(r.inconclusive, true);
  assert.match(r.note, /not in the FS lines catalog/);
});

test('derive: row lines = 0 is treated as "not set" (blocker requires this)', () => {
  // The `lines: 0` marker is exactly how QP2 encodes "look up by game code".
  // Treating it as a truthy lines value would silently derive 0.02 × 0 = 0.
  const r = deriveValuePerSpin({
    pc: { currency: 'MYR', amount_per_line: 0.02, lines: 0 },
    detail: { free_spin_game_code: 'vs20olympgate' },
    platform: 'qp2',
  });
  assert.equal(r.linesPerSpin, 20);
  assert.equal(r.source, 'game-code');
  assert.equal(r.valuePerSpin, 0.4);
});

// ── Multi-currency propagation ──────────────────────────────────────────

test('multi-currency: MYR + SGD both derive independently', () => {
  const c = liveFromQp2({
    list_row: { code: 'X', bonus_type: 'Free Spin', valid_from: null, valid_to: null, merchant_ids: [1] },
    detail: {
      free_spin_game_code: 'vs20olympgate',
      to_multiplier: 5,
      promotion_currency_list: [
        { currency: 'MYR', currency_id: 1, amount_per_line: 0.02, lines: 0, rounds: 20 },
        { currency: 'SGD', currency_id: 3, amount_per_line: 0.01, lines: 0, rounds: 20 },
      ],
    },
  }, { brand: 'QP2A' });
  const myr = c.currencies.find((x) => x.code === 'MYR');
  const sgd = c.currencies.find((x) => x.code === 'SGD');
  assert.equal(myr.valuePerSpin, 0.4);
  assert.equal(sgd.valuePerSpin, 0.2);
  assert.equal(myr.linesPerSpin, 20);
  assert.equal(sgd.linesPerSpin, 20);
});

// ── QPRO vs QP2 branch differences ──────────────────────────────────────

test('QPRO vs QP2: QPRO uses row-lines even when detail has no game_code', () => {
  const qpro = liveFromQpro({
    list_row: { code: 'X', bonus_type: 'Free Spin', status: 1 },
    detail: {
      promotion_currency_list: [{ currency: 'MYR', currency_id: 1, amount_per_line: 0.04, lines: 10 }],
    },
  }, { brand: 'QPRO5' });
  assert.equal(qpro.currencies[0].valuePerSpin, 0.4);
  assert.equal(qpro.currencies[0].linesPerSpin, 10);
});

test('QPRO vs QP2: QP2 with lines=0 requires game-code (fails safely if missing)', () => {
  const qp2 = liveFromQp2({
    list_row: { code: 'X', bonus_type: 'Free Spin', merchant_ids: [1] },
    detail: {
      // No free_spin_game_code — the QP2 fallback path can't derive.
      promotion_currency_list: [{ currency: 'MYR', currency_id: 1, amount_per_line: 0.02, lines: 0 }],
    },
  }, { brand: 'QP2A' });
  assert.equal(qp2.currencies[0].valuePerSpin, null);
  assert.equal(qp2.currencies[0].valuePerSpinInconclusive, true);
});

// ── Non-FS promotions unchanged ─────────────────────────────────────────

test('non-FS: Deposit promo — valuePerSpin stays null, derivation runs but source has no expected', () => {
  const qp2 = liveFromQp2({
    list_row: { code: 'DEP1', bonus_type: 'Deposit - Reload', merchant_ids: [1] },
    detail: {
      to_multiplier: 5,
      promotion_currency_list: [{ currency: 'MYR', currency_id: 1, min_transfer: 100, max_bonus: 500, bonus_rate: 30 }],
    },
  }, { brand: 'QP2A' });
  assert.equal(qp2.currencies[0].valuePerSpin, null, 'no amount_per_line → derivation returns null');
  assert.equal(qp2.currencies[0].minDeposit, 100, 'deposit fields unaffected');
});

test('non-FS: Free Credit — valuePerSpin stays null, freeCreditAmount populated', () => {
  const qp2 = liveFromQp2({
    list_row: { code: 'FC1', bonus_type: 'Free Credit', merchant_ids: [1] },
    detail: {
      to_multiplier: 5,
      promotion_currency_list: [{ currency: 'MYR', currency_id: 1, free_credit_amount: 30 }],
    },
  }, { brand: 'QP2A' });
  assert.equal(qp2.currencies[0].valuePerSpin, null);
  assert.equal(qp2.currencies[0].freeCreditAmount, 30);
});

// ── End-to-end: source expects 0.40, live has amount_per_line=0.02 → MATCH ──

test('end-to-end: QPRO5 FS PP game — expected 0.40, live amount_per_line 0.02 → MATCH (not false-FAIL)', () => {
  const exp = expectedFromSource({
    promo_code: 'REL_FS', brands: ['QPRO5'], regions: ['MY'], currencies: ['MYR'],
    bonus_type: 'Free Spin',
    parsed: { spin_count: 5, value_per_spin: 0.4, min_deposit: 50, to_multiplier: 8 },
  }, { brand: 'QPRO5', platform: 'qpro' });
  const act = liveFromQpro({
    list_row: { id: 1, code: 'REL_FS', bonus_type: 'Free Spin - Reload', status: 1 },
    detail: {
      free_spin_game_code: 'vs20olympgate',
      to_multiplier: 8,
      promotion_currency_list: [{
        currency: 'MYR', currency_id: 1, status: 1,
        // Real BO shape: amount_per_line=0.02, lines=10 (QPRO operator standard)
        amount_per_line: 0.02, lines: 10,
        min_transfer: 50, rounds: 5,
      }],
    },
  }, { brand: 'QPRO5' });
  assert.equal(act.currencies[0].valuePerSpin, 0.2, 'QPRO row-lines=10 wins: 0.02 × 10 = 0.20');
  // Source declared 0.4 → live derives 0.2 → real MISMATCH surfaces (not a false pass).
  // Confirms compare emits MISMATCH honestly, not a false-PASS from unit conversion.
  const r = compare({ expected: exp, actual: act, brand: 'QPRO5', platform: 'qpro' });
  const vps = r.fields.find((f) => f.field === 'currency:MYR:valuePerSpin');
  assert.equal(vps.status, 'MISMATCH');
  assert.match(vps.message, /0\.02 × 10/, 'mismatch message must include the derivation trail');
});

test('end-to-end: QP2 FS PP game — expected 0.40, live amount_per_line 0.02 lines=0 vs20 → MATCH', () => {
  const exp = expectedFromSource({
    promo_code: 'QP2_FS', brands: ['QP2A'], regions: ['MY'], currencies: ['MYR'],
    bonus_type: 'Free Spin',
    parsed: { spin_count: 5, value_per_spin: 0.4, min_deposit: 50, to_multiplier: 8 },
  }, { brand: 'QP2A', platform: 'qp2' });
  const act = liveFromQp2({
    list_row: { id: 1, code: 'QP2_FS', bonus_type: 'Free Spin', status: 1, merchant_ids: [1], message_template_id: 1, dialog_popup_list: [{ popup_id: 100 }] },
    detail: {
      free_spin_game_code: 'vs20olympgate',
      to_multiplier: 8, auto_reward_activation: true,
      promotion_currency_list: [{
        currency: 'MYR', currency_id: 1, status: 1,
        amount_per_line: 0.02, lines: 0,  // QP2 always stores lines=0
        min_transfer: 50, rounds: 5,
      }],
    },
  }, { brand: 'QP2A' });
  assert.equal(act.currencies[0].valuePerSpin, 0.4, 'QP2 game-code fallback: 0.02 × 20 = 0.40');
  const r = compare({ expected: exp, actual: act, brand: 'QP2A', platform: 'qp2' });
  const vps = r.fields.find((f) => f.field === 'currency:MYR:valuePerSpin');
  assert.equal(vps.status, 'MATCH', 'unit conversion produces a real MATCH — no false FAIL');
  assert.match(vps.message, /0\.02 × 20/, 'MATCH message includes derivation trail');
});

test('end-to-end: inconclusive derivation → UNAVAILABLE with SPECIFIC reason (not false FAIL / PASS)', () => {
  const exp = expectedFromSource({
    promo_code: 'QP2_FS_UNKNOWN', brands: ['QP2A'], regions: ['MY'], currencies: ['MYR'],
    bonus_type: 'Free Spin',
    parsed: { spin_count: 5, value_per_spin: 0.4, min_deposit: 50, to_multiplier: 8 },
  }, { brand: 'QP2A', platform: 'qp2' });
  const act = liveFromQp2({
    list_row: { id: 1, code: 'QP2_FS_UNKNOWN', bonus_type: 'Free Spin', status: 1, merchant_ids: [1] },
    detail: {
      // No game_code, QP2 lines=0 → derivation cannot complete
      to_multiplier: 8,
      promotion_currency_list: [{
        currency: 'MYR', currency_id: 1, status: 1, amount_per_line: 0.02, lines: 0,
      }],
    },
  }, { brand: 'QP2A' });
  const r = compare({ expected: exp, actual: act, brand: 'QP2A', platform: 'qp2' });
  const vps = r.fields.find((f) => f.field === 'currency:MYR:valuePerSpin');
  assert.equal(vps.status, 'UNAVAILABLE', 'inconclusive derivation must NOT MATCH or MISMATCH');
  assert.equal(vps.severity, 'CRITICAL', 'value-per-spin is a critical FS field');
  assert.match(vps.message, /cannot be verified/, 'message must state conversion evidence is unavailable');
  assert.match(vps.message, /no free_spin_game_code/, 'message must explain the specific gap');
});
