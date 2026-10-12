// Increment 4 (real-QC upgrade): tests for canonical adapters.
// Golden fixtures inline per platform × bonus type. Every test asserts the
// canonical shape is what the compare engine will consume in Increment 5.

// Note: this file existed pre-Increment-4 tests and was already at ~14 tests.
// Increment-6 acceptance surfaced two normalizer bugs — regression-locked below.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expectedFromSource, liveFromQpro, liveFromQp2, liveFromIgmp, liveFromPlatform,
  CANONICAL_VERSION, BONUS_TYPES,
} from '../src/qc-dashboard/canonical/index.js';
import {
  normalizeBonusType, normalizeCurrency, normalizeCategoriesArray,
  normalizeDate, normalizeDecimal, normalizeBool,
} from '../src/qc-dashboard/canonical/canonical-model.js';

// ── normalizers ──────────────────────────────────────────────────────────

test('Increment 4: normalizeBonusType maps common labels', () => {
  assert.equal(normalizeBonusType('Deposit - Reload'), BONUS_TYPES.DEPOSIT);
  assert.equal(normalizeBonusType('Deposit - Welcome'), BONUS_TYPES.DEPOSIT);
  assert.equal(normalizeBonusType('Bonus'), BONUS_TYPES.DEPOSIT); // IGMP label
  assert.equal(normalizeBonusType('Free Credit'), BONUS_TYPES.FREE_CREDIT);
  assert.equal(normalizeBonusType('FreeCredit'), BONUS_TYPES.FREE_CREDIT); // IGMP variant
  assert.equal(normalizeBonusType('Free Spin'), BONUS_TYPES.FREE_SPIN);
  assert.equal(normalizeBonusType('FreeSpin'), BONUS_TYPES.FREE_SPIN);
  assert.equal(normalizeBonusType('Cashback'), BONUS_TYPES.CASHBACK);
  assert.equal(normalizeBonusType('unrecognized'), BONUS_TYPES.OTHER);
  assert.equal(normalizeBonusType(null), null);
});

test('Increment 4: normalizeCurrency rejects non-ISO strings', () => {
  assert.equal(normalizeCurrency('myr'), 'MYR');
  assert.equal(normalizeCurrency(' SGD '), 'SGD');
  assert.equal(normalizeCurrency('DOLLARS'), null, '7-letter word must reject');
  assert.equal(normalizeCurrency('!!'), null);
  assert.equal(normalizeCurrency(''), null);
  assert.equal(normalizeCurrency(null), null);
});

test('Increment 4: normalizeCategoriesArray dedupes + sorts', () => {
  assert.deepEqual(normalizeCategoriesArray(['Slot', 'slots', 'Live Casino']), ['LIVE_CASINO', 'SLOTS']);
  assert.deepEqual(normalizeCategoriesArray(['Sports', 'sport']), ['SPORTS']);
  assert.deepEqual(normalizeCategoriesArray([]), []);
  assert.deepEqual(normalizeCategoriesArray(null), []);
});

test('Increment 4: normalizeDate accepts ISO + DD/MM/YYYY + rejects garbage', () => {
  assert.equal(normalizeDate('2026-07-30T12:34:56Z'), '2026-07-30T12:34:56.000Z');
  assert.equal(normalizeDate('30/07/2026'), '2026-07-30T00:00:00.000Z');
  assert.equal(normalizeDate('bad'), null);
  assert.equal(normalizeDate(''), null);
  assert.equal(normalizeDate(null), null);
});

test('Increment 4: normalizeDecimal handles strings, commas, precision', () => {
  assert.equal(normalizeDecimal('1,234.5'), 1234.5);
  assert.equal(normalizeDecimal(30), 30);
  assert.equal(normalizeDecimal('0.02'), 0.02);
  assert.equal(normalizeDecimal(''), null);
  assert.equal(normalizeDecimal(null), null);
  assert.equal(normalizeDecimal('bad'), null);
});

test('Increment 4: normalizeBool covers common truthy/falsy strings', () => {
  assert.equal(normalizeBool(true), true);
  assert.equal(normalizeBool('true'), true);
  assert.equal(normalizeBool('YES'), true);
  assert.equal(normalizeBool(1), true);
  assert.equal(normalizeBool(0), false);
  assert.equal(normalizeBool('no'), false);
  assert.equal(normalizeBool('maybe'), null);
  assert.equal(normalizeBool(undefined), null);
});

// ── expected adapter ─────────────────────────────────────────────────────

test('Increment 4: expectedFromSource — QP2 FC request → canonical', () => {
  const src = {
    promo_code: 'TEST_API_QP2A_FC_V5',
    brands: ['QP2A'], currencies: ['MYR'], regions: ['MY'],
    bonus_type: 'Free Credit', bonus_sub_type: 'Free Credit',
    validity_days: 1, rewards_validity_days: 1, recurring: true, is_vip: true,
    parsed: { free_credit_amount: 30, min_deposit: 0, to_multiplier: 5, categories: ['Slot', 'Live Casino'] },
    per_currency_overrides: { MYR: { free_credit_amount: 30, max_transfer_out: 0 } },
    promotion_name_en: 'TEST — Exclusive Offer 30 FC',
    promotion_name_zh_id: 'TEST 专属 30',
  };
  const c = expectedFromSource(src, { brand: 'QP2A' });
  assert.equal(c.canonicalVersion, CANONICAL_VERSION);
  assert.equal(c.identity.promoCode, 'TEST_API_QP2A_FC_V5');
  assert.equal(c.identity.bonusType, BONUS_TYPES.FREE_CREDIT);
  assert.equal(c.identity.platform, 'qp2');
  assert.equal(c.schedule.validityDays, 1);
  assert.equal(c.schedule.recurring, true);
  assert.equal(c.currencies.length, 1);
  assert.equal(c.currencies[0].code, 'MYR');
  assert.equal(c.currencies[0].freeCreditAmount, 30);
  assert.equal(c.currencies[0].toMultiplier, 5);
  assert.deepEqual(c.scope.categories, ['LIVE_CASINO', 'SLOTS']);
  assert.equal(c.content.names.EN, 'TEST — Exclusive Offer 30 FC');
  assert.equal(c.autoReward.autoRewardActivation, true);
});

test('Increment 4: expectedFromSource — QPRO FS request → canonical', () => {
  const src = {
    promo_code: 'FT_88FS_10X_040_GOO',
    brands: ['QPRO1'], regions: ['MY', 'SG'], currencies: ['MYR', 'SGD'],
    bonus_type: 'Free Spin',
    parsed: { spin_count: 88, value_per_spin: 0.4, min_deposit: 50, to_multiplier: 10 },
    per_currency_overrides: { MYR: { min_deposit: 50 }, SGD: { min_deposit: 50 } },
  };
  const c = expectedFromSource(src, { brand: 'QPRO1' });
  assert.equal(c.identity.bonusType, BONUS_TYPES.FREE_SPIN);
  assert.equal(c.identity.platform, 'qpro');
  assert.equal(c.currencies.length, 2);
  const myr = c.currencies.find((x) => x.code === 'MYR');
  const sgd = c.currencies.find((x) => x.code === 'SGD');
  assert.equal(myr.spinCount, 88);
  assert.equal(myr.valuePerSpin, 0.4);
  assert.equal(sgd.minDeposit, 50);
});

test('Increment 4: expectedFromSource — IGMP dep request → canonical', () => {
  const src = {
    promo_code: 'FT_RET_CHECKIN_88PCT_8X_GLD',
    brands: ['WS1_MY'], regions: ['MY'],
    bonus_type: 'Deposit', bonus_sub_type: 'Reload',
    parsed: { min_deposit: 30, bonus_rate_pct: 88, to_multiplier: 8, max_bonus: 88 },
  };
  const c = expectedFromSource(src, { brand: 'WS1_MY' });
  assert.equal(c.identity.bonusType, BONUS_TYPES.DEPOSIT);
  assert.equal(c.identity.platform, 'igmp');
  assert.equal(c.currencies.length, 1);
  assert.equal(c.currencies[0].code, 'MYR');
  assert.equal(c.currencies[0].minDeposit, 30);
  assert.equal(c.currencies[0].bonusRatePct, 88);
});

// ── QPRO live adapter ────────────────────────────────────────────────────

test('Increment 4: liveFromQpro — Dep/Reload → canonical with list_row bonus_type authoritative', () => {
  // Blocker 4 fix: QPRO per-currency values live on the promotion_currency
  // rows (from /api/bo/promotioncurrency), not on detail. Fixture updated
  // to match the real API shape as documented in api-client.js:452-482.
  const live = {
    list_row: { id: 500, code: 'BP9_REL', bonus_type: 'Deposit - Reload', valid_from: '01/07/2026', valid_to: '31/07/2026', validity: 7, reward_validity: 3, status: 1, recurring: true, member_group_ids: [] },
    detail: {
      bonus_type: 'Cashback', // QPRO API bug — MUST be ignored
      promotion_currency_list: [
        { currency: 'MYR', currency_id: 1, status: 1, min_transfer: 100, max_bonus: 500, bonus_rate: 30 },
      ],
      to_multiplier: 10, categories: ['Slots'], game_provider_ids: [1, 2, 3],
      blacklist_id: 42, auto_reward_activation: null,
    },
    tnc: { messages: { EN: { subject: 'Reload', body: 'body' } } },
  };
  const c = liveFromQpro(live, { brand: 'QPRO1' });
  assert.equal(c.identity.bonusType, BONUS_TYPES.DEPOSIT, 'must derive DEPOSIT from list_row, not detail.Cashback');
  assert.equal(c.identity.platform, 'qpro');
  assert.equal(c.schedule.validityDays, 7);
  assert.equal(c.currencies[0].minDeposit, 100);
  assert.equal(c.currencies[0].maxBonus, 500);
  assert.equal(c.currencies[0].bonusRatePct, 30);
  assert.deepEqual(c.scope.categories, ['SLOTS']);
  assert.equal(c.scope.blacklistId, 42);
  assert.equal(c.autoReward.autoRewardActivation, null, 'QPRO auto_reward_activation MUST stay null (API quirk)');
});

// ── QP2 live adapter ─────────────────────────────────────────────────────

test('Increment 4: liveFromQp2 — Free Credit → canonical with multi-merchant IDs', () => {
  const live = {
    list_row: {
      id: 1500, code: 'TEST_QP2A_FC', bonus_type: 'Free Credit',
      valid_from: '01/07/2026', valid_to: '31/07/2026',
      merchant_ids: [1, 2, 3, 4],
      dialog_popup_list: [{ popup_id: 101 }, { popup_id: 102 }],
      message_template_id: 999, status: 1,
    },
    detail: {
      promotion_currency_list: [{ currency: 'MYR', currency_id: 1, free_credit_amount: 30, min_transfer: 0, max_withdraw: null, status: 1 }],
      to_multiplier: 5, allow_deposit: false,
    },
  };
  const c = liveFromQp2(live, { brand: 'QP2A' });
  assert.equal(c.identity.bonusType, BONUS_TYPES.FREE_CREDIT);
  assert.equal(c.identity.platform, 'qp2');
  assert.equal(c.currencies[0].freeCreditAmount, 30);
  assert.equal(c.currencies[0].withdrawalCap, null, 'QP2 unlimited null must pass through as null (Unlimited by design)');
  assert.deepEqual(c.linkage.promotionListIds, [1, 2, 3, 4]);
  assert.deepEqual(c.linkage.dialogPopupList, [101, 102]);
  assert.equal(c.linkage.templateId, 999);
});

// ── IGMP live adapter ────────────────────────────────────────────────────

test('Increment 4: liveFromIgmp — Dep bonus → canonical single-currency from siteId', () => {
  const live = {
    list_row: {
      PromotionId: 42, PromotionCode: 'FT_RET_88PCT', PromotionName: 'Test',
      PromotionType: 'Bonus', IsActive: true,
      PromotionStartDate: '2026-07-01T00:00:00', PromotionEndDate: '2026-07-31T00:00:00',
    },
    detail: {
      PromotionRewards: [{
        BonusPercentage: 88, MinimumActionAmount: 30, RolloverMultiplier: 8,
        CapBonusAmount: 88, RewardType: 0,
      }],
    },
  };
  const c = liveFromIgmp(live, { brand: 'WS1_MY', siteId: 'ws1-v3-my' });
  assert.equal(c.identity.bonusType, BONUS_TYPES.DEPOSIT);
  assert.equal(c.identity.platform, 'igmp');
  assert.equal(c.schedule.isActive, true);
  assert.equal(c.currencies[0].code, 'MYR');
  assert.equal(c.currencies[0].minDeposit, 30);
  assert.equal(c.currencies[0].bonusRatePct, 88);
  assert.equal(c.currencies[0].maxBonus, 88);
  assert.equal(c.currencies[0].toMultiplier, 8);
});

test('Increment 4: liveFromIgmp FS — spinCount MUST stay null (API does not expose FreeSpinRounds)', () => {
  const live = {
    list_row: { PromotionCode: 'FT_88FS', PromotionType: 'FreeSpin', IsActive: true },
    detail: { PromotionRewards: [{ Quantity: 1, RolloverMultiplier: 10, RedemptionType: 0 }] },
  };
  const c = liveFromIgmp(live, { brand: 'WS1_MY', siteId: 'ws1-v3-my' });
  assert.equal(c.currencies[0].spinCount, null, 'IGMP FS spinCount MUST be null — Quantity is not spin count');
  assert.equal(c.currencies[0].valuePerSpin, null, 'IGMP FS valuePerSpin MUST be null — AmountPerBet not returned');
  assert.equal(c.eligibility.redemptionType, 0);
});

test('Increment 4: liveFromPlatform dispatches by platform', () => {
  const qpro = liveFromPlatform('qpro', { list_row: { code: 'X', bonus_type: 'Free Credit' }, detail: {} }, { brand: 'QPRO1' });
  assert.equal(qpro.identity.platform, 'qpro');
  const qp2 = liveFromPlatform('qp2', { list_row: { code: 'X', bonus_type: 'Free Credit' }, detail: {} }, { brand: 'QP2A' });
  assert.equal(qp2.identity.platform, 'qp2');
  const igmp = liveFromPlatform('igmp', { list_row: { PromotionCode: 'X', PromotionType: 'Bonus' }, detail: { PromotionRewards: [{}] } }, { brand: 'WS1_MY', siteId: 'ws1-v3-my' });
  assert.equal(igmp.identity.platform, 'igmp');
  assert.throws(() => liveFromPlatform('unknown', {}, {}), /unsupported platform/);
});

// ── Post-Increment-6 acceptance regressions ─────────────────────────────

test('regression: normalizeBonusType recognises "Free Spin - Reload" as FREE_SPIN', () => {
  assert.equal(normalizeBonusType('Free Spin - Reload'), 'FREE_SPIN');
  assert.equal(normalizeBonusType('Free Spin - Welcome'), 'FREE_SPIN');
  assert.equal(normalizeBonusType('Free Credit'), 'FREE_CREDIT');
  assert.equal(normalizeBonusType('Free Credit - VIP'), 'FREE_CREDIT');
  assert.equal(normalizeBonusType('Deposit - Reload'), 'DEPOSIT');
  // Guard: still returns OTHER for unrelated types
  assert.equal(normalizeBonusType('Rebate'), 'OTHER');
});

// ── G1 regression: toMultiplier must resolve from BOTH detail shapes ─────
//
// Root cause found in production acceptance (2026-07-31): the live QC-Hub
// path (fetch-promo.js) passes the RAW /api/bo/promotion/{id} response, where
// the turnover multiplier lives at detail.target[0].multiplier. The adapters
// only read detail.to_multiplier — which exists solely in api-client.js's
// NORMALIZED record (what qc-bundles store). Result: every live run reported
// currency:*:toMultiplier as UNAVAILABLE, forcing MANUAL_REQUIRED.
// api-client.js:515 confirms `to_multiplier: main.target?.[0]?.multiplier`.

test('G1: QPRO toMultiplier resolves from raw shape detail.target[0].multiplier', () => {
  const c = liveFromQpro({
    list_row: { code: 'X', bonus_type: 'Free Spin - Reload', status: 1 },
    detail: {
      // RAW BO shape — no to_multiplier key at all
      target: [{ multiplier: 8 }],
      promotion_currency_list: [{ currency: 'MYR', currency_id: 1, status: 1, min_transfer: 50 }],
    },
  }, { brand: 'QPRO5' });
  assert.equal(c.currencies[0].toMultiplier, 8, 'must read target[0].multiplier from the raw response');
});

test('G1: QPRO toMultiplier still resolves from normalized detail.to_multiplier', () => {
  const c = liveFromQpro({
    list_row: { code: 'X', bonus_type: 'Free Spin - Reload', status: 1 },
    detail: {
      to_multiplier: 12,   // api-client normalized shape (qc-bundles)
      promotion_currency_list: [{ currency: 'MYR', currency_id: 1, status: 1 }],
    },
  }, { brand: 'QPRO5' });
  assert.equal(c.currencies[0].toMultiplier, 12, 'normalized shape must keep working');
});

test('G1: QP2 toMultiplier resolves from raw shape detail.target[0].multiplier', () => {
  const c = liveFromQp2({
    list_row: { code: 'X', bonus_type: 'Free Spin', merchant_ids: [1] },
    detail: {
      target: [{ multiplier: 12 }],
      promotion_currency_list: [{ currency: 'MYR', currency_id: 1, status: 1 }],
    },
  }, { brand: 'QP2A' });
  assert.equal(c.currencies[0].toMultiplier, 12);
});

test('G1: pc-row override wins over both detail shapes', () => {
  const c = liveFromQpro({
    list_row: { code: 'X', bonus_type: 'Deposit - Reload', status: 1 },
    detail: {
      to_multiplier: 5,
      target: [{ multiplier: 6 }],
      promotion_currency_list: [{ currency: 'MYR', currency_id: 1, status: 1, to_multiplier: 99 }],
    },
  }, { brand: 'QPRO1' });
  assert.equal(c.currencies[0].toMultiplier, 99, 'per-currency override takes precedence');
});

test('G1: toMultiplier is null (not 0/NaN) when NO shape carries it', () => {
  const c = liveFromQpro({
    list_row: { code: 'X', bonus_type: 'Deposit - Reload', status: 1 },
    detail: { promotion_currency_list: [{ currency: 'MYR', currency_id: 1, status: 1 }] },
  }, { brand: 'QPRO1' });
  assert.equal(c.currencies[0].toMultiplier, null, 'genuinely absent must stay null → UNAVAILABLE, never a fake 0');
});

// ── Gap-closure regression: QPRO bonusRatePct must fall back to detail ───
//
// Same failure shape as G1's toMultiplier bug. Root cause found in
// production acceptance (2026-08-11): the QPRO /api/bo/promotioncurrency row
// never carries a bonus_rate column at all (verified live on
// WHALE_CRM_PROBE_DEP50PCT_500_12X — the row has min_transfer/max_bonus/
// rounds/etc but no bonus_rate); the value lives only on the top-level
// detail object (detail.bonus_rate: 50.00 for that same promo, matching its
// own "DEP50PCT" code). Reading pc.bonus_rate alone made every QPRO Deposit
// promo in the 27-brand acceptance sample (15 of 22 sampled MANUAL_REQUIRED
// cases) report bonusRatePct UNAVAILABLE regardless of live BO reality.

test('Gap-closure: QPRO bonusRatePct resolves from top-level detail.bonus_rate when the per-currency row has none', () => {
  const c = liveFromQpro({
    list_row: { code: 'X', bonus_type: 'Deposit - Reload', status: 1 },
    detail: {
      bonus_rate: 50, // top-level only — the real live BO shape for QPRO
      promotion_currency_list: [{ currency: 'MYR', currency_id: 1, status: 1, min_transfer: 1000, max_bonus: 500 }],
    },
  }, { brand: 'QPRO1' });
  assert.equal(c.currencies[0].bonusRatePct, 50, 'must fall back to detail.bonus_rate when the per-currency row has none');
});

test('Gap-closure: QPRO per-currency bonus_rate still wins when present (no regression to the working case)', () => {
  const c = liveFromQpro({
    list_row: { code: 'X', bonus_type: 'Deposit - Reload', status: 1 },
    detail: {
      bonus_rate: 999, // must NOT be used — the per-currency row has its own value
      promotion_currency_list: [{ currency: 'MYR', currency_id: 1, status: 1, bonus_rate: 30 }],
    },
  }, { brand: 'QPRO1' });
  assert.equal(c.currencies[0].bonusRatePct, 30, 'per-currency value takes precedence over the detail-level fallback');
});

test('Gap-closure: QPRO bonusRatePct is null (not 0/NaN) when neither shape carries it', () => {
  const c = liveFromQpro({
    list_row: { code: 'X', bonus_type: 'Deposit - Reload', status: 1 },
    detail: { promotion_currency_list: [{ currency: 'MYR', currency_id: 1, status: 1 }] },
  }, { brand: 'QPRO1' });
  assert.equal(c.currencies[0].bonusRatePct, null, 'genuinely absent must stay null → UNAVAILABLE, never a fake 0');
});

// ── Gap-closure regression: QP2 freeCreditAmount must fall back to bonus_amount ───
//
// Root cause found in production acceptance (2026-08-11): QP2's
// /api/bo/promotioncurrency row has no free_credit_amount column — verified
// live on WHALE_VM_PROBE_NODEP_FC138_20X (QP2A): pc.free_credit_amount was
// undefined while pc.bonus_amount was "138.00", matching the promo's own
// "FC138" code. QP2 reuses the generic bonus_amount column for both Deposit
// (bonus_type 2, where it sits at "0.00" because the real value is
// bonus_rate) and Free Credit (bonus_type 1, where it IS the free credit
// amount) — the same ambiguity qpro-adapter.js already resolves via the
// identical `?? pc.bonus_amount` fallback (see liveFromQpro).

test('Gap-closure: QP2 freeCreditAmount resolves from pc.bonus_amount when free_credit_amount is absent', () => {
  const c = liveFromQp2({
    list_row: { code: 'X', bonus_type: 'Free Credit', merchant_ids: [1] },
    detail: {
      promotion_currency_list: [{ currency: 'MYR', currency_id: 1, status: 1, bonus_type: 1, bonus_amount: '138.00' }],
    },
  }, { brand: 'QP2A' });
  assert.equal(c.currencies[0].freeCreditAmount, 138, 'must fall back to pc.bonus_amount when free_credit_amount is absent');
});

test('Gap-closure: QP2 per-currency free_credit_amount still wins when present (no regression)', () => {
  const c = liveFromQp2({
    list_row: { code: 'X', bonus_type: 'Free Credit', merchant_ids: [1] },
    detail: {
      promotion_currency_list: [{ currency: 'MYR', currency_id: 1, status: 1, free_credit_amount: 30, bonus_amount: '999.00' }],
    },
  }, { brand: 'QP2A' });
  assert.equal(c.currencies[0].freeCreditAmount, 30, 'an explicit free_credit_amount must win over the bonus_amount fallback');
});

test('Gap-closure: QP2 freeCreditAmount fallback never leaks a Deposit promo\'s unrelated bonus_amount into a comparison', () => {
  // bonus_amount sits at "0.00" on a real Deposit promo's currency row (the
  // Deposit promo's actual value lives in bonus_rate instead) — the
  // fallback picking up 0 here is harmless because the compare engine only
  // ever looks at freeCreditAmount when the EXPECTED side asserts it, which
  // a Deposit source never does (see compare-engine.js ruleCurrencies: `if
  // (e == null) continue`).
  const c = liveFromQp2({
    list_row: { code: 'X', bonus_type: 'Deposit - Reload', merchant_ids: [1] },
    detail: {
      promotion_currency_list: [{ currency: 'MYR', currency_id: 1, status: 1, bonus_type: 2, bonus_amount: '0.00', bonus_rate: '50.00' }],
    },
  }, { brand: 'QP2A' });
  assert.equal(c.currencies[0].bonusRatePct, 50);
  assert.equal(c.currencies[0].freeCreditAmount, 0, 'harmless — never compared for a Deposit bonus type');
});

// ── G5/G6 regression: IGMP FS rounds + bet value ARE in the API ──────────
//
// The earlier conclusion ("FreeSpinRounds / AmountPerBet are create-only, so
// these fields need DOM scraping") was WRONG. A read-only probe of a live
// WS1_MY FS bundle (2026-07-31) showed both values nested under
// PromotionRewards[0].FreeSpin. The previous code read only the reward ROOT,
// where `Quantity` is the redeemable-claim count — not the spin count. Reading
// the nested object removes the entire Layer-3/DOM requirement for IGMP.

test('G5/G6: IGMP FS reads FreeSpinRounds + AmountPerBet from PromotionRewards[0].FreeSpin', () => {
  const c = liveFromIgmp({
    list_row: { PromotionCode: 'FS1', PromotionType: 'FreeSpin', IsActive: true },
    detail: {
      PromotionRewards: [{
        RewardId: 15387, RolloverMultiplier: 10, MinimumActionAmount: 0, RedemptionType: 1,
        Quantity: 1,                            // claim count — must NOT be used as spinCount
        FreeSpin: { FreeSpinId: 323, FreeSpinRounds: 68, AmountPerBet: 0.4, AmountPerLine: 0 },
      }],
    },
  }, { brand: 'WS1_MY', siteId: 'ws1-v3-my' });
  assert.equal(c.currencies[0].spinCount, 68, 'spinCount must come from FreeSpin.FreeSpinRounds, not Quantity');
  assert.equal(c.currencies[0].valuePerSpin, 0.4, 'valuePerSpin must come from FreeSpin.AmountPerBet');
});

test('G5/G6: IGMP FreeSpinRounds accepted as a numeric string', () => {
  const c = liveFromIgmp({
    list_row: { PromotionCode: 'FS1', PromotionType: 'FreeSpin', IsActive: true },
    detail: { PromotionRewards: [{ FreeSpin: { FreeSpinId: 9, FreeSpinRounds: '88', AmountPerBet: '0.5' } }] },
  }, { brand: 'WS1_MY', siteId: 'ws1-v3-my' });
  assert.equal(c.currencies[0].spinCount, 88);
  assert.equal(c.currencies[0].valuePerSpin, 0.5);
});

test('G5/G6: Deposit promo with an empty FreeSpin stub yields null, NOT 0 spins', () => {
  const c = liveFromIgmp({
    list_row: { PromotionCode: 'DEP1', PromotionType: 'Bonus', IsActive: true },
    detail: {
      PromotionRewards: [{
        MinimumActionAmount: 50, BonusPercentage: 88, RolloverMultiplier: 3,
        FreeSpin: { FreeSpinRounds: 0, AmountPerBet: 0 },   // stub, no FreeSpinId
      }],
    },
  }, { brand: 'WS1_MY', siteId: 'ws1-v3-my' });
  assert.equal(c.currencies[0].spinCount, null, 'stub without FreeSpinId must not report 0 spins as evidence');
  assert.equal(c.currencies[0].valuePerSpin, null);
  assert.equal(c.currencies[0].minDeposit, 50, 'deposit fields unaffected');
});

test('G5/G6: absent FreeSpin object yields null (no throw)', () => {
  const c = liveFromIgmp({
    list_row: { PromotionCode: 'FC1', PromotionType: 'FreeCredit', IsActive: true },
    detail: { PromotionRewards: [{ FixedBonusAmount: 30, RolloverMultiplier: 5 }] },
  }, { brand: 'WS1_MY', siteId: 'ws1-v3-my' });
  assert.equal(c.currencies[0].spinCount, null);
  assert.equal(c.currencies[0].valuePerSpin, null);
  assert.equal(c.currencies[0].freeCreditAmount, 30);
});
