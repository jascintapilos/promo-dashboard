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
