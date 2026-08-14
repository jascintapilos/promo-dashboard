// API mapper for QP2 Create Promotion Code (IBC22 / KING333 / ACE66 / SPADE66).
//
// Translates a `resolved` request record into the request bodies for the
// API-direct flow:
//
//   1. POST /api/bo/promotion              ← body returned in `.promotion`
//   2. POST /api/bo/messagetemplate        ← body returned in `.messageTemplate` (or null)
//   3. POST /api/bo/popups                 ← body returned in `.dialogPopup` (or null)
//   4. POST /api/bo/promotionname × N      ← bodies returned in `.buildNames(promotionId)`
//   5. PUT  /api/bo/promotion/{id}         ← built by `.buildUpdate(...)`
//
// Baselines are lifted from `captures/api-contract/2026-05-15T09-29-39-335Z-
// P-MULTI-test-v25-QP2A.json` — a successful QP2A FC save. The mapper
// substitutes per-request fields (code, name, validity, amount, multiplier,
// dialog content) into the captured body shape.
//
// Phase 1 scope (this file): Free Credit on QP2A. Deposit + Free Spin
// branches are stubbed with TODOs and fall back to the FC body for safety.
// Cross-merchant (QP2B/C/D) needs different merchant_ids — also TODO.

import { renderBody, renderDialogBody, localeDocKey } from './message-template-renderer.js';
import { getAllCategories, getAllGameProviders, getFreeSpinGames, getGameProviderDetail, getAllMemberGroups, getAllMerchantBankIds } from './api-client.js';
import { resolveBlacklistTemplateId } from './blacklist-template.js';
import { gameAcronym, splitDualPromoName } from './promo-namer.js';
import { isHardExcludedGameProvider } from './game-provider-exclusions.js';
import { isBrandAuthorized } from './request-requirements.js';
import { resolveFreeSpinBet } from './free-spin-bet.js';
import { QP2_BRAND_TO_IDS } from './brand-ids.js';

// Eligible member group NAMES (normalized UPPERCASE). Source: QP2A's
// operator-verified selection 2026-05-15 (26 of 31 QP2A groups). Excluded:
// "*Shadowban", "Diamond 2", "Diamond 3" + their trial variants — these are
// newer tiers the operator hasn't onboarded. When the promo extends to
// QP2B/C/D, we resolve the same NAME set on the new merchant — case-
// insensitive match (QP2A uses "Silver 1 (Trial)" but B/C/D use uppercase
// "SILVER 1 (TRIAL)"). PRO-GOLDVIP + PRO-PLATINUM-VIP only exist on QP2A;
// the name-match skips them gracefully on the others.
const QP2_ELIGIBLE_GROUP_NAMES = new Set([
  'NORMAL',
  'BRONZE 1', 'BRONZE 2', 'BRONZE 3',
  'SILVER 1', 'SILVER 2', 'SILVER 3',
  'GOLD 1', 'GOLD 2', 'GOLD 3',
  'PLATINUM 1', 'PLATINUM 2', 'PLATINUM 3',
  'DIAMOND',
  'SILVER 1 (TRIAL)', 'SILVER 2 (TRIAL)', 'SILVER 3 (TRIAL)',
  'GOLD 1 (TRIAL)', 'GOLD 2 (TRIAL)', 'GOLD 3 (TRIAL)',
  'PLATINUM 1 (TRIAL)', 'PLATINUM 2 (TRIAL)', 'PLATINUM 3 (TRIAL)',
  'DIAMOND (TRIAL)',
  'PRO-GOLDVIP', 'PRO-PLATINUM-VIP',
]);

function normMemberGroupName(n) {
  return String(n || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

// Same tier-prefix matcher as QPRO — accepts both numbered ("Silver 1") and
// bare ("Silver") names, optional " (TRIAL)" suffix, and PRO-VIP variants.
function qp2GroupMatchesTier(groupName, tier) {
  if (!groupName || !tier) return false;
  const T = String(tier).toUpperCase();
  let norm = String(groupName).toUpperCase().replace(/\s+/g, ' ').trim();
  if (/^\*|shadowban|^test|^credit$|scammer/i.test(norm)) return false;
  norm = norm.replace(/\s*\(TRIAL\)\s*$/, '').trim();
  if (/^PRO[-\s]?GOLD[-\s]?VIP$/.test(norm)) return T === 'GOLD';
  if (/^PRO[-\s]?PLATINUM[-\s]?VIP$/.test(norm) || /^PRO\s+VIP$/.test(norm)) return T === 'PLATINUM';
  const baseTier = norm.replace(/\s+\d+$/, '').trim();
  return baseTier === T;
}

// Resolve member_group_ids for a given set of merchants. With no tier
// constraint, uses the operator-verified QP2_ELIGIBLE_GROUP_NAMES allowlist
// (excludes Diamond 2/3 + Shadowban). With a tier constraint, INTERSECTS that
// allowlist with the tier-matcher — preserves the Diamond 2/3 exclusion rule
// even on "Gold and above" / "Diamond and above" promos.
export async function resolveQp2MemberGroupIds(site, merchantIds, { tierConstraint = null } = {}) {
  const all = await getAllMemberGroups(site);
  const wantedMerchants = new Set(merchantIds);
  const out = all.filter((g) => {
    if (!wantedMerchants.has(g.site_id)) return false;
    const baseAllowed = QP2_ELIGIBLE_GROUP_NAMES.has(normMemberGroupName(g.name));
    if (!baseAllowed) return false;
    if (!tierConstraint) return true;
    const tiers = tierConstraint.eligible_tiers || [];
    return tiers.some((tier) => qp2GroupMatchesTier(g.name, tier));
  }).map((g) => g.id);
  return out.sort((a, b) => a - b);
}

// Tokenize a game name → Set<stem> for fuzzy matching (singular/plural-aware).
function stemTokensQp2(s) {
  return new Set(
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3)
      .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t)),
  );
}

function setsEqualQp2(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// Resolve a free-spin game CODE from a human game label. Mirrors QPRO —
// exact-first, no substring/subset fallback. Variant names ("Super Scatter",
// "1000", "Xmas", "Dice") are DISTINCT games per operator rule 2026-05-16
// (feedback_fs_game_name_exact.md).
async function resolveFsGameCodeQp2(site, providerCode, gameInput) {
  if (!gameInput) return null;
  const raw = String(gameInput).trim();
  if (raw.includes(' - ')) {
    const codePart = raw.split(' - ')[0].trim();
    if (codePart) return codePart;
  }
  const games = await getFreeSpinGames(site, providerCode);
  const want = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  const exact = games.find((g) => String(g.name || '').toLowerCase().replace(/\s+/g, ' ').trim() === want);
  if (exact) return exact.code;
  const wantStems = stemTokensQp2(raw);
  if (wantStems.size === 0) return null;
  const stemMatches = games.filter((g) => setsEqualQp2(stemTokensQp2(g.name), wantStems));
  if (stemMatches.length === 1) return stemMatches[0].code;
  return null;
}

// ── Constants derived from V25 captures ──────────────────────────────────

// Fallback for callers that don't pass `site` into buildApiPlan. The
// hardcoded set captured 9 categories on QP2A (Layer-1 exclusions partially
// removed — LOTTERY and TABLE were included). New callers pass `site` and
// the mapper resolves per-brand via the allow-list, dropping LOTTERY+TABLE
// to align with QPRO (per memory's "Layer-1 exclusions: ARCADE, COCK FIGHT,
// LOTTERY, TABLE" rule).
const QP2_FALLBACK_CATEGORY_IDS = { '0': 9, '1': 12, '2': 4, '3': 5, '4': 2, '5': 6, '6': 3, '7': 1, '8': 10 };
const QP2_FALLBACK_CATEGORY_FS  = { '0': 3 };  // SLOTS-only fallback for FS

// Allow-list of wallet category NAMES — same as QPRO, so cross-platform
// promos appear in the same wallet categories on both BOs. Per operator
// rule: ARCADE, COCK FIGHT, LOTTERY, TABLE excluded.
const QP2_ALLOWED_WALLET_CATEGORY_NAMES = ['SPORT', 'LIVE CASINO', 'SLOTS', 'E-SPORTS', 'FISHING', 'CRASH', 'CRICKET'];
const QP2_FS_ONLY_CATEGORY_NAMES = ['SLOTS'];

// Convert [1, 2, 3] → {'0': 1, '1': 2, '2': 3} — the QP2 body's expected
// shape for category and provider lists.
function asNumKeyedObj(arr) {
  const out = {};
  arr.forEach((v, i) => { out[String(i)] = v; });
  return out;
}

async function resolveQp2CategoryIds(site, { isFs, categoriesOnly = null } = {}) {
  const rows = await getAllCategories(site);
  let allowSrc;
  if (Array.isArray(categoriesOnly) && categoriesOnly.length) {
    // Operator narrowed the set via "X, Y and Z only" — overrides defaults.
    // categoriesOnly comes pre-normalized from parseInstructions.
    allowSrc = categoriesOnly;
  } else if (isFs) {
    allowSrc = QP2_FS_ONLY_CATEGORY_NAMES;
  } else {
    allowSrc = QP2_ALLOWED_WALLET_CATEGORY_NAMES;
  }
  const allow = new Set(allowSrc.map((n) => n.toUpperCase()));
  const matched = rows.filter((c) => allow.has(String(c.name || '').toUpperCase()));
  return {
    ids: asNumKeyedObj(matched.map((c) => c.id)),
    names: matched.map((c) => String(c.name || '').toUpperCase()),
  };
}

// QP2A default member_group_ids — V25 POST shape (operator-input ordering).
const QP2A_MEMBER_GROUP_IDS_POST = {
  '0': 2, '1': 3, '2': 4, '3': 14, '4': 84, '5': 8, '6': 67, '7': 9,
  '8': 80, '9': 10, '10': 81, '11': 1, '12': 11, '13': 68, '14': 12,
  '15': 82, '16': 13, '17': 83, '18': 65, '19': 118, '20': 5, '21': 66,
  '22': 6, '23': 78, '24': 7, '25': 79,
};

// V25 PUT shape — sorted ascending. BO PUT validation seems to expect this.
const QP2A_MEMBER_GROUP_IDS_PUT = {
  '0': 1, '1': 2, '2': 3, '3': 4, '4': 5, '5': 6, '6': 7, '7': 8,
  '8': 9, '9': 10, '10': 11, '11': 12, '12': 13, '13': 14, '14': 65,
  '15': 66, '16': 67, '17': 68, '18': 78, '19': 79, '20': 80, '21': 81,
  '22': 82, '23': 83, '24': 84, '25': 118,
};

// QP2A target.game_provider_codes — 53 entries, string codes ("AVI", "BG", etc.).
const QP2A_TARGET_GAME_PROVIDER_CODES_RAW = {
  '0': '365G', '1': '9W', '2': 'AP', '3': 'AVI', '4': 'BG', '5': 'BOOM',
  '6': 'BNG', '7': 'BTG', '8': 'CMD', '9': 'CQ9', '10': 'EVOK', '11': 'EZ',
  '12': 'FS', '13': 'FP', '14': 'FC', '15': 'GXW', '16': 'HSG', '17': 'IM',
  '18': '2BC', '19': 'JDB', '20': 'JILI', '21': 'JK', '22': 'KA', '23': 'LIVE',
  '24': 'LUCKY', '25': 'MAHA', '26': 'MGP', '27': 'MONKEY', '28': 'NET2',
  '29': 'NEXT', '30': 'NLC', '31': 'PNG', '32': 'AG', '33': 'PTI', '34': 'PP',
  '35': 'PP2', '36': 'RT2', '37': 'RG', '38': 'SA', '39': 'MAX', '40': 'SBO',
  '41': 'SBO2', '42': 'SEXY', '43': 'SIMPLE', '44': 'SG', '45': 'SPRIBE',
  '46': 'TF', '47': 'VIVO', '48': 'WBET', '49': 'WM', '50': 'XE', '51': 'YB',
  '52': 'YL',
};

// PUT body's game_provider_codes (numeric IDs, NOT string codes — quirk).
// Captured verbatim from V25 successful PUT body: 53 entries.
const QP2A_PUT_GAME_PROVIDER_IDS_RAW = {
  '0': 178, '1': 139, '2': 341, '3': 196, '4': 15, '5': 268, '6': 328, '7': 292,
  '8': 18, '9': 14, '10': 320, '11': 25, '12': 122, '13': 304, '14': 184, '15': 324,
  '16': 197, '17': 23, '18': 312, '19': 110, '20': 111, '21': 7, '22': 190, '23': 21,
  '24': 284, '25': 313, '26': 203, '27': 274, '28': 256, '29': 22, '30': 257, '31': 17,
  '32': 1, '33': 308, '34': 35, '35': 345, '36': 258, '37': 349, '38': 13, '39': 8,
  '40': 34, '41': 353, '42': 31, '43': 10, '44': 9, '45': 187, '46': 117, '47': 332,
  '48': 72, '49': 37, '50': 33, '51': 297, '52': 36,
};

function buildAllowedQp2ProviderSet() {
  const putIds = {};
  const targetCodes = {};
  let idx = 0;
  for (const k of Object.keys(QP2A_TARGET_GAME_PROVIDER_CODES_RAW)) {
    const code = QP2A_TARGET_GAME_PROVIDER_CODES_RAW[k];
    if (isHardExcludedGameProvider({ code })) continue;
    putIds[String(idx)] = QP2A_PUT_GAME_PROVIDER_IDS_RAW[k];
    targetCodes[String(idx)] = code;
    idx++;
  }
  return { putIds, targetCodes };
}

const {
  putIds: QP2A_PUT_GAME_PROVIDER_IDS,
  targetCodes: QP2A_TARGET_GAME_PROVIDER_CODES,
} = buildAllowedQp2ProviderSet();

// Operator-approved QP2 "all games" provider set. QP2 provider IDs are
// merchant/site-specific even though their string codes are shared. The old
// mapper reused QP2A numeric IDs for QP2B/C/D, which made recently-added
// providers disappear silently on save. Resolve these codes against the live
// site_id-scoped catalog for every plan instead of reusing QP2A IDs.
const QP2_ALL_GAME_PROVIDER_CODES = [
  '9W', 'AP', 'AVI', 'BG', 'BOOM', 'BNG', 'BTG', 'CMD', 'CQ9', 'EVOK',
  'EZ', 'FS', 'FP', 'FC', 'HSG', 'IM', '2BC', 'JDB', 'JILI', 'JK', 'KA',
  'LIVE', 'LUCKY', 'MAHA', 'MGP', 'MONKEY', 'NET2', 'NEXT', 'NLC', 'AG',
  'PTI', 'PP2', 'RT2', 'RG', 'SA', 'MAX', 'SEXY', 'SIMPLE', 'SG', 'TF',
  'VIVO', 'WBET', 'WM', 'XE', 'YB', 'WF', 'SPRIBE2', 'SBO2', 'COSMO', 'BTI',
];

export const QP2_REQUIRED_ALL_GAME_PROVIDER_CODES = ['BTI', 'SBO2', 'SPRIBE2', 'WF'];

async function resolveQp2ProviderSet(site, brand, categoriesOnly = null) {
  const siteId = QP2_BRAND_TO_IDS[brand]?.siteId;
  if (!siteId) throw new Error(`api-mapper-qp2: brand "${brand}" site_id not configured`);

  const { rows } = await getAllGameProviders(site, { perPage: 999, siteId });
  const byCode = new Map(rows.map((row) => [String(row.code || '').toUpperCase(), row]));
  let codes = [...QP2_ALL_GAME_PROVIDER_CODES];

  if (Array.isArray(categoriesOnly) && categoriesOnly.length) {
    const allowed = new Set();
    for (const category of categoriesOnly) {
      for (const code of QP2_CATEGORY_PROVIDER_CODES[String(category).toUpperCase()] || []) {
        allowed.add(code === 'SPRIBE' ? 'SPRIBE2' : code);
      }
    }
    codes = codes.filter((code) => allowed.has(code));
  }

  const missing = codes.filter((code) => !byCode.has(code));
  if (missing.length) {
    throw new Error(
      `api-mapper-qp2: live provider catalog for ${brand} is missing required code(s): ${missing.join(', ')}`,
    );
  }

  const putIds = {};
  const targetCodes = {};
  codes.forEach((code, index) => {
    putIds[String(index)] = byCode.get(code).id;
    targetCodes[String(index)] = code;
  });
  return { putIds, targetCodes };
}

// Category membership for QP2's providers, derived from QPRO gameprovider
// catalog (probed 2026-07-02 on QPRO1 /api/bo/gameprovider, intersected with
// QP2's 53-code catalog). Maps wallet category name (uppercase, matches
// categoriesOnly tokens) → string codes eligible under that category.
// A provider can belong to multiple categories (e.g. MGP: LC + FISHING).
const QP2_CATEGORY_PROVIDER_CODES = {
  'SPORT':       ['2BC', '9W', 'CMD', 'MAX', 'SBO', 'SBO2', 'WBET'],
  'E-SPORTS':    ['2BC', 'CMD', 'IM', 'MAX', 'TF'],
  'CRICKET':     ['2BC', '9W', 'MAX'],
  'LIVE CASINO': ['AG', 'BG', 'EVOK', 'EZ', 'MGP', 'PP', 'PP2', 'PTI', 'SA', 'SEXY', 'VIVO', 'WM'],
  'SLOTS':       ['AP', 'BNG', 'BOOM', 'BTG', 'CQ9', 'FC', 'FP', 'FS', 'HSG', 'JDB', 'JILI', 'JK',
                  'KA', 'LIVE', 'LUCKY', 'MAHA', 'MGP', 'MONKEY', 'NET2', 'NEXT', 'NLC', 'PNG',
                  'PP', 'PP2', 'PTI', 'RG', 'RT2', 'SG', 'SIMPLE', 'XE', 'YB'],
  'FISHING':     ['BG', 'BTG', 'CQ9', 'FC', 'FS', 'JDB', 'JILI', 'JK', 'KA', 'LIVE', 'LUCKY',
                  'MGP', 'MONKEY', 'SG', 'SIMPLE', 'YB', 'YL'],
  'CRASH':       ['AVI', 'KA', 'SPRIBE'],
};

// Filters QP2A provider constants to the subset matching the given category
// names. Returns { putIds, targetCodes } as numeric-keyed objects — drop-in
// replacements for QP2A_PUT_GAME_PROVIDER_IDS and QP2A_TARGET_GAME_PROVIDER_CODES.
// Returns null when categoriesOnly is empty/null (caller uses the full constants).
export function filterQp2ProvidersByCat(categoriesOnly) {
  if (!Array.isArray(categoriesOnly) || !categoriesOnly.length) return null;
  const catSet = new Set(categoriesOnly.map((n) => n.toUpperCase()));
  const allowedCodes = new Set();
  for (const [cat, codes] of Object.entries(QP2_CATEGORY_PROVIDER_CODES)) {
    if (catSet.has(cat)) codes.forEach((c) => allowedCodes.add(c));
  }
  if (!allowedCodes.size) return null;
  const putIds = {};
  const targetCodes = {};
  let idx = 0;
  for (const k of Object.keys(QP2A_TARGET_GAME_PROVIDER_CODES)) {
    const code = QP2A_TARGET_GAME_PROVIDER_CODES[k];
    if (allowedCodes.has(code)) {
      putIds[String(idx)] = QP2A_PUT_GAME_PROVIDER_IDS[k];
      targetCodes[String(idx)] = code;
      idx++;
    }
  }
  return { putIds, targetCodes };
}

// Brand → site_id / merchant_id (QP2 is multi-merchant; one BO, four merchants).
// site_id is shared (the IBC22 BO is site 1). merchant_id is per-brand —
// confirmed 2026-05-15 via login.merchant_dropdown:
//   { id:1, name:'IBC22',   prefix:'I22' }
//   { id:2, name:'KING333', prefix:'K3'  }
//   { id:3, name:'ACE66',   prefix:'ACE' }
//   { id:4, name:'SPADE66', prefix:'S66' }
// site_id on this BO is per-merchant (verified 2026-05-16 via the
// /api/bo/merchantsites listing and the popups catalog showing distinct
// site_ids 1–4). Popups are scoped to a single merchant via this field —
// to deploy one popup template to all 4 merchants, POST 4 popups with
// different site_id values + link each via dialog_popup_list.
// QP2_BRAND_TO_IDS now lives in ./brand-ids.js (a no-heavy-imports data module)
// so the QC dashboard can reach the brand constants without loading this mapper
// and its promo write-path chain. Re-exported here unchanged so the ~20 existing
// importers of it from this module keep working. (imported at top of file.)
export { QP2_BRAND_TO_IDS };

// FS game provider name prefix → provider id (QP2-specific table, distinct
// from QPRO's). Confirmed 2026-05-15:
//   PP2 = 345 (Pragmatic Play 2)
// PTI = 308 (Playtech) confirmed 2026-07-10 via /api/bo/gameprovider/308 on
// ibc22 (P053: "Fire Blaze: Green Wizard" is Playtech-only, not PP2 — see
// feedback_fs_provider_can_be_playtech_or_pp.md). QP2's /api/bo/gameprovider
// LIST endpoint 500s on this platform (unlike QPRO), so this table can't be
// resolved dynamically — extend by hand via the per-id detail endpoint when
// a new provider's games get used.
const QP2_FS_PROVIDER_ID_BY_PREFIX = {
  PP2: 345,
  PTI: 308,
};

// Plain-English provider name (as written by an operator, e.g. "Playtech"
// in a sheet cell — no BO code involved) → BO code prefix. src/ingest.js
// parses this from a "(Provider)" annotation into parsed.game_provider;
// fsProviderIdFromLabel/fsProviderCodeFromLabel below only understood the
// legacy "<CODE> - Name" convention (e.g. "PP2 - Pragmatic Play"), so a bare
// name like "Playtech" derived a bogus prefix and silently resolved to 0/
// nothing. This map lets a bare name resolve to the real code too.
const QP2_PROVIDER_NAME_TO_PREFIX = {
  'pragmatic play': 'PP2',
  'pragmatic play 2': 'PP2',
  pragmatic: 'PP2',
  pp: 'PP2',
  pp2: 'PP2',
  playtech: 'PTI',
};

const LOCALE_TO_SETTINGS_ID = {
  MY_EN: 1, MY_ZH: 3, SG_EN: 6, SG_ZH: 7, ID_EN: 8, ID_ID: 9,
};
// Verified 2026-05-17 via /api/bo/currency: MYR=1, SGD=3, IDR=4. THB/KHR/AUD
// not yet verified on these BOs — probe before using.
const CURRENCY_TO_ID = { MYR: '1', SGD: '3', IDR: '4', THB: '?', KHR: '?', AUD: '?' };
const ID_TO_CURRENCY_QP2 = Object.fromEntries(Object.entries(CURRENCY_TO_ID).map(([k, v]) => [Number(v), k]));
const LOCALE_REGION_TO_CURRENCY_QP2 = { MY: 'MYR', SG: 'SGD', ID: 'IDR', TH: 'THB', KH: 'KHR', AU: 'AUD' };
function localeCurrencyQp2(locale) {
  const m = String(locale || '').match(/^([A-Z]{2})_/);
  return m ? LOCALE_REGION_TO_CURRENCY_QP2[m[1]] || null : null;
}

// Drop currencies (and locales/overrides tied to them) not supported by the
// FS provider on this brand's BO. Operator rule 2026-05-16: just create the
// promo with whatever subset the provider supports.
function filterResolvedToSupportedCurrenciesQp2(resolved, supportedCurrencies) {
  if (!supportedCurrencies?.length) return resolved;
  const supported = new Set(supportedCurrencies);
  const filteredCurrencies = (resolved.currencies || []).filter((c) => supported.has(c));
  if (filteredCurrencies.length === (resolved.currencies || []).length) return resolved;
  const filteredLocales = (resolved.locales || []).filter((l) => {
    const c = localeCurrencyQp2(l);
    return !c || supported.has(c);
  });
  const filteredOverrides = {};
  for (const [c, v] of Object.entries(resolved.per_currency_overrides || {})) {
    if (supported.has(c)) filteredOverrides[c] = v;
  }
  return {
    ...resolved,
    currencies: filteredCurrencies,
    locales: filteredLocales,
    per_currency_overrides: filteredOverrides,
  };
}

const MSG_TEMPLATE_SECTION_PROMOTIONS = '8';
const MSG_TEMPLATE_TYPE_MESSAGE       = '1';
const MSG_TEMPLATE_TYPE_SMS           = '2';

// ── Helpers ──────────────────────────────────────────────────────────────

function nowYmdHms() {
  // UTC formatting — BO stores datetime strings as-if UTC. Verified
  // 2026-05-17 (feedback_dialog_start_date_now.md).
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function promoTypeInt(bonusType) {
  // QP2 BO promo_type enum (confirmed via operator-saved references 2026-05-20):
  //   1 = Manual (default/fallback only — should NOT be used for normal promos)
  //   2 = Deposit Bonus  (Deposit + Cashback go here)
  //   3 = Free Credit
  //   4 = Free Spin
  // Previously Deposit defaulted to 1 here, which made the BO UI show
  // "Manual - Normal" instead of "Deposit Bonus" — caught 2026-05-20.
  const bt = (bonusType || '').toLowerCase();
  if (bt.includes('free spin'))   return 4;
  if (bt.includes('free credit')) return 3;
  if (bt.includes('cashback'))    return 2;
  if (bt.includes('deposit'))     return 2;
  return 2;  // safe default — never fall through to "Manual"
}

function promoSubTypeInt(bonusSubType, bonusType) {
  // Verified from live IBC22 BO (2026-06-25):
  //   Deposit+Welcome  → promo_type=2, promo_sub_type=2  (bonus_type "Deposit - Welcome")
  //   Deposit+Reload   → promo_type=2, promo_sub_type=1  (bonus_type "Deposit - Reload")
  //   FS+Welcome       → promo_type=4, promo_sub_type=1
  //   FS+Reload        → promo_type=4, promo_sub_type=2
  const bt = (bonusType || '').toLowerCase();
  const s  = (bonusSubType || '').toLowerCase();
  const isWelcome = s.includes('welcome') || bt.includes('welcome');
  if (bt.includes('free spin')) return isWelcome ? 1 : 2;
  if (bt.includes('deposit'))   return isWelcome ? 2 : 1;
  return 1;
}

// Localized CTA texts per docKey (operator-confirmed 2026-05-15; see
// memory/feedback_dialog_popup_defaults.md).
// Left button label depends on min_deposit (operator rule 2026-05-20):
//   min_deposit > 0  → "DEPOSIT" + /member/deposit
//   min_deposit == 0 → "CLAIM NOW" + /member/reward
// Right button is always "READ MORE" → /member/message.
const CTA_TEXT_BY_DOCKEY = {
  EN: { claim: 'CLAIM NOW',     deposit: 'DEPOSIT', right: 'READ MORE' },
  ZH: { claim: '立即领取',       deposit: '存款',     right: '阅读更多' },
  ID: { claim: 'Klaim Sekarang', deposit: 'Deposit',  right: 'Info Lanjut' },
};

// ── Promotion-currency builders (one per bonus type) ─────────────────────
// All builders return the POST body's `promotion_currency.0` entry shape
// matched to a 2026-05-15 capture for the bonus type.

function buildCurrencyBlockFC(resolved, currencyLabel) {
  const o = resolved.per_currency_overrides?.[currencyLabel] || {};
  const r = resolved.parsed || {};
  return {
    currency_id: CURRENCY_TO_ID[currencyLabel] ?? '1',
    bonus_amount: o.free_credit_amount ?? r.free_credit_amount ?? 0,
    bypass_min_deposit: 0,
    min_transfer: o.min_deposit ?? r.min_deposit ?? 0,
    min_deposit:  o.min_deposit ?? r.min_deposit ?? 0,
    max_balance_claim: null,
    status: '1',
    reset: 0,
    start_time: '00:00:00',
    end_time: '23:59:59',
    max_withdraw_type: '1',
    max_withdraw: 0,
    // QP2 currency-block fields: POST validator requires null or positive
    // (rejects 0); PUT embedded validator requires int (rejects null).
    // Use null in the builder (matches captures) — PUT body overrides to 0
    // via the IIFE in buildUpdateBody.
    max_total_applications: null,
    max_total_bonus: null,
    bonus_type: 1,  // Fixed Amount (for FC)
    promo_type: promoTypeInt(resolved.bonus_type),
    currency: currencyLabel,
    reset_name: 'None',
    max_bonus: 0,
    total_players: 0,
    current_players: 0,
    total_used_budget: 0,
    current_used_budget: 0,
  };
}

// QP2A Deposit shape (extrapolated from PUT body of id=1112 — captured
// 2026-05-15). Operator's reload uses bonus_type=2 (Percentage) with
// bonus_rate. min_deposit + max_bonus per-currency. max_withdraw is a
// SEPARATE cap (withdrawal ceiling) — NOT the bonus cap. Default null =
// Unlimited per operator 2026-05-20 (see feedback_qp2_max_withdraw_not_max_bonus.md).
// depositOptions: array of merchant bank account IDs for the SGD currency block.
// QC 2026-05-26: BO's /api/bo/promotioncurrency POST silently rejects SGD rows
// that omit the bank-IDs field (returns 500 on main POST / silent-drop on PUT).
// SGD requires an explicit non-empty list; MYR works fine with none.
//
// Field-name rules (confirmed 2026-05-29 via Chrome XHR capture):
//   • Embedded in main POST /api/bo/promotion body → field name: merchant_bank_ids
//     (object-map {"0":id, "1":id, ...}). bonus_rate: 30 stored as 30.00 (no scaling).
//   • Standalone POST /api/bo/promotioncurrency → field name: merchant_bank_ids
//     (same object-map format). bonus_rate: 30 stored as 3000.00 (multiplied ×100).
//     To get 30.00 stored via standalone POST, send bonus_rate: 0.30.
//     For standalone adds use addSgdCurrencyBlock() helper below, not this builder.
//   • GET /api/bo/promotioncurrency?promotion_id=X → returns field as deposit_options (array).
//   Callers pass all IDs from getAllMerchantBankIds(site) for SGD; pass null for MYR.
function buildCurrencyBlockDeposit(resolved, currencyLabel, depositOptions = null) {
  const o = resolved.per_currency_overrides?.[currencyLabel] || {};
  const r = resolved.parsed || {};
  const block = {
    currency_id: CURRENCY_TO_ID[currencyLabel] ?? '1',
    bonus_amount: 0,
    bonus_rate: o.bonus_rate_pct ?? r.bonus_rate_pct ?? 0,
    bypass_min_deposit: 0,
    max_balance_claim: null,
    status: '1',
    reset: 0,
    start_time: '00:00:00',
    end_time: '23:59:59',
    min_transfer: o.min_deposit ?? r.min_deposit ?? 0,
    min_deposit: o.min_deposit ?? r.min_deposit ?? 0,
    max_withdraw_type: '1',
    max_withdraw: o.max_withdraw ?? r.max_withdraw ?? null,
    // QP2 currency-block fields: POST validator requires null or positive
    // (rejects 0); PUT embedded validator requires int (rejects null).
    // Use null in the builder (matches captures) — PUT body overrides to 0
    // via the IIFE in buildUpdateBody.
    max_total_applications: null,
    max_total_bonus: null,
    bonus_type: 2,  // Percentage (for Deposit/Reload)
    promo_type: promoTypeInt(resolved.bonus_type),
    currency: currencyLabel,
    reset_name: 'None',
    max_bonus: o.max_bonus ?? r.max_bonus ?? 0,
    total_players: 0,
    current_players: 0,
    total_used_budget: 0,
    current_used_budget: 0,
  };
  // SGD requires merchant_bank_ids object-map; send for all currencies when provided.
  // MYR callers pass null (no bank-ID requirement).
  if (depositOptions !== null) {
    block.merchant_bank_ids = Array.isArray(depositOptions)
      ? Object.fromEntries(depositOptions.map((id, i) => [String(i), id]))
      : depositOptions;  // already an object-map
  }
  return block;
}

// QP2D FS POST body captured 2026-05-15 (`P-FS-qp2d-test`). FS uses
// rounds + amount_per_line (= value_per_spin / 20 per operator house
// convention; lines=0, coins=0). NO bonus_type field on FS currency
// block. min_deposit per the request.
function buildCurrencyBlockFS(resolved, currencyLabel) {
  const o = resolved.per_currency_overrides?.[currencyLabel] || {};
  const r = resolved.parsed || {};
  const spinCount = o.spin_count ?? r.spin_count ?? 0;
  const aplRaw = o.amount_per_line ?? r.amount_per_line ?? null;
  const valuePerSpin = o.value_per_spin ?? r.value_per_spin ?? null;
  const bet = resolveFreeSpinBet({ provider: r.game_provider || QP2_DEFAULT_FS_PROVIDER_LABEL, valuePerSpin, amountPerLine: aplRaw });
  // Playtech games take amount_per_line as a direct currency bet amount
  // (BO's accepted-bet list is denominations like 0.20/0.30/.../500.00) —
  // confirmed 2026-07-10 via a live HTTP 422 on P053 QPRO10 ("Fire Blaze:
  // Green Wizard"): the /20-then-floor PP2 convention below produces a
  // value the BO rejects for Playtech games. Mirrors the QPRO mapper fix.
  return {
    currency_id: CURRENCY_TO_ID[currencyLabel] ?? '1',
    bypass_min_deposit: 0,
    max_balance_claim: null,
    status: '1',
    reset: 0,
    start_time: '00:00:00',
    end_time: '23:59:59',
    coins: bet.coins,
    lines: bet.lines,
    // If sheet stated amount_per_line directly, use it.
    // Playtech: use value_per_spin as-is (no division — see comment above).
    // Else (Pragmatic Play/default): divide value_per_spin by 20 (operator
    // house convention for PP2 20-line games), floor to 2dp (0.40 → 0.02).
    amount_per_line: bet.amountPerLine,
    rounds: spinCount,
    min_deposit: o.min_deposit ?? r.min_deposit ?? 0,
    max_withdraw_type: '1',
    max_withdraw: null,
    // QP2 currency-block fields: POST validator requires null or positive
    // (rejects 0); PUT embedded validator requires int (rejects null).
    // Use null in the builder (matches captures) — PUT body overrides to 0
    // via the IIFE in buildUpdateBody.
    max_total_applications: null,
    max_total_bonus: null,
    promo_type: promoTypeInt(resolved.bonus_type),
    currency: currencyLabel,
    reset_name: 'None',
    max_bonus: 0,
    total_players: 0,
    current_players: 0,
    total_used_budget: 0,
    current_used_budget: 0,
  };
}

// Operator default per 2026-05-16 — FS promos that don't specify a provider
// in the sheet fall back to PP2 (Pragmatic Play). Mirrors the namer's default
// and the QPRO mapper.
const QP2_DEFAULT_FS_PROVIDER_LABEL = 'PP2 - Pragmatic Play';

// Resolves either convention to the BO code prefix: "<CODE> - Name" (legacy,
// e.g. "PP2 - Pragmatic Play" → "PP2") or a bare provider name (e.g.
// "Playtech" → "PTI", via QP2_PROVIDER_NAME_TO_PREFIX).
function fsProviderPrefixFromLabel(label) {
  const raw = String(label || QP2_DEFAULT_FS_PROVIDER_LABEL).trim();
  const byName = QP2_PROVIDER_NAME_TO_PREFIX[raw.toLowerCase()];
  if (byName) return byName;
  const firstToken = raw.split(/[\s-]+/)[0].trim();
  if (QP2_FS_PROVIDER_ID_BY_PREFIX[firstToken] != null) return firstToken;
  return byName || firstToken || 'PP2';
}

function fsProviderIdFromLabel(label) {
  const prefix = fsProviderPrefixFromLabel(label);
  return QP2_FS_PROVIDER_ID_BY_PREFIX[prefix] ?? 0;
}

// Returns the SHORT CODE used in QP2A_TARGET_GAME_PROVIDER_CODES values.
// Mirrors the namer's extractProviderPrefix. "PP2 - Pragmatic Play" → "PP2".
function fsProviderCodeFromLabel(label) {
  return fsProviderPrefixFromLabel(label);
}

function fsGameCodeFromLabel(label) {
  if (!label) return null;
  return label.includes(' - ') ? label.split(' - ')[0].trim() : label.trim();
}

// ── POST /promotion body builder ─────────────────────────────────────────

// depositOptionsByCurrency: map of currency label → array of merchant bank IDs.
// Pass null to skip deposit_options entirely (legacy behaviour). When provided,
// each currency block gets its own list ([] for MYR, full list for SGD).
function buildPromotionBody(resolved, brand, catIdsForBrand = null, fsGameCodeForBrand = null, memberGroupIdsForBrands = null, depositOptionsByCurrency = null, blacklistTemplateId = null, categoryProviders = null) {
  const bt = (resolved.bonus_type || '').toLowerCase();
  const isFs  = bt.includes('free spin');
  const isFc  = bt.includes('free credit');
  const isDep = bt.includes('deposit') || bt.includes('cashback');
  if (!isFs && !isFc && !isDep) {
    throw new Error(`api-mapper-qp2: unknown bonus_type "${resolved.bonus_type}"`);
  }

  const ids = QP2_BRAND_TO_IDS[brand];
  if (!ids || !ids.merchantId) {
    throw new Error(`api-mapper-qp2: brand "${brand}" merchant_id not configured`);
  }

  const r = resolved.parsed || {};
  const currencies = resolved.currencies?.length ? resolved.currencies : ['MYR'];
  const promotion_currency = {};
  const builder = isFs ? buildCurrencyBlockFS
                : isFc ? buildCurrencyBlockFC
                       : buildCurrencyBlockDeposit;
  currencies.forEach((c, i) => {
    const depOpts = isDep && depositOptionsByCurrency ? (depositOptionsByCurrency[c] ?? null) : null;
    promotion_currency[String(i)] = builder(resolved, c, depOpts);
  });

  const multiplier = r.to_multiplier ?? 0;
  const fsProviderId = isFs ? fsProviderIdFromLabel(r.game_provider) : 0;
  // Brand-resolved code (via /api/bo/gameprovider/freespingame/<code>) takes
  // priority; fall back to operator-supplied label's code-portion when offline.
  const fsGameCode = isFs ? (fsGameCodeForBrand || fsGameCodeFromLabel(r.game)) : null;

  // Operator rule (feedback_qp2d_allow_deposit_off.md + verified 2026-05-18):
  // all QP2 merchants leave allow_deposit = 0. deposit_status mapping on
  // this BO: 1=None, 2=Before Deposit, 3=First Deposit, 4=Last Deposit.
  // Use 4 ("Last Deposit") when min_deposit > 0, else 1 ("None"). Never
  // Before Deposit / First Deposit.
  const depositStatus = r.min_deposit > 0 ? '4' : '1';

  const body = {
    code: resolved.promo_code,
    name: splitDualPromoName(resolved.promotion_name_en).generic || resolved.promo_code,
    free_spin_game_provider_id: fsProviderId,
    promotion_category_ids: catIdsForBrand
      ? catIdsForBrand
      : (isFs ? QP2_FALLBACK_CATEGORY_FS : QP2_FALLBACK_CATEGORY_IDS),
    promo_type: String(promoTypeInt(resolved.bonus_type)),
    promo_sub_type: String(promoSubTypeInt(resolved.bonus_sub_type, resolved.bonus_type)),
    promotion_ids: [],
    valid_from: nowYmdHms(),
    validity: resolved.validity_days ?? resolved.rewards_validity_days ?? 1,
    reward_validity: resolved.rewards_validity_days ?? 1,
    frequency: [],
    frequency_type: '1',
    member_group_ids: memberGroupIdsForBrands
      ? Object.fromEntries(memberGroupIdsForBrands.map((id, i) => [String(i), id]))
      : QP2A_MEMBER_GROUP_IDS_POST,
    members_only: 0,
    fingerprint_check: 0,
    freespin_check: 0,
    auto_approve: 1,
    auto_reward_activation: 1,
    recurring: resolved.recurring === true ? 1 : 0,
    reset_frequency: 1,
    // Operator-supplied caps from sheet col T.
    // Fallback:
    //   - daily_max=99999 for recurring promos
    //   - daily_max=1 for one-time promos
    max_per_player: resolved.max_per_player ?? 1,
    daily_max: resolved.daily_max ?? (resolved.recurring === true ? 99999 : 1),
    limit_transfer_in: 0,
    limit_transfer_out: 0,
    bonus_rate: isDep ? (r.bonus_rate_pct ?? 0) : 0,
    auto_unlock: 1,
    allow_cancel: 0,
    withdrawal_unlock: 0,
    // For Free Spin promos, the eligible game-provider list collapses to the
    // single FS provider (e.g. PP2) — the same one as Free Spin Game Provider.
    // For category-restricted promos, categoryProviders.targetCodes holds the
    // filtered subset; otherwise the full Layer-1 list applies.
    game_provider_codes: isFs
      ? { '0': fsProviderCodeFromLabel(r.game_provider) }
      : (categoryProviders?.targetCodes ?? QP2A_TARGET_GAME_PROVIDER_CODES),
    target: {
      type: 1,
      multiplier,
      game_provider_codes: isFs
        ? { '0': fsProviderCodeFromLabel(r.game_provider) }
        : (categoryProviders?.targetCodes ?? QP2A_TARGET_GAME_PROVIDER_CODES),
    },
    deposit_count: 0,
    active_period: 0,
    merchant_ids: { '0': ids.merchantId },
    allow_deposit: 0,
    allow_continuous_claim: 0,
    deposit_status: depositStatus,
    eligible_types: '1',
    telemarketer_ids: [],
    requires_mobile: 0,
    requires_dob: 0,
    requires_fullname: 0,
    black_list_sub_categories: [],
    blacklist_template_id: blacklistTemplateId,
    dialog_popup_list: [],
    promotion_currency,
  };
  if (isFs && fsGameCode) body.free_spin_game_code = fsGameCode;
  return body;
}

// ── Message Template body (shared with QPRO renderer) ────────────────────

async function buildMessageTemplateBody(resolved, brand) {
  if (!(resolved.inbox_message === true)) return null;
  if (/cashback/i.test(resolved.bonus_type || '')) return null;

  const details = {};
  const allowed = new Set(['EN', 'ZH', 'ID']);
  for (const locale of resolved.locales || []) {
    const dk = localeDocKey(locale);
    if (!allowed.has(dk)) continue;
    const rendered = await renderBody({
      bonusType: resolved.bonus_type,
      locale,
      brand,
      platform: 'qp2',
      resolved,
    });
    if (rendered.skipped) continue;
    const settingsId = LOCALE_TO_SETTINGS_ID[locale];
    if (settingsId == null) continue;
    details[String(settingsId)] = {
      settings_locale_id: settingsId,
      subject: rendered.subject || '',
      message: rendered.html,
    };
  }
  if (Object.keys(details).length === 0) return null;
  return {
    name: resolved.promo_code,
    section: MSG_TEMPLATE_SECTION_PROMOTIONS,
    type: MSG_TEMPLATE_TYPE_MESSAGE,
    status: 1,
    details,
    code: `PROMOTIONS.MESSAGE.${resolved.promo_code}`,
  };
}

export function hasSmsRequirement(resolved) {
  if (resolved?.instructions?.sms_required === true) return true;
  const all = [
    resolved?.remark,
    resolved?.inbox_message_raw,
    resolved?.change_details,
    resolved?.name_details_raw,
  ].filter(Boolean).join('\n');
  return (
    /\bSMS\s+(?:is\s+)?required\b/i.test(all)
    || /\brequired\s*:?\s*SMS\b/i.test(all)
    || /\bneed(?:s)?\s+SMS\b/i.test(all)
  );
}

function smsMoneyToken(amount, currency) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  const rounded = Number.isInteger(n) ? String(n) : String(+n.toFixed(2));
  if (currency === 'MYR') return `RM${rounded}`;
  return `${currency}${rounded}`;
}

function smsRegionPrefix(locale) {
  return /^MY_/i.test(String(locale || '')) ? 'RM0 ' : '';
}

function smsGameToken(resolved) {
  const raw = resolved?.parsed?.game;
  if (!raw) return null;
  const label = String(raw).includes(' - ') ? String(raw).split(' - ').slice(1).join(' - ').trim() : String(raw).trim();
  return gameAcronym(label) || null;
}

function buildSmsGenericSubject(resolved) {
  const parsed = resolved.parsed || {};
  const vipHay = `${resolved.promo_code || ''} ${resolved.campaign || ''} ${resolved.remark || ''} ${resolved.name_details_raw || ''}`;
  const prefix = /\bvip\b/i.test(vipHay) ? 'VIP Exclusive' : 'Exclusive Offer';
  const bt = String(resolved.bonus_type || '').toLowerCase();
  if (bt.includes('free spin') && parsed.spin_count != null) {
    return `${prefix} — ${parsed.spin_count} Free Spins`;
  }
  const freeCredit = Object.values(resolved.per_currency_overrides || {}).find((v) => v?.free_credit_amount != null)?.free_credit_amount
    ?? parsed.free_credit_amount;
  if (bt.includes('free credit') && freeCredit != null) {
    return `${prefix} — ${freeCredit} Free Credit`;
  }
  if ((bt.includes('deposit') || bt.includes('reload') || bt.includes('welcome')) && parsed.bonus_rate_pct != null) {
    return `${prefix} — ${parsed.bonus_rate_pct}% Reload Bonus`;
  }
  return prefix;
}

export function buildSmsLocaleCopy(resolved, locale) {
  const dk = localeDocKey(locale);
  const isZh = dk === 'ZH';
  const currency = localeCurrencyQp2(locale) || (resolved.currencies || [])[0] || 'MYR';
  const perCurrency = resolved.per_currency_overrides?.[currency] || {};
  const parsed = resolved.parsed || {};
  const minDeposit = perCurrency.min_deposit ?? parsed.min_deposit ?? null;
  const to = parsed.to_multiplier ?? null;
  const spinCount = parsed.spin_count ?? null;
  const freeCredit = perCurrency.free_credit_amount ?? parsed.free_credit_amount ?? null;
  const bonusPct = parsed.bonus_rate_pct ?? null;
  const minDepToken = smsMoneyToken(minDeposit, currency);
  const gameToken = smsGameToken(resolved);
  const prefix = smsRegionPrefix(locale);
  const bt = String(resolved.bonus_type || '').toLowerCase();

  if (bt.includes('free spin') && spinCount != null && to != null) {
    if (isZh) {
      return {
        message: `${prefix}:username ${spinCount}FS${gameToken ? ` ${gameToken}` : ''}。${minDepToken ? `${minDepToken}/` : ''}TO${to}x。:url`,
      };
    }
    return {
      message: `${prefix}:merchantname: :username, last call for ${spinCount}FS${gameToken ? ` ${gameToken}` : ''}.${minDepToken ? ` ${minDepToken}/` : ' '}TO${to}x. Claim now: :url`.replace(' .', '.'),
    };
  }

  if (bt.includes('free credit') && freeCredit != null && to != null) {
    if (isZh) {
      return {
        message: `${prefix}:username ${freeCredit}FC。TO${to}x。:url`,
      };
    }
    return {
      message: `${prefix}:merchantname: :username, last call for ${freeCredit}FC. TO${to}x. Claim now: :url`,
    };
  }

  if ((bt.includes('deposit') || bt.includes('reload') || bt.includes('welcome')) && bonusPct != null && to != null) {
    if (isZh) {
      return {
        message: `${prefix}:username ${bonusPct}% dep BNS。${minDepToken ? `${minDepToken}/` : ''}TO${to}x。:url`,
      };
    }
    return {
      message: `${prefix}:merchantname: :username, ${bonusPct}% dep BNS is on.${minDepToken ? ` Min ${minDepToken}/` : ' '}TO${to}x. Act now: :url`.replace(' .', '.'),
    };
  }

  return null;
}

export async function buildSmsTemplateBody(resolved, brand) {
  if (!hasSmsRequirement(resolved)) return null;
  if (/cashback/i.test(resolved.bonus_type || '')) return null;
  void brand;

  const subject = buildSmsGenericSubject(resolved);
  const details = {};
  for (const locale of resolved.locales || []) {
    const settingsId = LOCALE_TO_SETTINGS_ID[locale];
    if (settingsId == null) continue;
    const copy = buildSmsLocaleCopy(resolved, locale);
    if (!copy) continue;
    details[String(settingsId)] = {
      settings_locale_id: settingsId,
      subject,
      message: copy.message,
    };
  }
  // hasSmsRequirement() was true and this isn't Cashback, yet buildSmsLocaleCopy()
  // produced nothing for any locale (e.g. bonus_type didn't match one of its
  // known branches, or a required field like to_multiplier/spin_count/
  // free_credit_amount/bonus_rate_pct was null) — SMS was required but silently
  // never gets built. Warn loudly so this doesn't look identical to "not
  // required"; Pre-QC/Sentinel also check for this downstream (see
  // .claude/agents/promo-qc.md / sentinel.md "SMS linkage").
  if (Object.keys(details).length === 0) {
    console.warn(`⚠ SMS required for ${resolved.promo_code} (bonus_type="${resolved.bonus_type}") but buildSmsLocaleCopy() produced no message for any locale in [${(resolved.locales || []).join(', ')}] — check to_multiplier/spin_count/free_credit_amount/bonus_rate_pct are set. SMS template will NOT be created.`);
    return null;
  }
  return {
    name: resolved.promo_code,
    section: Number(MSG_TEMPLATE_SECTION_PROMOTIONS),
    type: Number(MSG_TEMPLATE_TYPE_SMS),
    status: 1,
    details,
    code: `PROMOTIONS.SMS.${resolved.promo_code}`,
  };
}


// ── Dialog Popup POST body builder ───────────────────────────────────────

export async function buildDialogPopupBody(resolved, brand) {
  if (resolved.popup_dialog !== true) return null;
  if (resolved.dialog_scope && !isBrandAuthorized(resolved.dialog_scope, brand)) return null;
  if (/cashback/i.test(resolved.bonus_type || '')) return null;
  const ids = QP2_BRAND_TO_IDS[brand];
  if (!ids) throw new Error(`api-mapper-qp2: brand "${brand}" site_id not configured`);

  const r = resolved.parsed || {};
  const minDep = Number(r.min_deposit ?? 0);
  const useDeposit = minDep > 0;
  const ctaLeftLink = useDeposit ? '/member/deposit' : '/member/reward';
  const ctaRightLink = '/member/message';

  // Build per-locale `contents` block — use the short dialog body
  // (src/dialog-popup-bodies/) instead of the full inbox body.
  const contents = {};
  const allowed = new Set(['EN', 'ZH']);   // Dialog popups: EN + ZH only (no ID tab)
  for (const locale of resolved.locales || []) {
    const dk = localeDocKey(locale);
    if (!allowed.has(dk)) continue;
    const settingsId = LOCALE_TO_SETTINGS_ID[locale];
    if (settingsId == null) continue;
    const rendered = await renderDialogBody({
      bonusType: resolved.bonus_type,
      locale,
      resolved,
    });
    if (rendered.skipped) continue;
    const titleText = dk === 'ZH' ? (resolved.promotion_name_zh_id || splitDualPromoName(resolved.promotion_name_en).generic) : splitDualPromoName(resolved.promotion_name_en).generic;
    const cta = CTA_TEXT_BY_DOCKEY[dk] || CTA_TEXT_BY_DOCKEY.EN;
    contents[String(settingsId)] = {
      locale_id: settingsId,
      content: rendered.html,
      title: titleText,
      mobile_link: null,
      desktop_link: null,
      video_mobile_link: null,
      video_desktop_link: null,
      media_type: null,
      cta_button_type: 2,  // DUAL
      cta_button_text_1: useDeposit ? cta.deposit : cta.claim,
      cta_button_link_1: ctaLeftLink,
      cta_button_text_2: cta.right,
      cta_button_link_2: ctaRightLink,
    };
  }
  // popup_dialog was true and this isn't Cashback, yet renderDialogBody()
  // produced no content for any locale (e.g. bonus_type didn't resolve to a
  // supported dialog-body slug) — a popup was requested but silently never
  // gets built. Warn loudly; Pre-QC/Sentinel also check dialog linkage
  // downstream.
  if (Object.keys(contents).length === 0) {
    console.warn(`⚠ Dialog popup requested for ${resolved.promo_code} (bonus_type="${resolved.bonus_type}") but renderDialogBody() produced no content for any locale in [${(resolved.locales || []).join(', ')}] — check bonus_type maps to a supported dialog-body slug. Dialog popup will NOT be created.`);
    return null;
  }

  return {
    site_id: ids.siteId,
    platform: 1,
    start_date: nowYmdHms(),
    session: '3',  // After Login
    position: 99,
    status: 1,
    contents,
    location: 1,
    affiliates_visibility: 0,
    always_pop: 0,
    do_not_show_again: 0,
    label: splitDualPromoName(resolved.promotion_name_en).generic,
  };
}

// ── Promotion Names builder ──────────────────────────────────────────────

function buildNameBodies(resolved, promotionId) {
  return (resolved.locales || []).map((locale) => {
    const isEn = locale.endsWith('_EN');
    const isZh = locale.endsWith('_ZH') || locale.endsWith('_ID');
    const genericNameEn = splitDualPromoName(resolved.promotion_name_en).generic;
    const name = isEn
      ? (genericNameEn || resolved.promo_code)
      : isZh
        ? (resolved.promotion_name_zh_id || genericNameEn || resolved.promo_code)
        : (genericNameEn || resolved.promo_code);
    // Per-locale currency: each MY/SG/ID name row attaches to the matching
    // currency_id (MYR/SGD/IDR) so members see the right currency-scoped
    // copy. Earlier code used resolved.currencies[0] for ALL locales, so
    // every name row landed on MYR.
    const region = (locale.match(/^([A-Z]{2})_/)||[])[1] || 'MY';
    const ccy = LOCALE_REGION_TO_CURRENCY_QP2[region] || 'MYR';
    const currencyId = CURRENCY_TO_ID[ccy] || '1';
    return {
      promotion_id: promotionId,
      currency_id: currencyId,
      settings_locale_id: String(LOCALE_TO_SETTINGS_ID[locale] ?? 1),
      promotion_name: name,
      rewards_name:   name,
    };
  });
}

// ── PUT /promotion/<id> builder (with optional dialog popup link) ────────

function buildUpdateBody(resolved, brand, promotionId, templateId, dialogPopup, catIdsForBrand = null, fsGameCodeForBrand = null, memberGroupIdsForBrands = null, depositOptionsByCurrency = null, blacklistTemplateId = null, categoryProviders = null, smsMtId = 0) {
  const ids = QP2_BRAND_TO_IDS[brand];
  if (!ids || !ids.merchantId) throw new Error(`api-mapper-qp2: brand "${brand}" merchant_id not configured`);
  const r = resolved.parsed || {};
  const bt = (resolved.bonus_type || '').toLowerCase();
  const isFs  = bt.includes('free spin');
  const isDep = bt.includes('deposit') || bt.includes('cashback');
  const multiplier = r.to_multiplier ?? 0;
  const fsProviderId = isFs ? fsProviderIdFromLabel(r.game_provider) : 0;
  const fsGameCode   = isFs ? (fsGameCodeForBrand || fsGameCodeFromLabel(r.game)) : null;

  // dialog_popup_list on QP2 — shape discovered 2026-05-15 via API probe:
  // PUT accepts an object keyed by numeric string where each value is the
  // FULL popup row (every field from POST /api/bo/popups response) PLUS
  // a `promotion_id` field appended. Earlier shape attempts (just `[id]`,
  // `[{popup_id}]`, the QPRO 6-field form) all returned HTTP 500.
  //
  // Verified persistence via GET /api/bo/promotion?code=...&list endpoint —
  // dialog_popup_list returns a join-table row with id/site_id/promotion_id/
  // popup_id/created_at/updated_at after a successful PUT.
  let dialogList = [];
  if (dialogPopup && dialogPopup.id) {
    dialogList = {
      '0': {
        ...(dialogPopup.fullRow || {}),
        promotion_id: promotionId,
      },
    };
  }

  return {
    id: promotionId,
    code: resolved.promo_code,
    name: splitDualPromoName(resolved.promotion_name_en).generic || resolved.promo_code,
    free_spin_game_provider_id: fsProviderId,
    ...(isFs && fsGameCode ? { free_spin_game_code: fsGameCode } : {}),
    promotion_category_ids: catIdsForBrand
      ? catIdsForBrand
      : (isFs ? QP2_FALLBACK_CATEGORY_FS : QP2_FALLBACK_CATEGORY_IDS),
    bonus_settings: 1,
    promo_type: promoTypeInt(resolved.bonus_type),
    promo_sub_type: promoSubTypeInt(resolved.bonus_sub_type, resolved.bonus_type),
    promotion_ids: [],
    valid_from: nowYmdHms(),
    validity: resolved.validity_days ?? resolved.rewards_validity_days ?? 1,
    reward_validity: resolved.rewards_validity_days ?? 1,
    frequency: [],
    frequency_type: 1,
    member_group_ids: memberGroupIdsForBrands
      ? Object.fromEntries([...memberGroupIdsForBrands].sort((a, b) => a - b).map((id, i) => [String(i), id]))
      : QP2A_MEMBER_GROUP_IDS_PUT,
    members_only: 0,
    fingerprint_check: 0,
    freespin_check: 0,
    auto_approve: 1,
    auto_reward_activation: 1,
    recurring: resolved.recurring === true ? 1 : 0,
    reset_frequency: 1,
    reset_month: 1,
    // Operator-supplied caps from sheet col T.
    // Fallback:
    //   - daily_max=99999 for recurring promos
    //   - daily_max=1 for one-time promos
    max_per_player: resolved.max_per_player ?? 1,
    daily_max: resolved.daily_max ?? (resolved.recurring === true ? 99999 : 1),
    status: 1,
    limit_transfer_in: 0,
    limit_transfer_out: 0,
    bonus_rate: isDep ? (r.bonus_rate_pct ?? 0) : 0,
    auto_unlock: 1,
    allow_cancel: 0,
    withdrawal_unlock: 0,
    // For Free Spin promos, restrict to just the FS provider. PUT body uses
    // numeric IDs at the top level (quirk vs POST which uses string codes);
    // target.game_provider_codes still uses string codes on PUT.
    // For category-restricted promos, categoryProviders holds filtered subsets.
    game_provider_codes: isFs
      ? { '0': QP2_FS_PROVIDER_ID_BY_PREFIX[fsProviderCodeFromLabel(r.game_provider)] ?? fsProviderId }
      : (categoryProviders?.putIds ?? QP2A_PUT_GAME_PROVIDER_IDS),
    target: {
      type: 1,
      // V25 capture: PUT serializes multiplier as a 2-decimal string ("5.00").
      // POST sends int. Sending int on PUT triggers HTTP 500 (BO trace I22-...).
      multiplier: Number(multiplier).toFixed(2),
      game_provider_codes: isFs
        ? { '0': fsProviderCodeFromLabel(r.game_provider) }
        : (categoryProviders?.targetCodes ?? QP2A_TARGET_GAME_PROVIDER_CODES),
    },
    message_template_id: templateId || 0,
    message_template_sms_id: smsMtId || 0,
    deposit_count: 0,
    active_period: 0,
    merchant_ids: { '0': ids.merchantId },
    allow_deposit: 0,
    allow_continuous_claim: 0,
    deposit_status: r.min_deposit > 0 ? 4 : 1,
    eligible_types: 1,
    affiliate_group_ids: [],
    telemarketer_ids: [],
    requires_mobile: 0,
    requires_dob: 0,
    requires_fullname: 0,
    black_list_sub_categories: [],
    blacklist_template_id: blacklistTemplateId,
    // Preserve promotion_currency on PUT — without it the BO wipes the
    // per-currency rows that POST created. Re-emit using the same per-bonus
    // builder so values match. PUT validator rejects null for max_total_*
    // fields (POST validator requires null); coerce null → 0 here.
    promotion_currency: (() => {
      const cur = {};
      const currencies = resolved.currencies?.length ? resolved.currencies : ['MYR'];
      const builder = isFs ? buildCurrencyBlockFS
                    : (bt.includes('free credit') ? buildCurrencyBlockFC : buildCurrencyBlockDeposit);
      currencies.forEach((c, i) => {
        const depOpts = isDep && depositOptionsByCurrency ? (depositOptionsByCurrency[c] ?? null) : null;
        const block = { ...builder(resolved, c, depOpts) };
        if (block.max_total_applications == null) block.max_total_applications = 0;
        if (block.max_total_bonus == null) block.max_total_bonus = 0;
        cur[String(i)] = block;
      });
      return cur;
    })(),
    dialog_popup_list: dialogList,
  };
}

// ── Public API ───────────────────────────────────────────────────────────

export async function buildApiPlan(resolved, { brand, site, merchantIds = null } = {}) {
  // Col W can hold multi-line codes (e.g. "CODE\nWS2: CODE_V2"). QP2 always uses line 1.
  if (resolved.promo_code && resolved.promo_code.includes('\n')) {
    resolved = { ...resolved, promo_code: resolved.promo_code.split('\n')[0].trim() };
  }
  // Per-brand category resolution when `site` is supplied — fetches the
  // BO's installed categories and intersects with the allow-list (same set
  // as QPRO so cross-platform promos surface in the same wallets).
  // Falls back to the V25 hardcoded set for legacy callers without `site`.
  const isFs = (resolved.bonus_type || '').toLowerCase().includes('free spin');
  const categoriesOnly = resolved.instructions?.categories_only || null;
  const tierConstraint = resolved.instructions?.tier_constraint || null;
  // Category-restricted non-FS promos: filter game_provider_codes to the
  // subset matching the requested wallet categories.
  let categoryProviders = null;
  if (!isFs) {
    categoryProviders = site
      ? await resolveQp2ProviderSet(site, brand, categoriesOnly)
      : (Array.isArray(categoriesOnly) && categoriesOnly.length
        ? filterQp2ProvidersByCat(categoriesOnly)
        : null);
  }
  const catRes = site ? await resolveQp2CategoryIds(site, { isFs, categoriesOnly }) : null;
  const catIdsForBrand = catRes?.ids ?? null;
  const catNamesForBrand = catRes?.names ?? null;
  let fsGameCodeForBrand = null;
  let effectiveResolved = resolved;
  if (site && isFs) {
    const fsLabel = resolved.parsed?.game_provider_by_brand?.[brand] || resolved.parsed?.game_provider || QP2_DEFAULT_FS_PROVIDER_LABEL;
    const fsProviderPrefix = fsProviderPrefixFromLabel(fsLabel);
    if (fsProviderPrefix) {
      fsGameCodeForBrand = await resolveFsGameCodeQp2(site, fsProviderPrefix, resolved.parsed?.game_by_brand?.[brand] || resolved.parsed?.game);
    }
    const fsProviderId = fsProviderIdFromLabel(fsLabel);
    if (fsProviderId) {
      const detail = await getGameProviderDetail(site, fsProviderId);
      const supportedIds = detail?.currency || [];
      const supportedLabels = supportedIds.map((id) => ID_TO_CURRENCY_QP2[id]).filter(Boolean);
      effectiveResolved = filterResolvedToSupportedCurrenciesQp2(resolved, supportedLabels);
    }
  }
  // Per-brand parsed overrides: stamp game + game_provider from game_by_brand /
  // game_provider_by_brand onto effectiveResolved.parsed so every body builder
  // sees the correct values for this brand instead of the global fallback
  // (which defaults to the first provider annotation found in column M).
  {
    const brandGame     = resolved.parsed?.game_by_brand?.[brand];
    const brandProvider = resolved.parsed?.game_provider_by_brand?.[brand];
    if (brandGame || brandProvider) {
      effectiveResolved = {
        ...effectiveResolved,
        parsed: {
          ...effectiveResolved.parsed,
          ...(brandGame     ? { game: brandGame }              : {}),
          ...(brandProvider ? { game_provider: brandProvider } : {}),
        },
      };
    }
  }
  // Strip WS1/WS2 dual-name suffix from EN/ZH/ID promotion names for non-WS
  // brands. The sheet uses "Generic\nWS1/WS2: MB8 Name" format in col X/Y
  // when WS1 is in the request. Non-WS BO fields must show only the first line.
  if (!/^WS/i.test(brand || '')) {
    const stripDual = (s) => (typeof s === 'string' && s.includes('\n') ? s.split('\n')[0].trim() : s);
    const cleanEn   = stripDual(effectiveResolved.promotion_name_en);
    const cleanZh   = stripDual(effectiveResolved.promotion_name_zh);
    const cleanId   = stripDual(effectiveResolved.promotion_name_id);
    const cleanZhId = stripDual(effectiveResolved.promotion_name_zh_id);
    if (cleanEn   !== effectiveResolved.promotion_name_en
        || cleanZh   !== effectiveResolved.promotion_name_zh
        || cleanId   !== effectiveResolved.promotion_name_id
        || cleanZhId !== effectiveResolved.promotion_name_zh_id) {
      effectiveResolved = {
        ...effectiveResolved,
        promotion_name_en:    cleanEn,
        promotion_name_zh:    cleanZh,
        promotion_name_id:    cleanId,
        promotion_name_zh_id: cleanZhId,
      };
    }
  }

  // member_group_ids must span every merchant attached to the promo. Default
  // is just the current brand's merchant. Caller passes `merchantIds` (array
  // of merchant_ids) when extending a multi-merchant promo. A tier_constraint
  // from operator instructions narrows the eligible name set.
  let memberGroupIdsForBrands = null;
  if (site) {
    const mids = merchantIds || [QP2_BRAND_TO_IDS[brand]?.merchantId].filter(Boolean);
    memberGroupIdsForBrands = await resolveQp2MemberGroupIds(site, mids, { tierConstraint });
  }

  // SGD Deposit-type promos need an explicit merchant_bank_ids map (merchant bank
  // account IDs). Fetch once per plan; cache is per-process. SGD requires non-empty.
  // MYR passes null (no bank-ID requirement on MYR currency blocks).
  const isDep = (resolved.bonus_type || '').toLowerCase().match(/deposit|cashback/);
  let depositOptionsByCurrency = null;
  if (site && isDep && effectiveResolved.currencies?.includes('SGD')) {
    try {
      const allBankIds = await getAllMerchantBankIds(site);
      depositOptionsByCurrency = {};
      for (const c of (effectiveResolved.currencies || [])) {
        // MYR works with [] (BO doesn't require explicit list for MYR).
        // SGD (and any other non-MYR currency) needs the full list.
        depositOptionsByCurrency[c] = c === 'MYR' ? [] : allBankIds;
      }
    } catch (e) {
      console.warn(`[api-mapper-qp2] Could not fetch merchant bank IDs for merchant_bank_ids: ${e.message}`);
    }
  }

  // Blacklist Template id — same logic as QPRO mapper. Callers may inject an
  // explicit id (incl. null) via instructions.blacklist_id to bypass category
  // resolution (e.g. when replicating an exact source template). Otherwise
  // resolve by category-set match against the QP2 template catalog.
  let blacklistTemplateIdForBrand = null;
  if (site) {
    if (resolved.instructions && 'blacklist_id' in resolved.instructions) {
      blacklistTemplateIdForBrand = resolved.instructions.blacklist_id;
    } else {
      blacklistTemplateIdForBrand = await resolveBlacklistTemplateId(site, {
        categoryNames: catNamesForBrand,
        isFs,
      });
    }
  }

  // Auto-derive brand-specific game name in promo name when game_by_brand
  // differs from the generic (QP2/WS) game embedded in promotion_name_en.
  // Pattern: "Sugar Rush - 168FS" → replace game portion before " - NNfs"
  // with the brand-specific short name (text before ":" e.g. "Fire Blaze").
  // No-op when the brand game is the same family as the generic name
  // (e.g. "Sugar Rush 1000" starts with "Sugar Rush" → no change for QP2).
  {
    const brandGameForName = resolved.parsed?.game_by_brand?.[brand];
    if (brandGameForName) {
      const shortBrandGame = brandGameForName.includes(':')
        ? brandGameForName.split(':')[0].trim()
        : brandGameForName;
      const replaceGame = (name) => {
        if (typeof name !== 'string' || !name) return name;
        const m = name.match(/^(.+?)\s+-\s+(\d+FS.*)$/i);
        if (!m) return name;
        const currentGame = m[1].trim().toLowerCase();
        const shortLower  = shortBrandGame.toLowerCase();
        if (shortLower === currentGame
            || shortLower.startsWith(currentGame)
            || currentGame.startsWith(shortLower)) return name;
        return `${shortBrandGame} - ${m[2]}`;
      };
      const newNameEn   = replaceGame(effectiveResolved.promotion_name_en);
      const newNameZhId = replaceGame(effectiveResolved.promotion_name_zh_id);
      if (newNameEn   !== effectiveResolved.promotion_name_en
          || newNameZhId !== effectiveResolved.promotion_name_zh_id) {
        effectiveResolved = {
          ...effectiveResolved,
          promotion_name_en:    newNameEn,
          promotion_name_zh_id: newNameZhId,
        };
      }
    }
  }

  return {
    promotion: buildPromotionBody(effectiveResolved, brand, catIdsForBrand, fsGameCodeForBrand, memberGroupIdsForBrands, depositOptionsByCurrency, blacklistTemplateIdForBrand, categoryProviders),
    messageTemplate: await buildMessageTemplateBody(effectiveResolved, brand),
    smsTemplate: await buildSmsTemplateBody(effectiveResolved, brand),
    dialogPopup: await buildDialogPopupBody(effectiveResolved, brand),
    buildNames: (promotionId) => buildNameBodies(effectiveResolved, promotionId),
    buildUpdate: (promotionId, templateId, dialogPopup, smsMtId = 0) =>
      buildUpdateBody(effectiveResolved, brand, promotionId, templateId, dialogPopup, catIdsForBrand, fsGameCodeForBrand, memberGroupIdsForBrands, depositOptionsByCurrency, blacklistTemplateIdForBrand, categoryProviders, smsMtId),
    currencyFilter: effectiveResolved !== resolved
      ? { kept: effectiveResolved.currencies, dropped: resolved.currencies.filter((c) => !effectiveResolved.currencies.includes(c)) }
      : null,
    memberGroupIds: memberGroupIdsForBrands,
    blacklistTemplateId: blacklistTemplateIdForBrand,
    tierConstraint,
  };
}
