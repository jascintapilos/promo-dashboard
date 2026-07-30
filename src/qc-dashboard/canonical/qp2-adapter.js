// Increment 4 (real-QC upgrade): QP2 live-BO snapshot → canonical.
//
// Shape mirrors QPRO but with QP2-specific fields per sentinel.toml:
// - list_row.merchant_ids (multi-merchant: QP2A/B/C/D count check)
// - list_row.deposit_status label ("None"|"Last Deposit")
// - detail.allow_deposit must be false
// - detail.freespin_check must be true on FS
// - target[].game_provider_codes (QP2-specific path)
// - promotion_currency_list rows carry {currency, currency_id, min_transfer,
//   free_credit_amount, amount_per_line, max_total_*, max_withdraw}

import {
  newCanonical, normalizeBonusType, normalizeCurrency, normalizeCategoriesArray,
  normalizeDate, normalizeDecimal, normalizeBool,
} from './canonical-model.js';
import { deriveValuePerSpin } from './value-per-spin.js';

const CURRENCY_ID_MAP = { 1: 'MYR', 3: 'SGD', 4: 'IDR', 5: 'THB' };

export function liveFromQp2(liveState, { brand, promoCode } = {}) {
  if (!liveState || typeof liveState !== 'object') {
    throw new Error('liveFromQp2: liveState must be an object');
  }
  const row = liveState.list_row || {};
  const detail = liveState.detail || {};
  const tnc = liveState.tnc || null;

  const c = newCanonical();
  c.identity.promoCode = row.code || promoCode || null;
  c.identity.promotionId = row.id || detail.id || null;
  // QP2 quirk (same as QPRO): detail.bonus_type mislabels promo_type=2 as
  // "Cashback"; use list_row.bonus_type as the authoritative label.
  c.identity.bonusType = normalizeBonusType(row.bonus_type);
  c.identity.bonusSubType = row.bonus_type || null;
  c.identity.brand = brand || null;
  c.identity.platform = 'qp2';

  c.schedule.startDate = normalizeDate(row.valid_from || detail.start_date);
  c.schedule.endDate = normalizeDate(row.valid_to || detail.end_date);
  c.schedule.recurring = normalizeBool(row.recurring);
  c.schedule.validityDays = Number.isFinite(row.validity) ? row.validity : (Number.isFinite(detail.validity) ? detail.validity : null);
  c.schedule.rewardValidityDays = Number.isFinite(row.reward_validity) ? row.reward_validity : (Number.isFinite(detail.reward_validity) ? detail.reward_validity : null);
  c.schedule.isActive = row.status != null ? (row.status === 1 || row.status === '1') : null;

  const pcList = Array.isArray(detail.promotion_currency_list) ? detail.promotion_currency_list : [];
  c.currencies = pcList.map((pc) => {
    const code = normalizeCurrency(pc.currency || CURRENCY_ID_MAP[pc.currency_id]);
    // Blocker fix (Real-QC): value-per-spin unit conversion. QP2 stores
    // pc.lines = 0 → the shared resolver falls back to the game-code
    // catalog (Pragmatic Play vs<N> convention, Playtech gpas_*_pop = 1)
    // via src/fs-lines-resolver.js. Same source of truth used by canary
    // reads (src/api-client.js:462-482).
    const vps = deriveValuePerSpin({ pc, detail, platform: 'qp2' });
    return {
      code,
      minDeposit: normalizeDecimal(pc.min_transfer),
      maxBonus: normalizeDecimal(pc.max_bonus),
      bonusRatePct: normalizeDecimal(pc.bonus_rate ?? pc.bonus_rate_pct),
      freeCreditAmount: normalizeDecimal(pc.free_credit_amount),
      spinCount: Number.isFinite(pc.rounds ?? pc.spin_count) ? (pc.rounds ?? pc.spin_count) : null,
      valuePerSpin: vps.valuePerSpin,
      linesPerSpin: vps.linesPerSpin,
      valuePerSpinInconclusive: vps.inconclusive,
      valuePerSpinNote: vps.note,
      amountPerLine: vps.amountPerLine,
      toMultiplier: normalizeDecimal(detail.to_multiplier),
      maxTransferOut: normalizeDecimal(pc.max_transfer_out),
      // QP2 quirk: max_total_* / max_withdraw null → Unlimited (not missing)
      withdrawalCap: pc.max_withdraw != null ? normalizeDecimal(pc.max_withdraw) : null,
      active: pc.status != null ? (pc.status === 1 || pc.status === '1' || pc.status === true) : null,
    };
  });

  c.eligibility.isVip = null;
  c.eligibility.memberTierIds = Array.isArray(detail.member_tier_ids) ? [...detail.member_tier_ids] : [];
  c.eligibility.memberGroupIds = Array.isArray(row.member_group_ids) ? [...row.member_group_ids] : [];
  c.eligibility.redemptionType = null;

  c.scope.categories = normalizeCategoriesArray(detail.categories || detail.game_categories);
  c.scope.gameProviderIds = Array.isArray(detail.game_provider_ids) ? [...detail.game_provider_ids].sort() : [];
  // QP2: target[].game_provider_codes when detail.target is populated
  const targetCodes = Array.isArray(detail.target)
    ? detail.target.flatMap((t) => Array.isArray(t.game_provider_codes) ? t.game_provider_codes : [])
    : [];
  const legacyCodes = Array.isArray(detail.game_provider_codes) ? detail.game_provider_codes : [];
  c.scope.gameProviderCodes = [...new Set([...targetCodes, ...legacyCodes])].sort();
  c.scope.blacklistId = detail.blacklist_id ?? null;
  c.scope.blacklistedProviders = [];

  if (tnc && tnc.messages) {
    for (const [locale, msg] of Object.entries(tnc.messages)) {
      if (msg && msg.body) c.content.mtBody[locale.toUpperCase()] = msg.body;
      if (msg && msg.subject) c.content.names[locale.toUpperCase()] = msg.subject;
    }
  }

  c.linkage.templateId = row.message_template_id ?? detail.message_template_id ?? null;
  const dpl = Array.isArray(row.dialog_popup_list) ? row.dialog_popup_list : [];
  c.linkage.dialogPopupList = dpl.map((d) => d.popup_id ?? d.id ?? null).filter((x) => x != null);
  c.linkage.dialogPopupId = c.linkage.dialogPopupList[0] ?? null;
  c.linkage.promotionListIds = Array.isArray(row.merchant_ids) ? [...row.merchant_ids].sort() : [];

  c.autoReward.autoRewardActivation = normalizeBool(detail.auto_reward_activation);

  return c;
}
