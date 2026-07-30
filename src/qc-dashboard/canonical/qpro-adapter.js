// Increment 4 (real-QC upgrade): QPRO live-BO snapshot → canonical.
//
// live_state shape (from qc-bundles):
//   list_row: { id, name, code, bonus_type, promo_type, promo_sub_type,
//               valid_from, valid_to, validity, reward_validity, ... }
//   detail:   { promotion_currency_list[], auto_reward_activation, categories,
//               game_provider_ids, blacklist_id, per_currency_overrides, ... }
//   tnc:      { messages: { EN, ZH }, checks: { sentence_11_has_link } }
//   popup:    dialog popup payload
//
// Platform quirks encoded per sentinel.toml:
// - detail.bonus_type always returns "Cashback" for promo_type=2 (API bug).
//   Use list_row.bonus_type instead.
// - detail.auto_reward_activation is never returned by GET. Canonical value
//   stays null → compare engine emits INCONCLUSIVE (never FAIL).

import {
  newCanonical, normalizeBonusType, normalizeCurrency, normalizeCategoriesArray,
  normalizeDate, normalizeDecimal, normalizeBool,
} from './canonical-model.js';
import { deriveValuePerSpin } from './value-per-spin.js';

const CURRENCY_ID_MAP = { 1: 'MYR', 3: 'SGD', 4: 'IDR', 5: 'THB' }; // per memory/project_bo_currency_id_catalog.md

export function liveFromQpro(liveState, { brand, promoCode } = {}) {
  if (!liveState || typeof liveState !== 'object') {
    throw new Error('liveFromQpro: liveState must be an object');
  }
  const row = liveState.list_row || {};
  const detail = liveState.detail || {};
  const tnc = liveState.tnc || null;

  const c = newCanonical();
  c.identity.promoCode = row.code || promoCode || null;
  c.identity.promotionId = row.id || detail.id || null;
  // QPRO quirk: prefer list_row.bonus_type over detail.bonus_type ("Cashback" is a mislabel).
  c.identity.bonusType = normalizeBonusType(row.bonus_type);
  c.identity.bonusSubType = row.bonus_type || null; // preserve raw label (e.g. "Deposit - Reload")
  c.identity.brand = brand || null;
  c.identity.platform = 'qpro';

  c.schedule.startDate = normalizeDate(row.valid_from || detail.start_date);
  c.schedule.endDate = normalizeDate(row.valid_to || detail.end_date);
  c.schedule.recurring = normalizeBool(row.recurring);
  c.schedule.validityDays = Number.isFinite(row.validity) ? row.validity : (Number.isFinite(detail.validity) ? detail.validity : null);
  c.schedule.rewardValidityDays = Number.isFinite(row.reward_validity) ? row.reward_validity : (Number.isFinite(detail.reward_validity) ? detail.reward_validity : null);
  c.schedule.isActive = row.status != null ? (row.status === 1 || row.status === '1') : null;

  const pcList = Array.isArray(detail.promotion_currency_list) ? detail.promotion_currency_list : [];
  // Blocker 4 fix (Real-QC): QPRO stores per-currency values on the currency
  // rows themselves (as returned by /api/bo/promotioncurrency). The previous
  // implementation read fields off `detail` directly (which never carries
  // per-currency numbers), so every currency-scoped compare came back null →
  // MANUAL_REQUIRED. Now we read from `pc` (row) with the same field names
  // used by src/api-client.js getPromotionDetail — see the "quirky API"
  // comment there. Fields on the currency row:
  //   min_transfer / min_deposit, max_bonus, max_transfer_out,
  //   free_credit_amount / bonus_amount (QP2 alias), bonus_rate,
  //   rounds (spin count), amount_per_line, max_withdraw
  c.currencies = pcList.map((pc) => {
    const code = normalizeCurrency(pc.currency || CURRENCY_ID_MAP[pc.currency_id]);
    // Blocker fix (Real-QC): value-per-spin derivation via the shared
    // resolver. Source declares player-facing value_per_spin; BO stores
    // amount_per_line (per-line bet). Direct compare produced a false FAIL
    // for PP games (0.02 raw × 20 lines = 0.40 player-facing). See
    // src/qc-dashboard/canonical/value-per-spin.js for the resolution
    // order — same one src/api-client.js uses for canary reads.
    const vps = deriveValuePerSpin({ pc, detail, platform: 'qpro' });
    return {
      code,
      minDeposit: normalizeDecimal(pc.min_transfer ?? pc.min_deposit),
      maxBonus: normalizeDecimal(pc.max_bonus),
      bonusRatePct: normalizeDecimal(pc.bonus_rate),
      freeCreditAmount: normalizeDecimal(pc.free_credit_amount ?? pc.bonus_amount),
      spinCount: Number.isFinite(pc.rounds ?? pc.spin_count) ? (pc.rounds ?? pc.spin_count) : null,
      valuePerSpin: vps.valuePerSpin,
      linesPerSpin: vps.linesPerSpin,
      valuePerSpinInconclusive: vps.inconclusive,
      valuePerSpinNote: vps.note,
      amountPerLine: vps.amountPerLine,     // raw wire, for audit trail
      // to_multiplier lives on the top-level detail (single value across
      // currencies) — keep the fallback so an override on the pc row wins.
      toMultiplier: normalizeDecimal(pc.to_multiplier ?? detail.to_multiplier),
      maxTransferOut: normalizeDecimal(pc.max_transfer_out),
      withdrawalCap: normalizeDecimal(pc.max_withdraw),
      active: pc.status != null ? (pc.status === 1 || pc.status === '1' || pc.status === true) : null,
    };
  });

  c.eligibility.isVip = null; // not directly exposed on QPRO
  c.eligibility.memberTierIds = Array.isArray(detail.member_tier_ids) ? [...detail.member_tier_ids] : [];
  c.eligibility.memberGroupIds = Array.isArray(row.member_group_ids) ? [...row.member_group_ids] : []; // QPRO always [] — suppressed at compare
  c.eligibility.redemptionType = null;

  c.scope.categories = normalizeCategoriesArray(detail.categories || detail.game_categories);
  c.scope.gameProviderIds = Array.isArray(detail.game_provider_ids) ? [...detail.game_provider_ids].sort() : [];
  c.scope.gameProviderCodes = Array.isArray(detail.game_provider_codes) ? [...detail.game_provider_codes].sort() : [];
  c.scope.blacklistId = detail.blacklist_id ?? null;
  c.scope.blacklistedProviders = [];

  if (tnc && tnc.messages) {
    for (const [locale, msg] of Object.entries(tnc.messages)) {
      if (msg && msg.body) c.content.mtBody[locale.toUpperCase()] = msg.body;
      if (msg && msg.subject && !c.content.names[locale.toUpperCase()]) c.content.names[locale.toUpperCase()] = msg.subject;
    }
  }

  c.linkage.templateId = row.message_template_id ?? detail.message_template_id ?? null;
  c.linkage.dialogPopupId = null;
  const dpl = Array.isArray(row.dialog_popup_list) ? row.dialog_popup_list : [];
  c.linkage.dialogPopupList = dpl.map((d) => d.popup_id ?? d.id ?? null).filter((x) => x != null);
  if (c.linkage.dialogPopupList.length > 0) c.linkage.dialogPopupId = c.linkage.dialogPopupList[0];
  c.linkage.promotionListIds = [];

  // QPRO auto_reward_activation is never returned by the GET endpoint — leave null.
  c.autoReward.autoRewardActivation = detail.auto_reward_activation ?? null;

  return c;
}
