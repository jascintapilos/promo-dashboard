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
import {
  messageTemplatesFromRow, dialogLinkageFromRow,
  categoriesFromShortCodesDetailed, autoRewardFromRow, promotionNamesFrom,
  gameProviderCodesFromRow,
} from './listing-row-fields.js';
import { checkProviderCodesAgainstCatalogue } from './catalogues.js';
import { resolveDialogBodiesForPromotion } from './dialog-bodies.js';

const CURRENCY_ID_MAP = { 1: 'MYR', 3: 'SGD', 4: 'IDR', 5: 'THB' }; // per memory/project_bo_currency_id_catalog.md

// `opts.catalogue` = { categories, providers } — the live per-site
// catalogues from catalogues.js (item 2). Optional: omitting it falls back
// to the small pre-verified static map in listing-row-fields.js, exactly as
// before catalogues existed — no caller is forced to fetch a catalogue to
// keep working (bundle-replay / unit tests never will).
export function liveFromQpro(liveState, { brand, promoCode, catalogue = null } = {}) {
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
      // Gap-closure fix (2026-08-11): same shape problem as toMultiplier
      // above. QPRO's /api/bo/promotioncurrency row has no bonus_rate
      // column at all (verified live on WHALE_CRM_PROBE_DEP50PCT_500_12X —
      // the per-currency row carries min_transfer/max_bonus/rounds/etc but
      // never bonus_rate); the value lives only on the top-level detail
      // object (detail.bonus_rate: 50.00 for that same promo, matching the
      // "DEP50PCT" in its own code). Reading pc.bonus_rate alone made every
      // QPRO Deposit promo report bonusRatePct UNAVAILABLE regardless of
      // live BO reality. QP2's per-currency row DOES carry its own
      // bonus_rate (verified live on the same promo code on QP2A) — this
      // fallback is additive and never overrides a real per-currency value.
      bonusRatePct: normalizeDecimal(pc.bonus_rate ?? detail.bonus_rate),
      freeCreditAmount: normalizeDecimal(pc.free_credit_amount ?? pc.bonus_amount),
      spinCount: Number.isFinite(pc.rounds ?? pc.spin_count) ? (pc.rounds ?? pc.spin_count) : null,
      valuePerSpin: vps.valuePerSpin,
      linesPerSpin: vps.linesPerSpin,
      valuePerSpinInconclusive: vps.inconclusive,
      valuePerSpinNote: vps.note,
      amountPerLine: vps.amountPerLine,     // raw wire, for audit trail
      // G1 fix: turnover multiplier has TWO shapes depending on which layer
      // produced `detail`:
      //   raw BO response (/api/bo/promotion/{id} via fetch-promo.js) →
      //       detail.target[0].multiplier          ← authoritative, see
      //       src/api-client.js:515 which derives to_multiplier from it
      //   api-client normalized record (qc-bundles live_state.detail) →
      //       detail.to_multiplier
      // Reading only `to_multiplier` made every live QC-Hub run report
      // toMultiplier UNAVAILABLE (observed on QPRO5 + QP2A in production
      // acceptance). Check pc-row override, then both detail shapes.
      toMultiplier: normalizeDecimal(
        pc.to_multiplier
        ?? detail.to_multiplier
        ?? (Array.isArray(detail.target) ? detail.target[0]?.multiplier : undefined),
      ),
      maxTransferOut: normalizeDecimal(pc.max_transfer_out),
      withdrawalCap: normalizeDecimal(pc.max_withdraw),
      active: pc.status != null ? (pc.status === 1 || pc.status === '1' || pc.status === true) : null,
    };
  });

  c.eligibility.isVip = null; // not directly exposed on QPRO
  c.eligibility.memberTierIds = Array.isArray(detail.member_tier_ids) ? [...detail.member_tier_ids] : [];
  c.eligibility.memberGroupIds = Array.isArray(row.member_group_ids) ? [...row.member_group_ids] : []; // QPRO always [] — suppressed at compare
  c.eligibility.redemptionType = null;

  // G9 fix: categories come from detail when present, else from the listing
  // row's short-code string ("SL" / "SL, LC"). detail.categories is often
  // absent, which previously left scope.categories empty and made a
  // category-restricted promo look unrestricted.
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
  // gameProviderCodesFromRow's doc comment in listing-row-fields.js.
  // detail.game_provider_codes is frequently genuinely absent on QPRO
  // (confirmed live), so the listing-row string remains the fallback of
  // last resort — it's just no longer unioned on TOP of a complete detail
  // answer, which was quietly widening the resolved scope.
  const providerResolution = gameProviderCodesFromRow({ row, detail });
  c.scope.gameProviderCodes = providerResolution.codes;
  c.scope.blacklistId = detail.blacklist_id ?? null;
  c.scope.blacklistedProviders = [];
  // Item 2 evidence: see canonical-model.js scope.*Evidence doc comment.
  // detail.categories was already an unambiguous name list — nothing to
  // resolve, so it's reported complete without a catalogue reference.
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
  c.linkage.promotionListIds = [];

  // Item 4: actual dialog BODIES, separate from both the MT body and the
  // promotion name — see dialog-bodies.js's doc comment for the identity
  // matching this performs (exact promotion-ID match, duplicate/stale
  // rejection). Only runs when a popup catalogue was supplied; without one
  // this stays empty exactly as before item 4 (linkage IDs only, no body).
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

  // G4 fix, proven item 3 (see listing-row-fields.js autoRewardFromRow doc
  // comment for the full evidence): QPRO has NO auto_reward_activation key
  // anywhere in the API. Its equivalent is `auto_approve` — proven via the
  // BO's own compiled frontend (toggle label "Auto Approve", tooltip "Auto
  // approves promotion applied or claimed from user portal by the user")
  // plus a live sweep finding real ON/OFF variance across all 17 QPRO
  // brands. autoRewardFromRow() now trusts auto_approve by default and
  // still returns null (never a silent false) when no source carries any
  // form of the flag.
  c.autoReward.autoRewardActivation = autoRewardFromRow({ row, detail, platform: 'qpro' });

  return c;
}
