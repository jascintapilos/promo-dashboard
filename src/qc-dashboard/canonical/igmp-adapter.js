// Increment 4 (real-QC upgrade): IGMP (WS1/WS2) live-BO snapshot → canonical.
//
// live_state shape:
//   list_row: { PromotionId, PromotionCode, PromotionName, PromotionType,
//               IsActive, IsPublished, PromotionStartDate, PromotionEndDate,
//               PromotionRewards[], RedeemableDay, ... }
//   detail:   same shape as list_row (IGMP GetPromotionInfoByCode returns
//             the full record) + PromotionRewards[0] carries mechanics
//
// Per sentinel.toml IGMP overrides:
// - PromotionType: "Bonus" | "FreeCredit" | "FreeSpin"
// - Rewards[0]: MinimumActionAmount, BonusPercentage, RolloverMultiplier,
//   CapBonusAmount, FixedBonusAmount, RedemptionType, WithdrawalCap
// - FS: Quantity is redeemable-quantity (not spin count); FreeSpinRounds not
//   returned; AmountPerBet not returned. Compare engine handles absence via
//   INCONCLUSIVE per Sentinel Rule 3.
// - Single currency per site (MY→MYR, SG→SGD, ID→IDR, TH→THB, KH→USD)

import {
  newCanonical, normalizeBonusType, normalizeCurrency,
  normalizeDate, normalizeDecimal, normalizeBool,
} from './canonical-model.js';

const SITE_TO_CURRENCY = {
  'ws1-v3-my': 'MYR', 'ws1-v3-sg': 'SGD', 'ws1-v3-id': 'IDR',
  'ws1-v3-th': 'THB', 'ws1-v3-kh': 'USD',
  'ws2': 'MYR',
};

export function liveFromIgmp(liveState, { brand, promoCode, siteId } = {}) {
  if (!liveState || typeof liveState !== 'object') {
    throw new Error('liveFromIgmp: liveState must be an object');
  }
  const row = liveState.list_row || {};
  const detail = liveState.detail || {};
  const rewards = Array.isArray(detail.PromotionRewards)
    ? detail.PromotionRewards
    : (Array.isArray(row.PromotionRewards) ? row.PromotionRewards : []);
  const r0 = rewards[0] || {};

  const c = newCanonical();
  c.identity.promoCode = row.PromotionCode || detail.PromotionCode || promoCode || null;
  c.identity.promotionId = row.PromotionId ?? detail.PromotionId ?? null;
  c.identity.bonusType = normalizeBonusType(row.PromotionType || detail.PromotionType);
  c.identity.bonusSubType = row.PromotionType || null;
  c.identity.brand = brand || null;
  c.identity.platform = 'igmp';

  c.schedule.startDate = normalizeDate(row.PromotionStartDate || detail.PromotionStartDate);
  c.schedule.endDate = normalizeDate(row.PromotionEndDate || detail.PromotionEndDate);
  c.schedule.recurring = null; // not directly exposed
  c.schedule.validityDays = null;
  c.schedule.rewardValidityDays = null;
  c.schedule.isActive = normalizeBool(row.IsActive ?? detail.IsActive);

  const currencyCode = siteId ? SITE_TO_CURRENCY[siteId] : null;
  c.currencies = currencyCode ? [{
    code: currencyCode,
    minDeposit: normalizeDecimal(r0.MinimumActionAmount),
    maxBonus: normalizeDecimal(r0.CapBonusAmount),
    bonusRatePct: normalizeDecimal(r0.BonusPercentage),
    freeCreditAmount: normalizeDecimal(r0.FixedBonusAmount),
    // FS spin count is NOT returned by IGMP (Quantity is redemption count).
    // Canonical value stays null → compare engine emits INCONCLUSIVE for FS
    // spinCount checks, never FAIL.
    spinCount: null,
    valuePerSpin: null,
    toMultiplier: normalizeDecimal(r0.RolloverMultiplier),
    maxTransferOut: null,
    withdrawalCap: normalizeDecimal(r0.WithdrawalCap),
    active: normalizeBool(row.IsActive ?? detail.IsActive),
  }] : [];

  c.eligibility.isVip = null;
  c.eligibility.memberTierIds = [];
  c.eligibility.memberGroupIds = [];
  c.eligibility.redemptionType = r0.RedemptionType != null
    ? (r0.RedemptionType === 0 || r0.RedemptionType === '0' ? 0 : 1)
    : null;

  c.scope.categories = [];
  c.scope.gameProviderIds = [];
  c.scope.gameProviderCodes = [];
  c.scope.blacklistId = null;
  c.scope.blacklistedProviders = [];

  const tnc = liveState.tnc || null;
  if (tnc && tnc.messages) {
    for (const [locale, msg] of Object.entries(tnc.messages)) {
      if (msg && msg.body) c.content.mtBody[locale.toUpperCase()] = msg.body;
    }
  }
  if (row.PromotionName) c.content.names.EN = row.PromotionName;

  // IGMP has no MT/dialog linkage concept — T&C is embedded in reward contents.
  c.linkage.templateId = null;
  c.linkage.dialogPopupId = null;
  c.linkage.dialogPopupList = [];
  c.linkage.promotionListIds = [];

  c.autoReward.autoRewardActivation = null; // not a concept on IGMP

  return c;
}
