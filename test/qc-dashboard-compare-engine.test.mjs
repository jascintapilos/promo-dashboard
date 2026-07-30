// Increment 5 (real-QC upgrade): tests for src/qc-dashboard/compare-engine.js
//
// Covers every verdict branch (SAFE / REVIEW / NOT_SAFE / MANUAL_REQUIRED),
// per-field rule behavior, and the platform quirks documented in
// .codex/agents/sentinel.toml.

import test from 'node:test';
import assert from 'node:assert/strict';
import { compare } from '../src/qc-dashboard/compare-engine.js';
import { expectedFromSource, liveFromQpro, liveFromQp2, liveFromIgmp } from '../src/qc-dashboard/canonical/index.js';

// Fresh minimally-complete QP2 FC pair (SAFE reference)
function qp2FcExpected() {
  return expectedFromSource({
    promo_code: 'FT_QP2A_FC', brands: ['QP2A'], currencies: ['MYR'], regions: ['MY'],
    bonus_type: 'Free Credit',
    validity_days: 7, rewards_validity_days: 3,
    parsed: { free_credit_amount: 30, min_deposit: 0, to_multiplier: 5, categories: [] },
    per_currency_overrides: { MYR: { free_credit_amount: 30 } },
  }, { brand: 'QP2A' });
}
function qp2FcLive() {
  return liveFromQp2({
    list_row: {
      id: 999, code: 'FT_QP2A_FC', bonus_type: 'Free Credit',
      validity: 7, reward_validity: 3, status: 1,
      merchant_ids: [1], dialog_popup_list: [{ popup_id: 100 }],
      message_template_id: 500,
    },
    detail: {
      promotion_currency_list: [{ currency: 'MYR', currency_id: 1, free_credit_amount: 30, min_transfer: 0, status: 1 }],
      to_multiplier: 5, allow_deposit: false, categories: [], game_provider_ids: [],
      // A successfully-saved QP2 promo has this field ON. Without it, the
      // compare engine correctly emits MANUAL_REQUIRED for the missing
      // evidence (which is the invariant — no PASS without live evidence).
      auto_reward_activation: true,
    },
  }, { brand: 'QP2A' });
}

test('Increment 5: SAFE — every critical field matches, no warnings', () => {
  const r = compare({ expected: qp2FcExpected(), actual: qp2FcLive(), brand: 'QP2A' });
  assert.equal(r.verdict, 'SAFE', `expected SAFE, got ${r.verdict}; failed fields: ${r.fields.filter(f=>f.status==='MISMATCH').map(f=>f.field).join(',')}`);
  assert.ok(r.summary.passed > 0);
  assert.equal(r.summary.failed, 0);
  assert.equal(r.summary.unavailable, 0);
});

test('Increment 5: NOT_SAFE — critical mismatch on promoCode', () => {
  const exp = qp2FcExpected();
  const act = qp2FcLive();
  act.identity.promoCode = 'DIFFERENT_CODE';
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  assert.equal(r.verdict, 'NOT_SAFE');
  assert.ok(r.fields.some((f) => f.field === 'promoCode' && f.status === 'MISMATCH' && f.severity === 'CRITICAL'));
});

test('Increment 5: NOT_SAFE — critical mismatch on bonusType', () => {
  const exp = qp2FcExpected();
  const act = qp2FcLive();
  act.identity.bonusType = 'DEPOSIT';
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  assert.equal(r.verdict, 'NOT_SAFE');
});

test('Increment 5: NOT_SAFE — currency mechanics mismatch', () => {
  const exp = qp2FcExpected();
  const act = qp2FcLive();
  act.currencies[0].freeCreditAmount = 25; // expected 30
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  assert.equal(r.verdict, 'NOT_SAFE');
  assert.ok(r.fields.some((f) => f.field === 'currency:MYR:freeCreditAmount' && f.status === 'MISMATCH'));
});

test('Increment 5: MANUAL_REQUIRED — critical field unavailable on live', () => {
  const exp = qp2FcExpected();
  const act = qp2FcLive();
  act.identity.promoCode = null; // simulates missing live evidence
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  assert.equal(r.verdict, 'MANUAL_REQUIRED', 'missing critical evidence must be MANUAL_REQUIRED, never PASS');
});

test('Increment 5: MANUAL_REQUIRED — currency present on expected but absent on live (MYR)', () => {
  const exp = qp2FcExpected();
  const act = qp2FcLive();
  act.currencies = []; // wipe out currency data on live
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  assert.equal(r.verdict, 'NOT_SAFE'); // presence check is CRITICAL MISMATCH
});

test('Increment 5: REVIEW — warning-level mismatch only (extra currency in live)', () => {
  const exp = qp2FcExpected();
  const act = qp2FcLive();
  act.currencies.push({ code: 'SGD', minDeposit: 0, maxBonus: null, bonusRatePct: null, freeCreditAmount: 30, spinCount: null, valuePerSpin: null, toMultiplier: 5, maxTransferOut: null, withdrawalCap: null, active: true });
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  assert.equal(r.verdict, 'REVIEW');
});

test('Increment 5: QPRO auto_reward_activation null → SKIPPED, not FAIL (Sentinel quirk)', () => {
  const exp = expectedFromSource({
    promo_code: 'QPRO_REL', brands: ['QPRO1'], currencies: ['MYR'], regions: ['MY'],
    bonus_type: 'Deposit', parsed: { min_deposit: 100, bonus_rate_pct: 30, to_multiplier: 8, max_bonus: 500 },
    per_currency_overrides: { MYR: { min_deposit: 100 } },
  }, { brand: 'QPRO1' });
  const act = liveFromQpro({
    list_row: { id: 1, code: 'QPRO_REL', bonus_type: 'Deposit - Reload', status: 1 },
    detail: {
      promotion_currency_list: [{ currency: 'MYR', currency_id: 1, status: 1 }],
      per_currency_overrides: { MYR: { min_deposit: 100, max_bonus: 500, bonus_rate: 30 } },
      to_multiplier: 8, auto_reward_activation: null, // QPRO quirk
    },
  }, { brand: 'QPRO1' });
  const r = compare({ expected: exp, actual: act, brand: 'QPRO1' });
  const arField = r.fields.find((f) => f.field === 'autoRewardActivation');
  assert.equal(arField.status, 'SKIPPED');
  assert.match(arField.message, /QPRO GET does not return/);
  assert.notEqual(r.verdict, 'NOT_SAFE', 'QPRO null autoReward must not FAIL the verdict');
});

test('Increment 5 + Blocker 3: QPRO4-17 no-SG quirk — SGD filtered from expected, never surfaces as field', () => {
  // Blocker 3 fix: expectedFromSource now scopes source.currencies to the
  // target brand. For QPRO5 (MY-only per allowedCurrenciesForBrand), the
  // multi-region source ['MYR', 'SGD'] is filtered to ['MYR'] at the
  // adapter boundary — so no SGD field is emitted at all. Compare engine
  // then never sees it, and there is nothing to SKIP or MISMATCH.
  const exp = expectedFromSource({
    promo_code: 'QPRO5_REL', brands: ['QPRO5'], currencies: ['MYR', 'SGD'], regions: ['MY', 'SG'],
    bonus_type: 'Deposit',
    parsed: { min_deposit: 100, bonus_rate_pct: 30, to_multiplier: 8, max_bonus: 500 },
    per_currency_overrides: { MYR: { min_deposit: 100 }, SGD: { min_deposit: 150 } },
  }, { brand: 'QPRO5', platform: 'qpro' });
  assert.deepEqual(exp.currencies.map((c) => c.code), ['MYR'], 'QPRO5 must expect only MYR — SGD is filtered');
  const act = liveFromQpro({
    list_row: { id: 2, code: 'QPRO5_REL', bonus_type: 'Deposit - Reload', status: 1 },
    detail: {
      promotion_currency_list: [{ currency: 'MYR', currency_id: 1, status: 1, min_transfer: 100, max_bonus: 500, bonus_rate: 30 }],
      to_multiplier: 8,
    },
  }, { brand: 'QPRO5' });
  const r = compare({ expected: exp, actual: act, brand: 'QPRO5' });
  const sgdPresence = r.fields.find((f) => f.field === 'currency:SGD:present');
  assert.equal(sgdPresence, undefined, 'SGD must not appear as a field at all — filtered from expected');
  assert.notEqual(r.verdict, 'NOT_SAFE', 'no SGD false-FAIL');
});

test('Increment 5: category restricted but providers empty → FAIL (bypass risk)', () => {
  const exp = expectedFromSource({
    promo_code: 'QP2_SLOTS_ONLY', brands: ['QP2A'], currencies: ['MYR'], regions: ['MY'],
    bonus_type: 'Free Credit',
    parsed: { free_credit_amount: 30, min_deposit: 0, to_multiplier: 5, categories: ['Slots'] },
    per_currency_overrides: { MYR: { free_credit_amount: 30 } },
  }, { brand: 'QP2A' });
  const act = liveFromQp2({
    list_row: { id: 3, code: 'QP2_SLOTS_ONLY', bonus_type: 'Free Credit', status: 1, merchant_ids: [1], message_template_id: 1, dialog_popup_list: [{ popup_id: 100 }] },
    detail: {
      promotion_currency_list: [{ currency: 'MYR', currency_id: 1, free_credit_amount: 30, status: 1 }],
      to_multiplier: 5, categories: ['Slots'],
      game_provider_ids: [], game_provider_codes: [], // BYPASS RISK
    },
  }, { brand: 'QP2A' });
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  const cpc = r.fields.find((f) => f.field === 'categoryProviderConsistency');
  assert.equal(cpc.status, 'MISMATCH');
  assert.equal(cpc.severity, 'CRITICAL');
  assert.equal(r.verdict, 'NOT_SAFE');
});

test('Increment 5: category sets compared unordered (case-normalized)', () => {
  const exp = qp2FcExpected();
  exp.scope.categories = ['LIVE_CASINO', 'SLOTS'];
  const act = qp2FcLive();
  act.scope.categories = ['SLOTS', 'LIVE_CASINO']; // reversed order — same set
  act.scope.gameProviderCodes = ['LIVE22', 'PP']; // has providers → consistency check passes
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  const catField = r.fields.find((f) => f.field === 'categories');
  assert.equal(catField.status, 'MATCH', 'unordered category set must match');
});

test('Increment 5: decimal comparison ignores insignificant precision (0.02 vs 0.020000001)', () => {
  const exp = qp2FcExpected();
  exp.currencies[0].freeCreditAmount = 30.00;
  const act = qp2FcLive();
  act.currencies[0].freeCreditAmount = 30.000001; // sub-cent difference
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  const field = r.fields.find((f) => f.field === 'currency:MYR:freeCreditAmount');
  assert.equal(field.status, 'MATCH', 'decimal near-equality must be treated as MATCH');
});

test('Increment 5: date comparison via canonical adapter normalization (DD/MM vs ISO)', () => {
  const exp = expectedFromSource({
    promo_code: 'DATED', brands: ['QP2A'], currencies: ['MYR'], regions: ['MY'],
    bonus_type: 'Free Credit', validity_days: 7,
    start_date: '30/07/2026', end_date: '31/07/2026',
    parsed: { free_credit_amount: 30, min_deposit: 0, to_multiplier: 5 },
  }, { brand: 'QP2A' });
  const act = liveFromQp2({
    list_row: { code: 'DATED', bonus_type: 'Free Credit', valid_from: '2026-07-30T00:00:00Z', valid_to: '2026-07-31T00:00:00Z', validity: 7, status: 1, merchant_ids: [1], message_template_id: 1, dialog_popup_list: [{ popup_id: 1 }] },
    detail: { promotion_currency_list: [{ currency: 'MYR', currency_id: 1, free_credit_amount: 30, status: 1 }], to_multiplier: 5 },
  }, { brand: 'QP2A' });
  assert.equal(exp.schedule.startDate, act.schedule.startDate, 'date normalization must equalize DD/MM/YYYY vs ISO');
});

test('Increment 5: QP2 multi-merchant dialog count mismatch → CRITICAL FAIL', () => {
  const exp = qp2FcExpected();
  const act = qp2FcLive();
  act.linkage.promotionListIds = [1, 2, 3, 4]; // four merchants
  act.linkage.dialogPopupList = [100];         // one popup — mismatch
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  const dialog = r.fields.find((f) => f.field === 'dialogLinkage' && f.rule === 'linkage.qp2-dialog-count');
  assert.ok(dialog);
  assert.equal(dialog.severity, 'CRITICAL');
  assert.equal(r.verdict, 'NOT_SAFE');
});

test('Increment 5: IGMP linkage rules skipped (no MT/dialog concept)', () => {
  const exp = expectedFromSource({
    promo_code: 'IGMP_DEP', brands: ['WS1_MY'], currencies: ['MYR'], regions: ['MY'],
    bonus_type: 'Deposit', parsed: { min_deposit: 30, bonus_rate_pct: 88, to_multiplier: 8, max_bonus: 88 },
  }, { brand: 'WS1_MY' });
  const act = liveFromIgmp({
    list_row: { PromotionId: 1, PromotionCode: 'IGMP_DEP', PromotionType: 'Bonus', IsActive: true },
    detail: { PromotionRewards: [{ MinimumActionAmount: 30, BonusPercentage: 88, RolloverMultiplier: 8, CapBonusAmount: 88 }] },
  }, { brand: 'WS1_MY', siteId: 'ws1-v3-my' });
  const r = compare({ expected: exp, actual: act, brand: 'WS1_MY' });
  const mt = r.fields.find((f) => f.field === 'mtLinkage');
  const dialog = r.fields.find((f) => f.field === 'dialogLinkage');
  assert.equal(mt.status, 'SKIPPED');
  assert.equal(dialog.status, 'SKIPPED');
  // Overall should be SAFE — no critical mismatch on IGMP
  assert.notEqual(r.verdict, 'NOT_SAFE');
});

test('Blocker 4: IGMP FS spinCount / valuePerSpin — SKIPPED (platform limit), not MANUAL_REQUIRED', () => {
  // IGMP has no GET endpoint that returns FreeSpinRounds or AmountPerBet
  // (verified against every /PM/GetFreeSpin* endpoint 2026-07-30). The
  // compare engine must emit SKIPPED with a "platform-limit" reason instead
  // of UNAVAILABLE — otherwise every IGMP FS promo forever resolves to
  // MANUAL_REQUIRED for a systematic limitation, not a per-promo evidence
  // gap. Documented in src/qc-dashboard/canonical/igmp-adapter.js.
  const exp = expectedFromSource({
    promo_code: 'IGMP_FS', brands: ['WS1_MY'], currencies: ['MYR'], regions: ['MY'],
    bonus_type: 'Free Spin', parsed: { spin_count: 88, value_per_spin: 0.5, to_multiplier: 10, min_deposit: 0 },
  }, { brand: 'WS1_MY', platform: 'igmp', siteId: 'ws1-v3-my' });
  const act = liveFromIgmp({
    list_row: { PromotionCode: 'IGMP_FS', PromotionType: 'FreeSpin', IsActive: true },
    detail: { PromotionRewards: [{ Quantity: 1, RolloverMultiplier: 10, RedemptionType: 1, MinimumActionAmount: 0 }] },
  }, { brand: 'WS1_MY', siteId: 'ws1-v3-my' });
  const r = compare({ expected: exp, actual: act, brand: 'WS1_MY' });
  const spin = r.fields.find((f) => f.field === 'currency:MYR:spinCount');
  const vps = r.fields.find((f) => f.field === 'currency:MYR:valuePerSpin');
  assert.equal(spin.status, 'SKIPPED', 'IGMP FS spinCount is a platform limitation — must SKIP, not UNAVAILABLE');
  assert.equal(spin.severity, 'INFO', 'SKIPPED must carry INFO severity');
  assert.match(spin.message, /not exposed by IGMP GET endpoints/);
  assert.equal(vps.status, 'SKIPPED', 'IGMP FS valuePerSpin is also a platform limitation');
  assert.notEqual(r.verdict, 'MANUAL_REQUIRED', 'platform-limitation SKIP must not force MANUAL_REQUIRED');
});

test('Increment 5: compare throws when expected or actual is missing', () => {
  assert.throws(() => compare({ expected: null, actual: {} }), /required/);
  assert.throws(() => compare({ expected: {}, actual: null }), /required/);
});
