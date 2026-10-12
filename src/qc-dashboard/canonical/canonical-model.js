// Increment 4 (real-QC upgrade): canonical BO/expected model.
//
// A single flat shape both the approved-request source and the live BO
// snapshot project into. The compare engine (Increment 5) diffs two
// canonicals field-by-field with deterministic rules.
//
// Design choices:
// - Missing values are `null`, never `undefined`. Callers distinguish
//   "unknown" (null) from "known empty" ([] or 0). Increment 5 turns null
//   in a critical field into MANUAL_REQUIRED, not FAIL.
// - Per-currency mechanics live under `currencies[]` (array of records
//   keyed by currency code) so unordered comparison is easy.
// - Localized content (name / MT body / dialog / TnC clauses) lives under
//   `content[locale]` maps for the same reason.
// - Raw payload + source path are preserved on the return envelope so
//   evidence links in the UI can point back to the exact captured JSON.

export const CANONICAL_VERSION = 1;

// Bonus type enum — normalized. Source and live BO both use different names
// per platform; adapters map to these.
export const BONUS_TYPES = Object.freeze({
  DEPOSIT: 'DEPOSIT',   // "Deposit - Reload", "Deposit - Welcome", "Bonus" (IGMP)
  FREE_CREDIT: 'FREE_CREDIT', // "Free Credit", "FreeCredit"
  FREE_SPIN: 'FREE_SPIN',    // "Free Spin", "FreeSpin"
  CASHBACK: 'CASHBACK',      // rarely used for MVP but reserved
  OTHER: 'OTHER',
});

export function newCanonical() {
  return {
    canonicalVersion: CANONICAL_VERSION,
    identity: {
      promoCode: null,
      promotionId: null,
      bonusType: null,       // BONUS_TYPES.*
      bonusSubType: null,    // free-form label, e.g. "Reload" / "Welcome"
      brand: null,
      platform: null,        // 'qp2' | 'qpro' | 'igmp'
    },
    schedule: {
      startDate: null,       // ISO string
      endDate: null,
      recurring: null,       // boolean | null
      validityDays: null,    // number of days after claim
      rewardValidityDays: null, // claim-window before claim
      isActive: null,        // boolean | null (from list_row / IsActive)
    },
    // currencies[i] = { code, minDeposit, maxBonus, bonusRatePct, freeCreditAmount,
    //                   spinCount, valuePerSpin, toMultiplier, maxTransferOut,
    //                   withdrawalCap, active }
    currencies: [],
    eligibility: {
      isVip: null,
      memberTierIds: [],
      memberGroupIds: [],
      redemptionType: null,  // 0=deposit, 1=claim (IGMP FS)
    },
    scope: {
      categories: [],        // e.g. ["SLOTS"], ["LIVE_CASINO"] — normalized upper snake
      gameProviderIds: [],   // numeric ids where BO exposes them (QPRO)
      gameProviderCodes: [], // string codes (QP2, IGMP)
      blacklistId: null,
      blacklistedProviders: [],
      // Item 2 evidence (collector Phase 3): completeness of the code
      // resolution above, sourced from catalogues.js's live per-site
      // catalogue when one was supplied. Auxiliary only — compare-engine.js
      // reads scope.categories/gameProviderIds/gameProviderCodes by exact
      // name, never these siblings, so they can never affect a PASS/FAIL
      // rule. Defaults assume nothing was left unresolved (true on the
      // expected side, which never has codes to resolve in the first place).
      categoriesEvidence: { unmapped: [], complete: true, catalogue: null },
      gameProviderCodesEvidence: { checked: false, unknownCodes: [], catalogueComplete: false, source: null },
      // Gap-closure item 3: WHERE gameProviderCodes was actually resolved
      // from — 'detail' | 'target' | 'listing-row' | 'none' on the live
      // side (see gameProviderCodesFromRow in listing-row-fields.js), null
      // on the expected side (the approved source has no such distinction).
      // Auxiliary/non-comparison, same guarantee as the two fields above.
      gameProviderCodesSource: null,
    },
    content: {
      // PROMOTION NAME — the player-facing promo title, authoritative source
      // is /api/bo/promotionname (QPRO/QP2) or PromotionName (IGMP).
      // Language-keyed for backwards compatibility with the compare engine.
      names: {},                     // { EN: "88% Slots Reload Bonus", ZH: "…" }
      // Locale-keyed (MY_EN / SG_EN / MY_ZH / ID_ID …) because a promo can
      // carry a different name per region even within one language.
      promotionNamesByLocale: {},    // { MY_EN: "…", SG_EN: "…", MY_ZH: "…" }

      // MESSAGE TEMPLATE — the inbox message. Its subject is a DIFFERENT
      // field from the promotion name and must never overwrite it. Team
      // convention has them intentionally divergent: promo name comes from
      // the request's column M, inbox subject is "Exclusive Offer…".
      // Observed on QPRO1/P026-r27:
      //   promotion name : "88% Slots Reload Bonus"
      //   MT subject     : "Exclusive Reload Bonus — Claim Yours — 88% Bonus"
      messageTemplate: {
        subjectByLocale: {},         // { MY_EN: "…", SG_ZH: "…" }
        bodyByLocale: {},            // { MY_EN: "<p>…", … }
        templateIds: [],
      },
      mtBody: {},            // { EN: "…", ZH: "…" } — language-keyed MT body
      dialogBody: {},        // { EN: "…", ZH: "…" }
      dialogBodyByLocale: {},// { MY_EN: "…", … } — locale-keyed dialog body
      dialogTitleByLocale: {}, // { MY_EN: "…", … } — the popup's own heading, separate from both the promotion name and the dialog body
      tncClauses: [],        // ordered list of clauses if the BO exposes them

      // Locale bookkeeping so a missing required localization is detectable
      // rather than silently absent. `localesDeclared` is what the BO says
      // the promo has; the locale-matrix module compares it against what the
      // brand REQUIRES and what we actually collected.
      localesDeclared: [],   // e.g. ["MY_EN","MY_ZH","SG_EN","SG_ZH"]

      // Item 4 evidence: which dialog links were rejected (stale/duplicate/
      // ambiguous/cross-merchant) and which were actually matched+attributed.
      // Auxiliary only, same non-comparison guarantee as scope.*Evidence
      // above — compare-engine.js never reads this field.
      dialogEvidence: { matchedPopupIds: [], rejected: [], catalogueSource: null },
    },
    linkage: {
      templateId: null,
      dialogPopupId: null,
      dialogPopupList: [],   // for QP2 multi-merchant
      promotionListIds: [],  // for WS1 promotion-suite linkage
    },
    autoReward: {
      autoRewardActivation: null, // true | false | null (QPRO always null — API quirk)
    },
    // Preserve source-side evidence — where each canonical value came from.
    // Increment 5 populates `_evidence[fieldPath] = { rawValue, sourcePath }`
    // so the UI can render evidence links. Kept minimal here.
    _evidence: {},
  };
}

// Normalize free-form bonus_type labels (from source or from live BO) to the
// BONUS_TYPES enum. Deterministic, no regex heuristics — an unrecognized
// label maps to OTHER (never guesses to DEPOSIT).
export function normalizeBonusType(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const upper = s.toUpperCase().replace(/[\s_\-]+/g, ' ');
  if (/^BONUS$/.test(upper)) return BONUS_TYPES.DEPOSIT;
  if (/^DEPOSIT\b/.test(upper)) return BONUS_TYPES.DEPOSIT;
  // Match the type prefix, not strict equality — real bundles emit
  // "Free Spin - Reload" / "Free Spin - Welcome" / "Free Credit" all under
  // one canonical bucket. The dash/underscore/space collapse above already
  // normalized separators, so a startsWith is enough.
  if (/^FREE CREDIT\b/.test(upper) || upper === 'FREECREDIT') return BONUS_TYPES.FREE_CREDIT;
  if (/^FREE SPIN\b/.test(upper) || upper === 'FREESPIN') return BONUS_TYPES.FREE_SPIN;
  if (upper === 'CASHBACK') return BONUS_TYPES.CASHBACK;
  return BONUS_TYPES.OTHER;
}

// Currency code normalization — 3-letter uppercase; lowercase/whitespace
// tolerated. Returns null when the input isn't a plausible ISO code.
export function normalizeCurrency(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(s)) return null;
  return s;
}

// Category normalization — deterministic map from common source vocabulary
// to a stable canonical token. Unknown → OTHER (never guessed to SLOTS).
const CATEGORY_MAP = {
  'SLOT': 'SLOTS',
  'SLOTS': 'SLOTS',
  'LIVE CASINO': 'LIVE_CASINO',
  'LIVE_CASINO': 'LIVE_CASINO',
  'LC': 'LIVE_CASINO',
  'SPORTS': 'SPORTS',
  'SPORT': 'SPORTS',
  'FISHING': 'FISHING',
  'ARCADE': 'ARCADE',
};
export function normalizeCategory(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase().replace(/[\s_\-]+/g, ' ');
  return CATEGORY_MAP[s] || CATEGORY_MAP[s.replace(/S$/, '')] || 'OTHER';
}
export function normalizeCategoriesArray(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(normalizeCategory).filter(Boolean))].sort();
}

// Date normalization — accept ISO, "DD/MM/YYYY", "YYYY-MM-DD HH:MM:SS", etc.
// Returns ISO string in UTC or null on parse failure. Preserves date-only
// input as midnight UTC to keep unordered-day comparisons deterministic.
export function normalizeDate(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  // "DD/MM/YYYY" → ISO
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return new Date(Date.UTC(+y, +m - 1, +d)).toISOString();
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// Decimal normalization — strip thousands separators, coerce number, round
// to 2 decimals (BO storage precision). Null when unparseable.
export function normalizeDecimal(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw * 100) / 100;
  const s = String(raw).replace(/[,_\s]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// Boolean coercion — accepts true/false/1/0/"true"/"false"/"yes"/"no";
// returns null on anything else so downstream can distinguish "known false"
// from "unknown".
export function normalizeBool(raw) {
  if (raw === true || raw === 1 || raw === '1') return true;
  if (raw === false || raw === 0 || raw === '0') return false;
  if (typeof raw === 'string') {
    const s = raw.trim().toLowerCase();
    if (s === 'true' || s === 'yes' || s === 'y') return true;
    if (s === 'false' || s === 'no' || s === 'n') return false;
  }
  return null;
}
