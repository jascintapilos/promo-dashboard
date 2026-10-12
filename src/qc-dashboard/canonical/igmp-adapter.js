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
import { regionsForBrand } from './locale-matrix.js';

const SITE_TO_CURRENCY = {
  'ws1-v3-my': 'MYR', 'ws1-v3-sg': 'SGD', 'ws1-v3-id': 'IDR',
  'ws1-v3-th': 'THB', 'ws1-v3-kh': 'USD',
  'ws2': 'MYR',
};

// Gap-closure item 1 (2026-08-10): the real live shape of
// /PM/GetPromotionRewardContents, verified across WS1_MY/SG/TH/ID/KH on
// multiple real promotions:
//   rewardContents: [{ RewardId, Locale, Content, PromotionRewardName }]
// This is NOT the `tnc.messages: [{locale, subject, message}]` shape an
// earlier report assumed — that assumption came from reading an old
// qc-bundle's captured shape without checking it against what this endpoint
// actually returns today. Corrected here from direct live evidence:
//   - `Locale` is a lowercase language code. Confirmed live: en, zh
//     (WS1_MY/SG), th (WS1_TH "88 Free Spins Welcome Bonus - Gates of
//     OlympusV1"), id (WS1_ID, same promo name), km (WS1_KH
//     "FT_VM_FC_VARIABLE_8X"). Never guessed — each was read off a real
//     promotion on that exact site.
//   - `PromotionRewardName` IS the localized promotion name — there is no
//     separate "subject" field on this endpoint at all.
//   - There is no separate T&C field either — Terms & Conditions are
//     embedded as HTML text inside `Content`, alongside the description and
//     how-to-apply steps (matches team memory: WS1 FC has no separate MT,
//     T&C lives in PromotionRewardContents). A regex/DOM split of T&C out
//     of that HTML was deliberately NOT attempted: the surrounding markup
//     is not structurally consistent enough across samples to trust a
//     heuristic split, and a wrong split risks fabricating a comparison
//     mismatch — worse than leaving the field whole. `Content` maps to
//     content.mtBody, matching the existing "MT-equivalent" treatment IGMP
//     content already gets elsewhere in this codebase.
function localesFromRewardContents(rewardContents) {
  const names = {};           // language -> localized promotion name
  const body = {};            // language -> combined HTML body (desc + how-to-apply + T&C)
  const declared = [];        // languages the BO actually returned an entry for
  for (const entry of (Array.isArray(rewardContents) ? rewardContents : [])) {
    if (!entry || typeof entry !== 'object') continue;
    const lang = String(entry.Locale || '').trim().toUpperCase();
    if (!lang) continue;
    if (!declared.includes(lang)) declared.push(lang);
    if (typeof entry.PromotionRewardName === 'string' && entry.PromotionRewardName) names[lang] = entry.PromotionRewardName;
    if (typeof entry.Content === 'string' && entry.Content) body[lang] = entry.Content;
  }
  return { names, body, declared };
}

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
  // Free Spin config is a nested object on the reward. Present on FS promos,
  // absent (or empty) on Deposit / Free Credit — hence the {} default.
  // Only treat it as a real FS config when a FreeSpinId is attached. Deposit
  // and Free Credit rewards can carry an empty/zeroed FreeSpin stub; reading
  // FreeSpinRounds off that yields 0, which would look like affirmative
  // evidence of "zero spins" instead of "not a Free Spin promo".
  const fsRaw = (r0.FreeSpin && typeof r0.FreeSpin === 'object') ? r0.FreeSpin : {};
  const fs = fsRaw.FreeSpinId ? fsRaw : {};

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
    // G5/G6 fix (2026-07-31): FreeSpinRounds and AmountPerBet ARE returned by
    // the API — nested under PromotionRewards[0].FreeSpin, not on the reward
    // root. The earlier "create-only, needs DOM scraping" conclusion was wrong;
    // it came from reading only the reward root, where `Quantity` is the
    // redeemable-claim count (NOT the spin count). Verified against a live
    // WS1_MY FS bundle: FreeSpin.FreeSpinRounds=68, FreeSpin.AmountPerBet=0.4.
    // AmountPerBet is already the player-facing per-spin value on IGMP (no
    // lines multiplier — AmountPerLine is 0 on these records), so it maps
    // straight to valuePerSpin with no conversion.
    spinCount: Number.isFinite(fs.FreeSpinRounds) ? fs.FreeSpinRounds
      : (fs.FreeSpinRounds != null && fs.FreeSpinRounds !== '' && Number.isFinite(Number(fs.FreeSpinRounds)) ? Number(fs.FreeSpinRounds) : null),
    valuePerSpin: normalizeDecimal(fs.AmountPerBet),
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

  // Region-prefixed locale keys (e.g. "TH_EN"/"TH_TH") come from the
  // brand's OWN region — every IGMP site is single-region already, unlike
  // QP2's shared multi-region BO, so there is no ambiguity to resolve here.
  const region = regionsForBrand(brand)[0] || null;
  const rc = localesFromRewardContents(liveState.rewardContents);
  for (const [lang, name] of Object.entries(rc.names)) {
    c.content.names[lang] = name;
    if (region) c.content.promotionNamesByLocale[`${region}_${lang}`] = name;
  }
  for (const [lang, html] of Object.entries(rc.body)) c.content.mtBody[lang] = html;
  if (region) {
    for (const lang of rc.declared) {
      const localeKey = `${region}_${lang}`;
      if (!c.content.localesDeclared.includes(localeKey)) c.content.localesDeclared.push(localeKey);
    }
    c.content.localesDeclared.sort();
  }
  // row.PromotionName is a fallback ONLY — PromotionRewardContents is the
  // authoritative, per-locale-verified source. Covers the case where no
  // RewardId was resolvable at all (e.g. a bonus type GetBonusInfo doesn't
  // model, such as "LuckyWheel" — confirmed live on WS1_ID/TH/KH), so the
  // canonical still carries SOME name rather than nothing.
  if (row.PromotionName && c.content.names.EN == null) c.content.names.EN = row.PromotionName;

  // IGMP has no MT/dialog linkage concept — T&C is embedded in reward contents.
  c.linkage.templateId = null;
  c.linkage.dialogPopupId = null;
  c.linkage.dialogPopupList = [];
  c.linkage.promotionListIds = [];

  c.autoReward.autoRewardActivation = null; // not a concept on IGMP

  return c;
}
