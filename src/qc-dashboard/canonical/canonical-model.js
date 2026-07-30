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
    },
    content: {
      names: {},             // { EN: "…", ZH: "…" } — locale key varies per platform
      mtBody: {},            // { EN: "…", ZH: "…" }
      dialogBody: {},        // { EN: "…", ZH: "…" }
      tncClauses: [],        // ordered list of clauses if the BO exposes them
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
