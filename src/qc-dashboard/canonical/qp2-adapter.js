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
import {
  messageTemplatesFromRow, dialogLinkageFromRow,
  categoriesFromShortCodesDetailed, autoRewardFromRow, promotionNamesFrom,
  gameProviderCodesFromRow,
} from './listing-row-fields.js';
import { checkProviderCodesAgainstCatalogue } from './catalogues.js';
import { resolveDialogBodiesForPromotion } from './dialog-bodies.js';

const CURRENCY_ID_MAP = { 1: 'MYR', 3: 'SGD', 4: 'IDR', 5: 'THB' };

// `opts.catalogue` = { categories, providers } — see qpro-adapter.js's doc
// comment; same optional live-catalogue contract, same static-map fallback.
export function liveFromQp2(liveState, { brand, promoCode, catalogue = null } = {}) {
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
      // Gap-closure fix (2026-08-11): QP2's per-currency row has no
      // free_credit_amount column — verified live on
      // WHALE_VM_PROBE_NODEP_FC138_20X (QP2A): pc.free_credit_amount was
      // undefined while pc.bonus_amount was "138.00", matching the promo's
      // own "FC138" code. QP2 reuses the generic bonus_amount column for
      // both Deposit (bonus_type 2, where it sits at "0.00" because the
      // real value is bonus_rate) and Free Credit (bonus_type 1, where it
      // IS the free credit amount) — same ambiguity src/api-mapper-qpro.js
      // and this file's own qpro-adapter.js sibling already resolve via
      // the identical `?? pc.bonus_amount` fallback. Without it, every QP2
      // Free Credit promo reported freeCreditAmount UNAVAILABLE regardless
      // of live BO reality.
      freeCreditAmount: normalizeDecimal(pc.free_credit_amount ?? pc.bonus_amount),
      spinCount: Number.isFinite(pc.rounds ?? pc.spin_count) ? (pc.rounds ?? pc.spin_count) : null,
      valuePerSpin: vps.valuePerSpin,
      linesPerSpin: vps.linesPerSpin,
      valuePerSpinInconclusive: vps.inconclusive,
      valuePerSpinNote: vps.note,
      amountPerLine: vps.amountPerLine,
      // G1 fix (same as qpro-adapter): raw BO response exposes the turnover
      // multiplier at detail.target[0].multiplier; the api-client normalized
      // record exposes it as detail.to_multiplier. Read both, plus a pc-row
      // override, so the value resolves whichever layer produced `detail`.
      toMultiplier: normalizeDecimal(
        pc.to_multiplier
        ?? detail.to_multiplier
        ?? (Array.isArray(detail.target) ? detail.target[0]?.multiplier : undefined),
      ),
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

  // G9 fix: fall back to the listing row's short-code string ("SL" / "SL, LC")
  // when detail.categories is absent, so a category-restricted promo never
  // looks unrestricted.
  const detailCats = normalizeCategoriesArray(detail.categories || detail.game_categories);
  let categoryResolution = null;
  if (detailCats.length) {
    c.scope.categories = detailCats;
  } else {
    categoryResolution = categoriesFromShortCodesDetailed(row.category, { catalogue: catalogue?.categories });
    c.scope.categories = categoryResolution.categories;
  }
  c.scope.gameProviderIds = Array.isArray(detail.game_provider_ids) ? [...detail.game_provider_ids].sort() : [];
  // Gap-closure item 3: fallback ORDER, not a union — see
  // gameProviderCodesFromRow's doc comment in listing-row-fields.js for the
  // live evidence proving the old union quietly widened every promo's
  // provider scope with codes from the listing row that don't actually
  // belong to that specific promo.
  const providerResolution = gameProviderCodesFromRow({ row, detail });
  c.scope.gameProviderCodes = providerResolution.codes;
  c.scope.blacklistId = detail.blacklist_id ?? null;
  c.scope.blacklistedProviders = [];
  // Item 2 evidence: see canonical-model.js scope.*Evidence doc comment.
  c.scope.categoriesEvidence = categoryResolution
    ? { unmapped: categoryResolution.unmapped, complete: categoryResolution.complete, catalogue: categoryResolution.catalogue }
    : { unmapped: [], complete: true, catalogue: null };
  c.scope.gameProviderCodesEvidence = checkProviderCodesAgainstCatalogue(catalogue?.providers, c.scope.gameProviderCodes);
  c.scope.gameProviderCodesSource = providerResolution.source;

  // G2: message-template bodies are ALREADY on the listing row at
  // list_row.message_templates[] = {settings_locale_id, subject, message}.
  // No per-template follow-up fetch is needed.
  //
  // CORRECTNESS GATE: the MT subject is stored ONLY under
  // content.messageTemplate.subjectByLocale. It must never be written into
  // content.names, which is the PROMOTION NAME. The two legitimately differ
  // (QPRO1/P026-r27: name "88% Slots Reload Bonus" vs subject "Exclusive
  // Reload Bonus - Claim Yours - 88% Bonus"); conflating them would either
  // fabricate a mismatch or mask a real promo-name defect.
  const mt = messageTemplatesFromRow(row);
  for (const [lang, body] of Object.entries(mt.mtBody)) c.content.mtBody[lang] = body;
  for (const [locale, entry] of Object.entries(mt.byLocale)) {
    if (entry.subject != null) c.content.messageTemplate.subjectByLocale[locale] = entry.subject;
    if (entry.message != null) c.content.messageTemplate.bodyByLocale[locale] = entry.message;
  }
  c.content.messageTemplate.templateIds = mt.templateIds;

  // PROMOTION NAMES from the authoritative promotion-name source.
  const pn = promotionNamesFrom({ detail, row });
  for (const [lang, name] of Object.entries(pn.byLanguage)) c.content.names[lang] = name;
  c.content.promotionNamesByLocale = pn.byLocale;
  c.content.localesDeclared = pn.localesDeclared;

  if (tnc && tnc.messages) {
    for (const [locale, msg] of Object.entries(tnc.messages)) {
      if (msg && msg.body) c.content.mtBody[locale.toUpperCase()] = msg.body;
      // A tnc subject is still an MT subject - never a promotion name.
      if (msg && msg.subject) c.content.messageTemplate.subjectByLocale[locale.toUpperCase()] = msg.subject;
    }
  }

  c.linkage.templateId = row.message_template_id ?? detail.message_template_id ?? mt.templateIds[0] ?? null;
  const dialog = dialogLinkageFromRow(row);
  c.linkage.dialogPopupList = dialog.popupIds;
  c.linkage.dialogPopupId = dialog.popupIds[0] ?? null;
  c.linkage.promotionListIds = Array.isArray(row.merchant_ids) ? [...row.merchant_ids].sort() : [];

  // Item 4: actual dialog bodies — see qpro-adapter.js's identical block for
  // the full doc comment. No merchantId cross-check here: unlike categories/
  // providers (item 2), there's no verified evidence that a QP2 popup's
  // site_id uses the same numbering as merchant_id, so asserting that filter
  // would risk an unverified guess. Identity is still enforced via the exact
  // promotion-ID match and duplicate/stale rejection in resolveDialogBodiesForPromotion.
  if (catalogue?.popups) {
    const dlg = resolveDialogBodiesForPromotion({
      dialogLinks: row.dialog_popup_list, promotionId: row.id ?? detail.id, catalogue: catalogue.popups,
    });
    c.content.dialogBody = dlg.dialogBody;
    c.content.dialogBodyByLocale = dlg.dialogBodyByLocale;
    c.content.dialogTitleByLocale = dlg.dialogTitleByLocale;
    c.content.dialogEvidence = { matchedPopupIds: dlg.matchedPopupIds, rejected: dlg.rejected, catalogueSource: dlg.catalogueSource };
    for (const l of dlg.localesDeclared) if (!c.content.localesDeclared.includes(l)) c.content.localesDeclared.push(l);
    c.content.localesDeclared.sort();
  }

  // G4: QP2 exposes auto_reward_activation on the listing row (and sometimes
  // on detail). Reading only detail missed the QP2D case where detail lacks it.
  c.autoReward.autoRewardActivation = autoRewardFromRow({ row, detail, platform: 'qp2' });

  return c;
}
