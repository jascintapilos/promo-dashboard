import { buildTncRow, needsZh } from './igmp-tnc.js';
import { splitDualPromoName } from './promo-namer.js';

// API mapper for iGMP (WS1 V3 / WS2 — best-in-asia.com kiosk Back Office).
//
// Captured shapes: project_igmp_api_shapes.md.
// Single mapper handles all locale BOs (kiosk{my,sg,id,th,kh}.best-in-asia.com)
// and WS2 (ws2-kioskmy.best-in-asia.com) — Create*.js files are byte-identical
// across all three (md5 verified 2026-05-19).
//
// Per bonus_type, returns:
//
//   { endpoint: '/PM/AddBonus' | '/PM/AddFreeCredit' | '/PM/AddFreeSpin',
//     body:     <ready-to-JSON.stringify payload>,
//     followups: [ ... ]  // FS only — array of { endpoint, body } to POST
//                         //   after the shell create response carries the
//                         //   new PromotionId
//   }

// ── Day-of-week to digit string (iGMP convention: Sun=0..Sat=6) ──────────
const DAY_ORDER = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function formatRedeemableDay(days) {
  // Accepts either:
  //   - array of day names ['mon','tue',...] (case-insensitive)
  //   - 7-char bitmask '1111111' (Sun..Sat)
  //   - null/undefined → all-week
  if (days == null) return '0,1,2,3,4,5,6';
  if (Array.isArray(days)) {
    const set = new Set(days.map((d) => String(d).toLowerCase().slice(0, 3)));
    return DAY_ORDER
      .map((d, i) => (set.has(d) ? i : null))
      .filter((i) => i !== null)
      .join(',');
  }
  if (typeof days === 'string' && /^[01]{7}$/.test(days)) {
    return days
      .split('')
      .map((c, i) => (c === '1' ? i : null))
      .filter((i) => i !== null)
      .join(',');
  }
  throw new Error(`formatRedeemableDay: unsupported input ${JSON.stringify(days)}`);
}

// "HH:MM" → minutes since midnight. Accepts also int passthrough.
function timeStringToMinutes(s) {
  if (typeof s === 'number' && Number.isFinite(s)) return s;
  if (typeof s !== 'string') return 0;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`timeStringToMinutes: bad input "${s}"`);
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// Local date → JS Date.toDateString() ("Mon Jun 01 2026").
// Note: the iGMP BO runs in GMT+8 (Malaysia Time). Pass dates in local form.
function toIgmpDateString(d) {
  if (d instanceof Date) return d.toDateString();
  if (typeof d === 'string') {
    // Accept "YYYY-MM-DD" or "MM/DD/YYYY" or "DD/MM/YYYY"
    let m;
    if ((m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
      return new Date(+m[1], +m[2] - 1, +m[3]).toDateString();
    }
    if ((m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/))) {
      // ambiguous; assume MM/DD/YYYY (matches BO datepicker default)
      return new Date(+m[3], +m[1] - 1, +m[2]).toDateString();
    }
    // Fallback: native parse
    const parsed = new Date(d);
    if (!Number.isNaN(parsed.getTime())) return parsed.toDateString();
  }
  throw new Error(`toIgmpDateString: unsupported input ${JSON.stringify(d)}`);
}

// KYC tier code → API string.
function kycStatus(level) {
  switch (Number(level || 0)) {
    case 0: return 'BASIC,ADVANCED,PRO';
    case 1: return 'ADVANCED,PRO';
    case 2: return 'PRO';
    default: throw new Error(`kycStatus: invalid level ${level}`);
  }
}

// ── Promo date range ──────────────────────────────────────────────────────
// Returns { startDate, endDate } as Date objects (local MY/GMT+8 calendar).
// rec.start_date / rec.end_date take precedence; otherwise derive from
// validity_days (default 30 if not set).
// endOfYearDefault=true: when end_date is absent, use Dec 31 of current year
// instead of today+validity_days (iGMP campaigns are typically year-long).
function resolvePromoDateRange(rec, { endOfYearDefault = false } = {}) {
  // Helper: today's date in GMT+8 as a local Date with time zeroed.
  function todayMyt() {
    const now = new Date();
    const myt = new Date(now.getTime() + 8 * 60 * 60 * 1000); // shift to +8
    return new Date(myt.getUTCFullYear(), myt.getUTCMonth(), myt.getUTCDate());
  }

  let startDate;
  if (rec.start_date) {
    const d = new Date(rec.start_date);
    startDate = Number.isNaN(d.getTime()) ? todayMyt() : d;
  } else {
    startDate = todayMyt();
  }

  let endDate;
  if (rec.end_date) {
    const d = new Date(rec.end_date);
    endDate = Number.isNaN(d.getTime()) ? null : d;
  }
  if (!endDate) {
    if (endOfYearDefault) {
      endDate = new Date(startDate.getFullYear(), 11, 31); // Dec 31 of campaign year
    } else {
      const days = Number(rec.validity_days ?? rec.rewards_validity_days ?? 30);
      endDate = new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000);
    }
  }

  return { startDate, endDate };
}

// ── WS1/WS2 PromotionName mechanics tag ─────────────────────────────────
// WS1 uses PromotionName (not Description) as the operator-facing display
// when manually assigning promos to players. Multiple promos can share the
// same base name (e.g. "20% Reload Bonus"), making them indistinguishable.
// Append a compact mechanics tag so operators can tell them apart at a glance.
//
//   Deposit:     "20% Reload Bonus (MIN50 / CAP100 / TO3x / LC)"
//   Free Credit: "Exclusive Offer - 50 Free Credit (FC50 / TO15x / WC50)"
//   Free Spin:   "28 Free Spins on Gates Of Olympus (FS28 / 0.20/spin / TO15x / MIN300)"
//
// MIN suffix is the LOCAL currency value at save time (per-currency override
// applied upstream). Adding it disambiguates multi-bracket FS batches (e.g.
// the same spin_count across MIN500/300/100 brackets) for the Manual Reward
// Assignment team, who pick by PromotionName.
//
function buildMechanicsTag(rec) {
  // Opt-in: operator may request a clean PromotionName with no mechanics spec
  // (e.g. "18 Free Spins on Gates of Olympus" without the "(FS18 / …)" tail).
  // Default behaviour unchanged — the tag is what the WS1 Manual Reward
  // Assignment team picks by, so only suppress when explicitly flagged.
  if (rec.suppress_mechanics_tag) return '';
  const bt = String(rec.bonus_type || '').toLowerCase();
  const parts = [];

  if (bt.includes('deposit')) {
    const minD = Number(rec.min_deposit ?? 0);
    const cap = Number(rec.cap_bonus_amount ?? rec.max_bonus ?? 0);
    const to = Number(rec.turnover_multiplier ?? rec.rollover_multiplier ?? 0);
    if (minD > 0) parts.push(`MIN${minD}`);
    if (cap > 0) parts.push(`CAP${cap}`);
    if (to > 0) parts.push(`TO${to}x`);
    // Category tag
    const cat = deriveCategoryLabel(rec);
    if (cat) parts.push(cat);
  } else if (bt.includes('free credit') || bt === 'fc') {
    const fc = Number(rec.free_credit_amount ?? rec.fixed_bonus_amount ?? 0);
    const to = Number(rec.turnover_multiplier ?? rec.rollover_multiplier ?? 0);
    const wc = Number(rec.withdrawal_cap ?? 0);
    if (fc > 0) parts.push(`FC${fc}`);
    if (to > 0) parts.push(`TO${to}x`);
    if (wc > 0) parts.push(`WC${wc}`);
    const cat = deriveCategoryLabel(rec);
    if (cat) parts.push(cat);
  } else if (bt.includes('free spin') || bt === 'fs') {
    const rounds = Number(rec.fs_rounds ?? 0);
    const perSpin = rec.fs_amount_per_bet != null ? Number(rec.fs_amount_per_bet) : null;
    const to = Number(rec.turnover_multiplier ?? rec.rollover_multiplier ?? 0);
    const minD = Number(rec.min_deposit ?? 0);
    if (rounds > 0) parts.push(`FS${rounds}`);
    if (perSpin != null && perSpin > 0) parts.push(`${perSpin.toFixed(2)}/spin`);
    if (to > 0) parts.push(`TO${to}x`);
    if (minD > 0) parts.push(`MIN${minD}`);
  }

  return parts.length > 0 ? ` (${parts.join(' / ')})` : '';
}

// Derive a short category label from the record for the mechanics tag.
function deriveCategoryLabel(rec) {
  const cats = rec.categories || rec.game_categories || [];
  if (!cats.length) return null; // no restriction = All (don't tag)
  const joined = cats.map(c => String(c).toLowerCase()).join(',');
  if (joined.includes('slot') && !joined.includes('live') && !joined.includes('sport')) return 'Slots';
  if (joined.includes('live') && !joined.includes('slot') && !joined.includes('sport')) return 'LC';
  if (joined.includes('sport') && !joined.includes('slot') && !joined.includes('live')) return 'Sports';
  if (joined.includes('slot') && joined.includes('live') && !joined.includes('sport')) return 'Slots+LC';
  return null; // mixed or all → don't tag
}

// ── Per-locale T&C rows ──────────────────────────────────────────────────
// Produces PromotionRewardContents for EN (always) + ZH (MY/SG regions).
// Explicit rec.locale_contents entries override the auto-generated HTML.
function buildPromotionRewardContents(rec, bonusType, siteIdOverride) {
  const bt = String(bonusType || rec.bonus_type || '').toLowerCase();

  // Build auto-generated rows for EN + ZH (if applicable).
  // The site-context flag tells the T&C helper which BO's currency / link
  // catalog to use (ws1-v3-my → RM + mb8mys, ws1-v3-sg → SG$ + mb8sg).
  const recWithSite = siteIdOverride
    ? { ...rec, __site_override: siteIdOverride }
    : rec;
  const locales = ['en'];
  if (needsZh(recWithSite)) locales.push('zh');
  const auto = Object.fromEntries(
    locales.map((loc) => [loc, buildTncRow(recWithSite, loc, bt)]),
  );

  // Explicit locale_contents overrides — map to API shape.
  const explicit = {};
  for (const r of (rec.locale_contents || [])) {
    explicit[r.locale] = {
      Locale: r.locale,
      PromotionRewardName: r.name || splitDualPromoName(rec.promotion_name_en).generic || rec.promotion_name,
      Content: r.content || '',
    };
  }

  // Merge: explicit wins; auto fills in any locale not explicitly provided.
  const merged = { ...auto, ...explicit };
  // Ensure EN is always present (BO enforces it).
  if (!merged.en) {
    throw new Error('iGMP requires an EN locale in PromotionRewardContents');
  }
  return Object.values(merged);
}

// ── 3.1 Deposit Bonus ─────────────────────────────────────────────────────
function buildAddBonus(rec) {
  const { startDate, endDate } = resolvePromoDateRange(rec, { endOfYearDefault: true });
  const startMin = timeStringToMinutes(rec.redeemable_start_time || '00:00');
  const endMin = timeStringToMinutes(rec.redeemable_end_time || '23:59');
  const { generic: genericName, ws1Unique } = splitDualPromoName(rec.promotion_name_en);
  const baseName = genericName || rec.promotion_name;
  // Operator-supplied explicit WS1-unique name (column X "WS1/WS2:" line) is
  // already the chosen disambiguator — use it verbatim. The auto mechanics
  // tag only applies when falling back to the generic name.
  const displayName = ws1Unique && ws1Unique !== genericName
    ? ws1Unique
    : baseName + buildMechanicsTag(rec);

  const reward = {
    RewardName: baseName,  // T&C heading stays clean
    RedemptionType: '0',                   // deposit-triggered (only option on this page)
    RewardType: String(rec.reward_type ?? 0), // 0=percentage, 1=fixed
    MinimumActionAmount: Number(rec.min_deposit ?? 0),
    BonusPercentage: Number(rec.bonus_pct ?? 0),
    RolloverMultiplier: Number(rec.turnover_multiplier ?? rec.rollover_multiplier ?? 0),
    FixedBonusAmount: Number(rec.fixed_bonus_amount ?? 0),
    FixedRolloverAmount: Number(rec.fixed_rollover_amount ?? 0),
    PhysicalGiftDescription: '',
    RedeemableQuantity: Number(rec.redeemable_quantity ?? 0),
    RemainingQuantity: Number(rec.redeemable_quantity ?? 0),
    IsActive: true,
    RolloverType: String(rec.rollover_type ?? 0), // 0=percentage, 1=fixed
    CapBonusAmount: Number(rec.cap_bonus_amount ?? rec.max_bonus ?? 0),
    RedeemableKYCStatus: kycStatus(rec.kyc_level),
    PromotionRewardContents: buildPromotionRewardContents(rec, 'deposit'),
    WithdrawalCap: Number(rec.withdrawal_cap ?? 0),
    MaximumBalance: Number(rec.maximum_balance ?? 0),
    ExpiryMinutes: Number(rec.rewards_validity_days ?? 0) * 1440,
  };

  return {
    endpoint: '/PM/AddBonus',
    body: {
      PromotionCode: rec.promo_code,
      PromotionName: displayName,
      PromotionDescription: rec.column_m || rec.description || '',
      PromotionStartDate: toIgmpDateString(startDate),
      PromotionEndDate: toIgmpDateString(endDate),
      PromotionManagementId: rec.promotion_banner_id ?? null,
      RedeemableDay: formatRedeemableDay(rec.redeemable_days),
      RedeemableStartTime: startMin,
      RedeemableEndTime: endMin,
      PromotionRewards: [reward],
      RedeemableCount: Number(rec.redeemable_count ?? 0),
      Settings: [],
      // Fix QC 2026-05-26: expiry_minutes_ws1 is ExpiryMinutes (FC field only),
      // NOT EffectiveMinutes. Deposit builder should read effective_minutes only.
      // Fix 2026-06-10: operator standard for ALL WS1 promos = 1 (not 1440).
      EffectiveMinutes: Number(rec.effective_minutes ?? 1),
    },
    followups: [],
  };
}

// ── 3.4 Free Credit ───────────────────────────────────────────────────────
function buildAddFreeCredit(rec) {
  const { startDate, endDate } = resolvePromoDateRange(rec, { endOfYearDefault: true });
  const startMin = timeStringToMinutes(rec.redeemable_start_time || '00:00');
  const endMin = timeStringToMinutes(rec.redeemable_end_time || '23:59');

  // RewardType: 0=Percentage, 1=Fixed, 2=Manual Input (rewritten to 1 + Settings entry)
  const rawRewardType = Number(rec.reward_type ?? 1);
  const isManualInput = rawRewardType === 2;
  const wireRewardType = isManualInput ? 1 : rawRewardType;
  const { generic: genericName, ws1Unique } = splitDualPromoName(rec.promotion_name_en);
  const baseName = genericName || rec.promotion_name;
  const mechanicsTagFc = buildMechanicsTag(rec);
  // Operator-supplied explicit WS1-unique name wins verbatim; otherwise
  // append the auto tag (unless the auto-namer already embedded it).
  const displayName = ws1Unique && ws1Unique !== genericName
    ? ws1Unique
    : (mechanicsTagFc && baseName.includes(mechanicsTagFc.trim()) ? baseName : baseName + mechanicsTagFc);

  const reward = {
    RewardName: baseName,  // T&C heading stays clean
    // RedemptionType: 0=Deposit, 1=Claim. Was hardcoded to Claim(1)/0 with no
    // regard for min_deposit — fine for every FC promo seen until P030
    // (2026-07-10), which is the first FC request with a real min_deposit
    // gate (30). Left as-is, the BO would have let players claim without
    // making the required deposit. Mirror the FS builder's derivation below.
    RedemptionType: String(rec.fc_redemption_type ?? (Number(rec.min_deposit ?? 0) > 0 ? 0 : 1)),
    RewardType: wireRewardType,
    MinimumActionAmount: Number(rec.min_deposit ?? 0),
    BonusPercentage: Number(rec.bonus_pct ?? 0),
    RolloverMultiplier: Number(rec.turnover_multiplier ?? rec.rollover_multiplier ?? 0),
    FixedBonusAmount: Number(rec.fixed_bonus_amount ?? rec.free_credit_amount ?? 0),
    FixedRolloverAmount: Number(rec.fixed_rollover_amount ?? 0),
    PhysicalGiftDescription: '',
    RedeemableQuantity: Number(rec.redeemable_quantity ?? 0),
    RemainingQuantity: Number(rec.redeemable_quantity ?? 0),
    IsActive: true,
    CapBonusAmount: Number(rec.cap_bonus_amount ?? rec.max_bonus ?? 0),
    RolloverType: String(rec.rollover_type ?? 0),
    RedeemableKYCStatus: kycStatus(rec.kyc_level),
    PromotionRewardContents: buildPromotionRewardContents(rec, 'free credit'),
    DepositRequirement: Boolean(rec.deposit_requirement ?? false),
    RequiredApprovedDeposit: Number(rec.required_approved_deposit ?? 0),
    DepositPeriodicDays: Number(rec.deposit_periodic_days ?? 0),
    WithdrawalCap: Number(rec.withdrawal_cap ?? 0),
    MaximumBalance: Number(rec.maximum_balance ?? 0),
  };

  return {
    endpoint: '/PM/AddFreeCredit',
    body: {
      PromotionCode: rec.promo_code,
      PromotionName: displayName,
      PromotionDescription: rec.column_m || rec.description || '',
      PromotionStartDate: toIgmpDateString(startDate),
      PromotionEndDate: toIgmpDateString(endDate),
      PromotionManagementId: rec.promotion_banner_id ?? null,
      RedeemableDay: formatRedeemableDay(rec.redeemable_days),
      RedeemableStartTime: startMin,
      RedeemableEndTime: endMin,
      PromotionRewards: [reward],
      // FC bonus expiry in minutes. Derive from rewards_validity_days (col Q);
      // default 10080 (7 days) when not set.
      ExpiryMinutes: Number(
        rec.expiry_minutes_ws1
        ?? (rec.rewards_validity_days != null ? Number(rec.rewards_validity_days) * 1440 : null)
        ?? rec.expiry_minutes
        ?? 10080,
      ),
      AutoRedemption: Boolean(rec.auto_redemption ?? false),
      // Fix 2026-06-10: operator standard for ALL WS1 promos = 1 (not 1440).
      EffectiveMinutes: Number(rec.effective_minutes ?? 1),
      Settings: isManualInput
        ? [{ Name: 'FreeCreditType', Value: 'ManualInput' }]
        : [],
    },
    followups: [],
  };
}

// ── 3.15 Free Spin ────────────────────────────────────────────────────────
// Three-phase orchestration. The shell create returns a PromotionId; that
// feeds AddFreeSpinReward, whose response carries a RewardId used by the
// BulkAddorUpdatePromotionRewardContents call. Token strings ($PromotionId,
// $RewardId) in follow-up bodies are filled in by the canary runner after
// each prior step completes.
const SITE_SUFFIX = {
  'ws1-v3-my': 'MY', 'ws1-v3-sg': 'SG', 'ws1-v3-id': 'ID',
  'ws1-v3-th': 'TH', 'ws1-v3-kh': 'KH', 'ws2': 'WS2',
};

function buildAddFreeSpin(rec, { siteId } = {}) {
  const { startDate, endDate } = resolvePromoDateRange(rec, { endOfYearDefault: true });
  const { generic: genericName, ws1Unique } = splitDualPromoName(rec.promotion_name_en);
  const baseName = genericName || rec.promotion_name;
  const displayName = ws1Unique && ws1Unique !== genericName
    ? ws1Unique
    : baseName + buildMechanicsTag(rec);
  const shellBody = {
    PromotionCode: rec.promo_code,
    PromotionName: displayName,
    PromotionDescription: rec.column_m || rec.description || '',
    Settings: [],
    PromotionStartDate: toIgmpDateString(startDate),
    PromotionEndDate: toIgmpDateString(endDate),
  };

  const rewardBody = {
    PromotionId: '$PromotionId',
    PromotionReward: {
      RewardName: baseName,  // T&C heading stays clean
      // RedemptionType: 0=Deposit, 1=Claim. Derive from min_deposit unless overridden.
      RedemptionType: String(rec.fs_redemption_type ?? (Number(rec.min_deposit ?? 0) > 0 ? 0 : 1)),
      RewardType: '3',                                     // 3=Free Spin — only option in BO dropdown
      MinimumActionAmount: Number(rec.min_deposit ?? 0),
      BonusPercentage: 0,                                   // hardcoded: no bonus in free spin
      RolloverMultiplier: Number(rec.turnover_multiplier ?? rec.rollover_multiplier ?? 0),
      FixedBonusAmount: 0,
      FixedRolloverAmount: Number(rec.fixed_rollover_amount ?? 0),
      PhysicalGiftDescription: '',
      RedeemableQuantity: Number(rec.redeemable_quantity ?? 0),
      RemainingQuantity: Number(rec.redeemable_quantity ?? 0),
      IsActive: true,
      RolloverType: String(rec.rollover_type ?? 0),
      CapBonusAmount: Number(rec.cap_bonus_amount ?? 0),
      RedeemableKYCStatus: kycStatus(rec.kyc_level),
      PromotionRewardContents: buildPromotionRewardContents(rec, 'free spin', siteId),
      WithdrawalCap: String(Number(rec.withdrawal_cap ?? 0)),
      MaximumBalance: String(Number(rec.maximum_balance ?? 0)),
    },
    FreeSpin: {
      ProductId: rec.fs_provider_id ?? null,    // from /VIM/GetAllProductOfferings (must resolve)
      GameId: rec.fs_game_id ?? null,           // from /VIM/GetGames (must resolve)
      StartTimeStamp: toIgmpDateString(startDate),
      EndTimeStamp: toIgmpDateString(endDate),
      // FreeSpinCode is unique across all iGMP BO instances (shared namespace).
      // Append a site suffix so multi-site deployments don't collide.
      FreeSpinCode: (() => {
        const base = rec.fs_code || rec.promo_code;
        const suffix = siteId ? (SITE_SUFFIX[siteId] || siteId.toUpperCase()) : null;
        return suffix ? `${base}_${suffix}` : base;
      })(),
      FreeSpinName: rec.fs_name || '',
      FreeSpinRounds: String(Number(rec.fs_rounds ?? 0)),
      AmountPerBet: rec.fs_amount_per_bet != null ? String(rec.fs_amount_per_bet) : null,
      AmountPerLine: rec.fs_amount_per_line != null ? String(rec.fs_amount_per_line) : null,
      ValidityTimeStamp: rec.fs_validity_date ? toIgmpDateString(rec.fs_validity_date) : null,
      RedeemableDay: formatRedeemableDay(rec.redeemable_days),
      RedeemableCount: String(Number(rec.redeemable_count ?? 0)),
      AdditionalSettings: {},
    },
    MaxFreeSpinDayDuration: Number(rec.max_free_spin_day_duration ?? 365),
  };

  const settingsBody = {
    PromotionId: '$PromotionId',
    Settings: [],
  };

  // Detect whether the caller pre-resolved FS catalog IDs; if not, mark
  // unimplemented so --commit errors loudly.
  const needsResolve = !rec.fs_provider_id || !rec.fs_game_id;

  return {
    endpoint: '/PM/AddFreeSpin',
    body: shellBody,
    followups: [
      { endpoint: '/PM/AddFreeSpinReward', body: rewardBody },
      { endpoint: '/PM/UpdatePromotionSettings', body: settingsBody },
    ],
    _unimplemented: needsResolve ? ['fs_provider_id + fs_game_id (resolver TBD)'] : [],
  };
}

// ── Entry point ──────────────────────────────────────────────────────────
export function buildIgmpPlan(rec, { siteId, ftPrefix = false } = {}) {
  // FT_ is opt-in only as of 2026-07-09 (was: auto-added for every WS1/WS2
  // promo regardless of remark). Callers should derive `ftPrefix` from
  // whether the source row explicitly requested it (rec.instructions
  // .code_prefixes includes 'FT') — see bin/canary-api-igmp.js. The default
  // here is `false` as a safety net for any caller that omits the option.
  // Sheet stores multiple platform codes in one cell separated by newlines OR slashes.
  // e.g. "VIP_100PCT_30MX_3X/FT_VIP_100PCT_30MX_3X" or "CODE1\nFT_CODE1"
  const normalizedRec = { ...rec };
  if (typeof normalizedRec.promo_code === 'string') {
    const raw = normalizedRec.promo_code;
    if (raw.includes('\n') || raw.includes('/')) {
      const codes = raw.split(/[\n/]/).map((s) => s.trim()).filter(Boolean);
      // With FT prefix: prefer the FT_ code. Without: prefer the non-FT_ code.
      const primary = ftPrefix
        ? (codes.find((c) => c.startsWith('FT_')) || codes[0])
        : (codes.find((c) => !c.startsWith('FT_')) || codes[0]);
      normalizedRec.promo_code = primary;
    }
  }
  // Ensure FT_ prefix (covers single-code records that don't already have it)
  if (ftPrefix && typeof normalizedRec.promo_code === 'string' && !normalizedRec.promo_code.startsWith('FT_')) {
    normalizedRec.promo_code = 'FT_' + normalizedRec.promo_code;
  }

  // Fall through parsed.* to top-level for fields the ingest leaves nested.
  const p = rec.parsed || {};
  if (normalizedRec.min_deposit == null && p.min_deposit != null) normalizedRec.min_deposit = p.min_deposit;
  if (normalizedRec.bonus_pct == null && p.bonus_rate_pct != null) normalizedRec.bonus_pct = p.bonus_rate_pct;
  if (normalizedRec.turnover_multiplier == null && p.to_multiplier != null) normalizedRec.turnover_multiplier = p.to_multiplier;
  if (normalizedRec.cap_bonus_amount == null && p.max_bonus != null) normalizedRec.cap_bonus_amount = p.max_bonus;
  if (normalizedRec.free_credit_amount == null && p.free_credit_amount != null) normalizedRec.free_credit_amount = p.free_credit_amount;
  if (normalizedRec.withdrawal_cap == null && p.max_transfer_out != null) normalizedRec.withdrawal_cap = p.max_transfer_out;
  if (normalizedRec.fs_rounds == null && p.spin_count != null) normalizedRec.fs_rounds = p.spin_count;
  // value_per_spin (operator field) → fs_amount_per_bet (BO field) when not
  // explicitly overridden. Without this fall-through the BO's required
  // AmountPerBet stays null and the AddFreeSpinReward save 422s.
  if (normalizedRec.fs_amount_per_bet == null && p.value_per_spin != null) {
    normalizedRec.fs_amount_per_bet = p.value_per_spin;
  }
  // IGMP serves WS1/WS2. Use WS1-specific game name when the operator listed one
  // (e.g. "WS1: MB8 Gates Of Olympus" vs "Others: Gates Of Olympus"). Falls back
  // to parsed.game (the default / "Others:" value) if no WS1 override exists.
  const igmpFsGame = p.game_by_brand?.['WS1'] ?? p.game ?? null;
  if (normalizedRec.fs_game == null && igmpFsGame != null) normalizedRec.fs_game = igmpFsGame;

  // Stamp the actual save siteId onto the record so any locale content
  // builder (T&C, popup, message template) can resolve currency + brand-link
  // for the destination BO instead of falling back to the brand's default
  // siteId (which is always ws1-v3-my and corrupts SG/ID/TH/KH content).
  if (siteId) normalizedRec.__site_override = siteId;

  // Apply per-currency min_deposit override based on the target site's currency.
  // Without this, ws1-v3-sg would use MYR's min_deposit (e.g. 500) instead of
  // SGD's (e.g. 150), producing the wrong MinimumActionAmount in the API body.
  if (siteId && rec.per_currency_overrides) {
    const SITE_CURRENCY_MAP = {
      'ws1-v3-my': 'MYR', 'ws1-v3-sg': 'SGD', 'ws1-v3-id': 'IDR',
      'ws1-v3-th': 'THB', 'ws1-v3-kh': 'KHR',
    };
    const siteCur = SITE_CURRENCY_MAP[siteId];
    if (siteCur && rec.per_currency_overrides[siteCur]?.min_deposit != null) {
      normalizedRec.min_deposit = rec.per_currency_overrides[siteCur].min_deposit;
    }
  }

  const bt = String(normalizedRec.bonus_type || '').toLowerCase();
  if (bt.includes('deposit')) return buildAddBonus(normalizedRec);
  if (bt.includes('free credit') || bt === 'fc') return buildAddFreeCredit(normalizedRec);
  if (bt.includes('free spin') || bt === 'fs') return buildAddFreeSpin(normalizedRec, { siteId });
  throw new Error(`buildIgmpPlan: unknown bonus_type "${rec.bonus_type}"`);
}

// Test-friendly exports
export const _internals = {
  formatRedeemableDay,
  timeStringToMinutes,
  toIgmpDateString,
  kycStatus,
  buildAddBonus,
  buildAddFreeCredit,
  buildAddFreeSpin,
};
