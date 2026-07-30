// Increment 4 (real-QC upgrade): approved-request → canonical.
//
// The approved-request source (captures/requests/<handle>.json OR the
// `source` block inside captures/qc-bundles/<handle>__<brand>.json) has ONE
// shape across all three platforms — this adapter projects it into the
// canonical model that the compare engine (Increment 5) diffs against a
// live-BO canonical.
//
// Never invents values. If the source doesn't specify a field, it stays null.

import {
  newCanonical, normalizeBonusType, normalizeCurrency, normalizeCategoriesArray,
  normalizeDate, normalizeDecimal, normalizeBool,
} from './canonical-model.js';
import { allowedCurrenciesForBrand } from './brand-currencies.js';

export function expectedFromSource(source, { brand, promoCode, promotionId = null, platform = null, siteId = null } = {}) {
  if (!source || typeof source !== 'object') {
    throw new Error('expectedFromSource: source must be an object');
  }
  const c = newCanonical();

  // ── Identity ──────────────────────────────────────────────────────────
  c.identity.promoCode = source.promo_code || promoCode || null;
  c.identity.promotionId = promotionId != null ? promotionId : null;
  c.identity.bonusType = normalizeBonusType(source.bonus_type);
  c.identity.bonusSubType = source.bonus_sub_type || null;
  c.identity.brand = brand || (Array.isArray(source.brands) && source.brands.length === 1 ? source.brands[0] : null);
  c.identity.platform = _guessPlatform(brand, source);

  // ── Schedule ──────────────────────────────────────────────────────────
  const parsed = source.parsed || {};
  c.schedule.startDate = normalizeDate(source.start_date || parsed.start_date);
  c.schedule.endDate = normalizeDate(source.end_date || parsed.end_date);
  c.schedule.recurring = normalizeBool(source.recurring);
  c.schedule.validityDays = Number.isFinite(source.validity_days) ? source.validity_days : null;
  c.schedule.rewardValidityDays = Number.isFinite(source.rewards_validity_days) ? source.rewards_validity_days : null;
  c.schedule.isActive = null; // source doesn't assert live status

  // ── Currencies ────────────────────────────────────────────────────────
  // Resolve the request's declared currency list, then filter to those the
  // TARGET brand's BO can actually carry. A multi-region request (MY+SG)
  // that fans out to WS1_MY must only expect MYR — the SGD variant lives on
  // WS1_SG's own BO. Without this filter, every multi-region request would
  // false-FAIL for the currencies that belong to a sibling brand.
  const declared = _resolveCurrencyList(source);
  const allowed = allowedCurrenciesForBrand({
    brand,
    platform: platform || c.identity.platform,
    siteId,
  });
  const codes = allowed
    ? declared.filter((code) => allowed.includes(code))
    : declared;
  const overrides = source.per_currency_overrides || {};
  c.currencies = codes.map((code) => {
    const o = overrides[code] || {};
    return {
      code,
      minDeposit: normalizeDecimal(o.min_deposit != null ? o.min_deposit : parsed.min_deposit),
      maxBonus: normalizeDecimal(o.max_bonus != null ? o.max_bonus : parsed.max_bonus),
      bonusRatePct: normalizeDecimal(o.bonus_rate_pct != null ? o.bonus_rate_pct : parsed.bonus_rate_pct),
      freeCreditAmount: normalizeDecimal(o.free_credit_amount != null ? o.free_credit_amount : parsed.free_credit_amount),
      spinCount: Number.isFinite(o.spin_count ?? parsed.spin_count) ? (o.spin_count ?? parsed.spin_count) : null,
      valuePerSpin: normalizeDecimal(o.value_per_spin != null ? o.value_per_spin : parsed.value_per_spin),
      toMultiplier: normalizeDecimal(o.to_multiplier != null ? o.to_multiplier : parsed.to_multiplier),
      maxTransferOut: normalizeDecimal(o.max_transfer_out != null ? o.max_transfer_out : parsed.max_transfer_out),
      withdrawalCap: normalizeDecimal(o.max_withdraw != null ? o.max_withdraw : parsed.max_withdraw),
      active: null, // source doesn't assert per-currency active state
    };
  });

  // ── Eligibility ──────────────────────────────────────────────────────
  c.eligibility.isVip = normalizeBool(source.is_vip);
  c.eligibility.memberTierIds = Array.isArray(source.tier_ids) ? [...source.tier_ids] : [];
  c.eligibility.memberGroupIds = Array.isArray(source.member_group_ids) ? [...source.member_group_ids] : [];
  c.eligibility.redemptionType = null; // derived at compare time from min_deposit

  // ── Scope ────────────────────────────────────────────────────────────
  // Prefer `parsed.categories`; then `categories`; then `source.categories`
  const cats = parsed.categories || source.categories || null;
  c.scope.categories = normalizeCategoriesArray(cats);
  c.scope.gameProviderIds = []; // source doesn't spec ids
  c.scope.gameProviderCodes = Array.isArray(parsed.game_providers) ? [...parsed.game_providers].sort() : [];
  c.scope.blacklistId = null;
  c.scope.blacklistedProviders = [];

  // ── Content ──────────────────────────────────────────────────────────
  if (source.promotion_name_en) c.content.names.EN = source.promotion_name_en;
  if (source.promotion_name_zh_id) c.content.names.ZH = source.promotion_name_zh_id;
  // MT/dialog bodies aren't authored in the request — compare-engine treats
  // these as "unknown expected" and only checks presence/structure on live.

  // ── Linkage ──────────────────────────────────────────────────────────
  c.linkage.templateId = null;
  c.linkage.dialogPopupId = null;
  c.linkage.dialogPopupList = [];
  c.linkage.promotionListIds = [];

  // ── Auto reward ──────────────────────────────────────────────────────
  // Source implies auto reward is ON unless instructions say otherwise.
  const instr = source.instructions || {};
  c.autoReward.autoRewardActivation = instr.auto_reward_off === true ? false : true;

  return c;
}

function _resolveCurrencyList(source) {
  // Prefer explicit currencies[] array; fall back to per_currency_overrides keys;
  // finally single currency derived from region.
  const explicit = Array.isArray(source.currencies) ? source.currencies : [];
  if (explicit.length) return [...new Set(explicit.map(normalizeCurrency).filter(Boolean))];
  const overrideKeys = source.per_currency_overrides ? Object.keys(source.per_currency_overrides) : [];
  if (overrideKeys.length) return [...new Set(overrideKeys.map(normalizeCurrency).filter(Boolean))];
  const regions = Array.isArray(source.regions) ? source.regions : [];
  const REGION_TO_CCY = { MY: 'MYR', SG: 'SGD', ID: 'IDR', TH: 'THB', KH: 'USD' };
  return [...new Set(regions.map((r) => REGION_TO_CCY[r]).filter(Boolean))];
}

function _guessPlatform(brand, source) {
  if (Array.isArray(source.platforms) && source.platforms.length === 1) return source.platforms[0];
  if (typeof brand === 'string') {
    if (brand.startsWith('QPRO')) return 'qpro';
    if (brand.startsWith('QP2')) return 'qp2';
    if (brand.startsWith('WS1') || brand.startsWith('WS2')) return 'igmp';
  }
  return null;
}
