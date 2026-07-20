// API mapper for QPRO Create Promotion Code.
//
// Translates a `resolved` request record (planner.js shape) into the
// request bodies for the API-direct flow:
//
//   1. POST /api/bo/promotion              ← body returned in `.promotion`
//   2. POST /api/bo/messagetemplate        ← body returned in `.messageTemplate` (or null)
//   3. POST /api/bo/promotionname × N      ← bodies returned in `.names`
//   4. PUT  /api/bo/promotion/{id}         ← built by `.buildUpdate(promotionId, templateId)`
//
// The baselines (DEP / FC / FS) below are lifted verbatim from the live
// captures at captures/api-contract/*.json (3 successful QPRO11 saves on
// 2026-05-14). For per-request fields (code, validity, currency block, FS
// game) we override; everything else (Layer-1 game-provider IDs, category
// IDs, KYC tiers, eligible_types, etc.) is inherited from the baseline.
//
// Future work: replace hardcoded category/provider ID lookups with a GET
// call to /api/bo/category and /api/bo/gameprovider so the mapper works
// outside QPRO11. For the first cut, the captures + a 1-game lookup
// covers the user's test scope (Dep / FC / FS on QPRO11).

import { renderBody, renderDialogBody, localeDocKey } from './message-template-renderer.js';
import { getAllGameProviders, getAllCategories, getFreeSpinGames, getGameProviderDetail, getAllMemberGroups } from './api-client.js';
import { resolveBlacklistTemplateId } from './blacklist-template.js';
import { splitDualPromoName, gameAcronym } from './promo-namer.js';
import { isHardExcludedGameProvider } from './game-provider-exclusions.js';
import { resolveFreeSpinBet } from './free-spin-bet.js';

// Per-brand QPRO group naming varies — QPRO1 has bare names ("BRONZE",
// "SILVER", "DIAMOND") while QPRO2/6/11/17 use numbered names ("Bronze 1/2/3",
// "Silver 1/2/3 (Trial)"). Match by tier-prefix with optional numeric and
// optional "(Trial)" suffix. Plus the QPRO1-only "Pro VIP" maps to Platinum.
// Always exclude *Shadowban / Scammer / Test / Credit.
const QPRO_EXCLUDE_NAME_RE = /^\*|shadowban|^test|^credit$|scammer/i;

export function qproGroupMatchesTier(groupName, tier) {
  if (!groupName || !tier) return false;
  const T = String(tier).toUpperCase();
  let norm = String(groupName).toUpperCase().replace(/\s+/g, ' ').trim();
  if (QPRO_EXCLUDE_NAME_RE.test(norm)) return false;
  // Strip optional trial suffix
  norm = norm.replace(/\s*\(TRIAL\)\s*$/, '').trim();
  // PRO-VIP variants
  if (/^PRO[-\s]?GOLD[-\s]?VIP$/.test(norm)) return T === 'GOLD';
  if (/^PRO[-\s]?PLATINUM[-\s]?VIP$/.test(norm) || /^PRO\s+VIP$/.test(norm)) return T === 'PLATINUM';
  // Strip trailing number
  const baseTier = norm.replace(/\s+\d+$/, '').trim();
  return baseTier === T;
}

// Resolve member_group_ids for QPRO when an operator tier_constraint applies.
// Returns null when no constraint — the QPRO API treats `[]` as "all members
// eligible" and the existing default is empty.
async function resolveQproMemberGroupIds(site, tierConstraint) {
  if (!tierConstraint) return null;
  const eligible = tierConstraint.eligible_tiers || [];
  if (eligible.length === 0) return null;
  const groups = await getAllMemberGroups(site);
  return groups
    .filter((g) => eligible.some((tier) => qproGroupMatchesTier(g.name, tier)))
    .map((g) => g.id)
    .sort((a, b) => a - b);
}

// ── Constants derived from captures ──────────────────────────────────────

// Layer-1-exclusion game provider IDs on QPRO11. Fallback only — used when
// no `site` is passed to buildApiPlan (e.g. legacy callers). New callers
// pass `site` and the mapper resolves the brand's actual installed-provider
// list at runtime via `getAllGameProviders` + LAYER1_GP_EXCLUSION_NAMES.
// 52 providers after applying the current hard exclusion set.
const QPRO11_GP_LAYER1_EXCL = [1,66,68,4,45,49,64,55,72,3,5,6,50,62,10,12,58,11,14,15,60,16,17,18,19,22,53,61,54,25,52,26,27,28,59,69,67,31,70,32,23,33,35,34,36,73,38,65,74,42,43,57];

// Layer-1 exclusion NAMES — uniform across brands; provider IDs differ per
// brand BO install. Per `project_promo_code_automation_flow.md`. We match
// case-insensitively against the `name` field on /api/bo/gameprovider rows.
// Fetch the target brand's installed game providers and return only the
// IDs that AREN'T in the Layer-1 exclusion list — i.e. the same semantic
// as the legacy QPRO11_GP_LAYER1_EXCL constant but resolved per-brand so
// each merchant's catalog drift doesn't trip the BO validator (HTTP 422
// "target.0.game_provider_ids.N is invalid").
async function resolveLayer1GpIds(site) {
  const { rows } = await getAllGameProviders(site);
  // Match by NAME or CODE — per-brand catalogs may list "Dream Gaming"
  // (name) with code "DG", or vice versa. Operator's exclusion list uses
  // short codes; brand catalogs sometimes only have long names. Matching
  // either field catches both shapes (verified 2026-05-18 on QPRO7 where
  // DG=Dream Gaming and SSG=Super Spade Gaming weren't excluded by name).
  return rows
    .filter((r) => !isHardExcludedGameProvider(r))
    .map((r) => r.id);
}

// Resolve provider IDs for a category-restricted promo. The QPRO gameprovider
// catalog includes a `categories` array on each row (probed 2026-07-02) — each
// entry has { category: "SPORT"|"LIVE CASINO"|"SLOTS"|..., code: "SP"|"LC"|"SL"|... }.
// We filter to providers tagged with at least one of the wallet category names
// in `categoryNames` (matches categoriesOnly tokens from the request).
// Called instead of resolveLayer1GpIds when categoriesOnly is set.
// The Layer-1 exclusion names still apply on top of the category filter —
// a Slots-only promo must not include 918KAYA/Habanero/etc. just because
// they carry slots games (operator correction 2026-07-09, P026).
async function resolveCategoryGpIds(site, categoryNames) {
  const catSet = new Set(categoryNames.map((n) => n.toUpperCase()));
  const { rows } = await getAllGameProviders(site);
  return rows
    .filter((r) => (r.categories || []).some((c) => catSet.has(String(c.category || '').toUpperCase())))
    .filter((r) => !isHardExcludedGameProvider(r))
    .map((r) => r.id);
}

// Layer-1-exclusion category IDs on QPRO11. Fallback only. New callers
// pass `site` to buildApiPlan and the mapper resolves per-brand via
// resolveCategoryIds() (allow-list of wallet category NAMES — uniform
// across brands; IDs drift per merchant install). 7 categories.
const QPRO11_CAT_LAYER1_EXCL = [9, 12, 4, 5, 2, 3, 1];

// Categories for FS (Slots only). Fallback ID 3 = SLOTS on QPRO11; the
// dynamic resolver looks up SLOTS by name per brand.
const QPRO11_CAT_FS = [3];

// Allow-list of wallet category NAMES — the 7 categories the operator
// wants on every non-FS promo. Everything else (admin rows like
// "NEW MEMBER", "APPS", "SHOW ALL"; non-wallet verticals like POKER,
// COCK FIGHT, TABLE, ARCADE, LOTTERY, LOTTERY2, EVENT, VIP) is excluded.
// Derived from QPRO11's included set as of 2026-05-16.
const ALLOWED_WALLET_CATEGORY_NAMES = ['SPORT', 'LIVE CASINO', 'SLOTS', 'E-SPORTS', 'FISHING', 'CRASH', 'CRICKET'];

// FS uses Slots only on both QPRO and QP2 (operator rule 2026-05-13).
const FS_ONLY_CATEGORY_NAMES = ['SLOTS'];

// Fetch the brand's installed categories and return the IDs + names matching
// the allow-list (case-insensitive). For FS, restrict to SLOTS. An operator-
// supplied categoriesOnly array (from instructions) overrides everything.
// Names are returned uppercase so they're directly comparable against the
// canonical tokens used by the blacklist-template resolver.
async function resolveCategoryIds(site, { isFs, categoriesOnly = null } = {}) {
  const rows = await getAllCategories(site);
  let allowSrc;
  if (Array.isArray(categoriesOnly) && categoriesOnly.length) {
    allowSrc = categoriesOnly;
  } else if (isFs) {
    allowSrc = FS_ONLY_CATEGORY_NAMES;
  } else {
    allowSrc = ALLOWED_WALLET_CATEGORY_NAMES;
  }
  const allow = new Set(allowSrc.map((n) => n.toUpperCase()));
  const matched = rows.filter((c) => allow.has(String(c.name || '').toUpperCase()));
  return {
    ids: matched.map((c) => c.id),
    names: matched.map((c) => String(c.name || '').toUpperCase()),
  };
}

// Game provider label → ID for FS — fallback only. Each QPRO brand has its
// own /api/bo/gameprovider catalog and PP2's id drifts (QPRO11=69, QPRO1=96).
// New callers pass `site` to buildApiPlan and `resolveFsProviderId` looks
// up the brand's installed PP2 (matching by row.code, which is uniform).
const QPRO11_FS_PROVIDER_ID_BY_PREFIX = {
  'PP':  68,
  'PP2': 69,
};

// Operator default per 2026-05-16 — FS promos that don't specify a provider
// in the sheet use PP2 (Pragmatic Play). Mirrors the namer's default.
const DEFAULT_FS_PROVIDER_LABEL = 'PP2 - Pragmatic Play';

// Resolve the brand's FS provider id + BO code via /api/bo/gameprovider.
// Matches by `code` field first — uniform across brands (e.g. PP2, PP,
// JILI) — for the legacy "<CODE> - <Name>" operator convention. Falls back
// to matching the provider NAME so a plain-English label like "Playtech"
// (src/ingest.js now parses this from an operator's "(Playtech)" annotation
// — operators don't know/write BO codes) still resolves. Returns {id, code}
// so callers can reuse the resolved BO code for the freespingame lookup
// instead of re-deriving a prefix from the input label — deriving a prefix
// from a bare name breaks (caught on P053: "Playtech" derived to prefix
// "PLAYTECH", which matches no provider code — the real BO code is "PTI").
async function resolveFsProvider(site, label) {
  const supplied = String(label || DEFAULT_FS_PROVIDER_LABEL).trim();
  const pragmaticAlias = /^(?:pragmatic(?:\s+play(?:\s+2)?)?|pp2?|pp2?\s*[-—]\s*pragmatic\s+play)$/i.test(supplied);
  const raw = pragmaticAlias ? DEFAULT_FS_PROVIDER_LABEL : supplied;
  const prefix = raw.split(/[\s-]+/)[0].trim().toUpperCase();
  const { rows } = await getAllGameProviders(site);
  const byCode = prefix ? rows.find((r) => String(r.code || '').trim().toUpperCase() === prefix) : null;
  if (byCode) return { id: byCode.id, code: byCode.code };
  const nameNorm = raw.replace(/^[A-Za-z0-9]+\s*-\s*/, '').trim().toLowerCase();
  const byName = nameNorm ? rows.find((r) => String(r.name || '').trim().toLowerCase() === nameNorm) : null;
  return byName ? { id: byName.id, code: byName.code } : { id: 0, code: null };
}

// Tokenize a game name to a set of word-stems for fuzzy matching:
//   - lowercase
//   - strip non-alphanumeric (e.g. apostrophes, dashes)
//   - drop tokens shorter than 3 chars ("of", "to", "a" — too noisy)
//   - strip a trailing 's' so "gates"/"gate" both stem to "gate"
// Returns a Set<string>.
function stemTokens(s) {
  return new Set(
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3)
      .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t)),
  );
}

// Compare two Sets for equality.
function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// Resolve a free-spin game CODE (e.g. "vs20olympgate") from a human game label
// (e.g. "Gates of Olympus") by hitting /api/bo/gameprovider/freespingame/<code>.
//
// Strategy — exact-first, never silently up-shift to a variant:
//   1. If the input is "<code> - <name>", use the code portion verbatim.
//   2. Exact case-insensitive name match → return its code.
//   3. EXACT stem-set match — input stems == game stems (singular/plural-
//      tolerant via stemTokens). Operator's "Gates of Olympus" stems to
//      {gate, olympu}; game "Gates of Olympus" has the same stems but
//      "Gates of Olympus Super Scatter" has {gate, olympu, super, scatter}
//      — only the first is a match.
//   4. If multiple stem-set matches exist (shouldn't happen with PP2 but
//      possible with other providers), return null and let the caller
//      surface the ambiguity instead of guessing.
//   5. No subset/substring fallback — that's where the "Super Scatter
//      vs Gates of Olympus" confusion creeps in. Variants like "Super
//      Scatter / 1000 / Xmas / Dice" are DISTINCT games per operator rule
//      2026-05-16 (feedback_fs_game_name_exact.md).
//   6. Return null on miss; caller surfaces "no exact match" to operator.
async function resolveFsGameCode(site, providerCode, gameInput) {
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

  const wantStems = stemTokens(raw);
  if (wantStems.size === 0) return null;
  const stemMatches = games.filter((g) => setsEqual(stemTokens(g.name), wantStems));
  if (stemMatches.length === 1) return stemMatches[0].code;
  return null;
}

// settings_locale_id values seen in the QPRO11 message-template POST.
// 1=MY_EN, 3=MY_ZH, 6=SG_EN, 7=SG_ZH, 8=ID_EN, 9=ID_ID. The mapper only
// needs MY_EN + MY_ZH for our test fixtures.
const LOCALE_TO_SETTINGS_ID = {
  MY_EN: 1, MY_ZH: 3,
  SG_EN: 6, SG_ZH: 7,
  ID_EN: 8, ID_ID: 9,
};

// Currency label → currency_id. Verified 2026-05-17 against /api/bo/currency
// on both QPRO and QP2 BOs: MYR=1, SGD=3, IDR=4. The previous mapping had
// SGD=2 and IDR=3 — caused IDR sends to land as SGD rows and SGD sends to
// silently no-op. THB / KHR / AUD not yet verified — probe before using.
const CURRENCY_TO_ID = { MYR: '1', SGD: '3', IDR: '4', THB: '?', KHR: '?', AUD: '?' };
const ID_TO_CURRENCY = Object.fromEntries(Object.entries(CURRENCY_TO_ID).map(([k, v]) => [Number(v), k]));

// Region-prefix on a locale code → currency label. Per project memory's
// locale→currency mapping (MY_EN → MYR, SG_ZH → SGD, ID_ID → IDR, etc.).
const LOCALE_REGION_TO_CURRENCY = { MY: 'MYR', SG: 'SGD', ID: 'IDR', TH: 'THB', KH: 'KHR', AU: 'AUD' };
function localeCurrency(locale) {
  const m = String(locale || '').match(/^([A-Z]{2})_/);
  return m ? LOCALE_REGION_TO_CURRENCY[m[1]] || null : null;
}

// Filter `resolved.currencies` / `.locales` / `.per_currency_overrides` to
// only those supported by the FS provider on this brand. Operator rule
// 2026-05-16: when a provider on a brand doesn't support every requested
// currency, just create the promo with the supported subset (do not skip
// the brand). Locales tied to dropped currencies are dropped too — the
// inbox/popup wouldn't render correctly for a currency that doesn't exist.
function filterResolvedToSupportedCurrencies(resolved, supportedCurrencies) {
  if (!supportedCurrencies?.length) return resolved;
  const supported = new Set(supportedCurrencies);
  const filteredCurrencies = (resolved.currencies || []).filter((c) => supported.has(c));
  if (filteredCurrencies.length === (resolved.currencies || []).length) return resolved;
  const filteredLocales = (resolved.locales || []).filter((l) => {
    const c = localeCurrency(l);
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

// Section/Type integers for the Message Template Create endpoint
// (captured: section=8, type=1 for promo inbox messages).
const MSG_TEMPLATE_SECTION_PROMOTIONS = '8';
const MSG_TEMPLATE_TYPE_MESSAGE       = '1';
const MSG_TEMPLATE_TYPE_SMS           = '2';

// ── Helpers ──────────────────────────────────────────────────────────────

function arrayToIntObj(arr) {
  // Convert [9,12,4,...] → {"0":9,"1":12,"2":4,...} matching POST shape.
  const out = {};
  arr.forEach((v, i) => { out[String(i)] = v; });
  return out;
}

function nowYmdHms() {
  // UTC formatting — BO stores datetime strings as-if UTC. Using local time
  // here produces an N-hour offset (8h on SGT VDI) so popups + promos
  // appear future-dated and don't go live until that offset elapses.
  // Verified 2026-05-17 (feedback_dialog_start_date_now.md).
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function promoTypeInt(bonusType) {
  const bt = (bonusType || '').toLowerCase();
  if (bt.includes('free spin'))   return 4;
  if (bt.includes('free credit')) return 3;
  if (bt.includes('cashback'))    return 2; // QPRO treats Cashback like Deposit
  return 2;                                  // Deposit
}

function promoSubTypeInt(bonusSubType, bonusType) {
  // QPRO1 verified 2026-06-22 (project_qpro_promo_type_subtype_map.md):
  //   (type, sub) → rendered label
  //   (2, 1) = Deposit - Reload   (2, 2) = Deposit - Welcome
  //   (3, 1) = Free Credit
  //   (4, 1) = Free Spin - Welcome   (4, 2) = Free Spin - Reload
  const s = (bonusSubType || '').toLowerCase();
  const bt = (bonusType || '').toLowerCase();
  const isWelcome = s.includes('welcome') || bt.includes('welcome');
  if (bt.includes('free spin'))   return isWelcome ? 1 : 2;
  if (bt.includes('free credit')) return 1;
  if (bt.includes('cashback'))    return 1;
  // Deposit (default): Welcome→2, Reload→1
  return isWelcome ? 2 : 1;
}

function fsProviderIdFromLabel(label) {
  if (!label) return 0;
  const supplied = String(label).trim();
  const prefix = /^(?:pragmatic(?:\s+play(?:\s+2)?)?|pp2?|pp2?\s*[-—]\s*pragmatic\s+play)$/i.test(supplied)
    ? 'PP2'
    : supplied.split(/[\s-]+/)[0].trim();
  return QPRO11_FS_PROVIDER_ID_BY_PREFIX[prefix] ?? 0;
}

function fsGameCodeFromLabel(label) {
  if (!label) return null;
  return label.includes(' - ') ? label.split(' - ')[0].trim() : label.trim();
}

// ── Promotion-currency builders (one per bonus type) ─────────────────────

function buildCurrencyBlockDeposit(resolved, currencyLabel) {
  const o = resolved.per_currency_overrides?.[currencyLabel] || {};
  const r = resolved.parsed || {};
  return {
    currency_id: CURRENCY_TO_ID[currencyLabel] ?? '1',
    min_transfer:           o.min_deposit      ?? r.min_deposit      ?? 0,
    max_bonus:              o.max_bonus        ?? r.max_bonus        ?? 0,
    max_total_applications: 0,
    max_total_bonus:        0,
    status:        '1',
    max_transfer_out: 0,
    promo_type:  promoTypeInt(resolved.bonus_type),
    currency:    currencyLabel,
    current_players: 0,
    used_budget: 0,
  };
}

function buildCurrencyBlockFC(resolved, currencyLabel) {
  const o = resolved.per_currency_overrides?.[currencyLabel] || {};
  const r = resolved.parsed || {};
  return {
    currency_id: CURRENCY_TO_ID[currencyLabel] ?? '1',
    min_transfer:           o.min_deposit ?? r.min_deposit ?? 0,
    max_balance_claim:      0,
    max_total_applications: 0,
    max_total_bonus:        0,
    free_credit_amount:     o.free_credit_amount ?? r.free_credit_amount ?? 0,
    status:           '1',
    max_transfer_out: o.max_transfer_out  ?? r.max_transfer_out  ?? 0,
    promo_type:       promoTypeInt(resolved.bonus_type),
    currency:         currencyLabel,
    current_players:  0,
    used_budget:      0,
  };
}

function buildCurrencyBlockFS(resolved, currencyLabel) {
  const o = resolved.per_currency_overrides?.[currencyLabel] || {};
  const r = resolved.parsed || {};
  const spinCount     = o.spin_count      ?? r.spin_count      ?? 0;
  const aplRaw        = o.amount_per_line ?? r.amount_per_line ?? null;
  const valuePerSpin  = o.value_per_spin  ?? r.value_per_spin  ?? null;
  const bet = resolveFreeSpinBet({ provider: r.game_provider, valuePerSpin, amountPerLine: aplRaw });
  // Playtech games take amount_per_line as a direct currency bet amount
  // (BO's accepted-bet list is denominations like 0.20/0.30/.../500.00) —
  // confirmed 2026-07-10 via a live HTTP 422 on P053 ("Fire Blaze: Green
  // Wizard"): dividing 0.20 by anything landed on 0.02/0.01, neither of
  // which the BO accepted; sending 0.20 as-is was the only accepted value.
  // Current operator standard: coins=0, lines=0, and Pragmatic Play/default
  // amount_per_line = value_per_spin / 20.
  // Playtech FS mechanic (operator rule 2026-07-10): coins=0, lines=0,
  // amount_per_line=the direct bet-per-spin amount.
  return {
    currency_id: CURRENCY_TO_ID[currencyLabel] ?? '1',
    coins:           bet.coins,
    // If sheet stated amount_per_line directly, use it.
    // Playtech: use value_per_spin as-is (no division — see comment above).
    // Else (Pragmatic Play/default): divide value_per_spin by 20, floor 2dp.
    amount_per_line: bet.amountPerLine,
    rounds:          spinCount,
    lines:           bet.lines,
    min_transfer:    o.min_deposit  ?? r.min_deposit  ?? 0,
    max_total_applications: 0,
    max_total_bonus:        0,
    status:          '1',
    max_transfer_out: o.max_transfer_out ?? r.max_transfer_out ?? 0,
    promo_type:      promoTypeInt(resolved.bonus_type),
    currency:        currencyLabel,
    current_players: 0,
    used_budget:     0,
  };
}

// ── Main builder ─────────────────────────────────────────────────────────

// QPRO BO's promotion `name` field is the operator's internal-reference
// label, sourced from column M (`name_details_raw`). Operators write this in
// QPRO format (e.g. "50% Welcome, max bonus 500, min dep 1000, 15x TO, All Games")
// — NOT in WS1/WS2 parenthetical format (MIN/CAP/TO). Tier-indicator lines
// like "Silver and below" / "Gold and above" / "Diamond only" are operator
// metadata, not part of the name — strip them. Multi-line content is
// collapsed to a single line with " | " separators.
function qproInternalName(resolved) {
  const raw = String(resolved.name_details_raw || '').trim();
  if (!raw) return splitDualPromoName(resolved.promotion_name_en).generic || resolved.promo_code;
  const cleaned = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^(normal|bronze|silver|gold|platinum|diamond)\s+(and\s+)?(above|below|only)\b/i.test(line))
    .join(' | ');
  return cleaned || splitDualPromoName(resolved.promotion_name_en).generic || resolved.promo_code;
}

function buildPromotionBody(resolved, gpIdsForBrand = null, catIdsForBrand = null, fsProviderIdForBrand = null, fsGameCodeForBrand = null, memberGroupIdsForBrand = null, blacklistTemplateId = null) {
  const bt = (resolved.bonus_type || '').toLowerCase();
  const isFs  = bt.includes('free spin');
  const isFc  = bt.includes('free credit');
  const isDep = !isFs && !isFc; // Deposit + Cashback
  const r = resolved.parsed || {};

  const promo_type     = promoTypeInt(resolved.bonus_type);
  const promo_sub_type = promoSubTypeInt(resolved.bonus_sub_type, resolved.bonus_type);

  // Categories + Game Providers vary per bonus type. catIdsForBrand wins
  // when supplied (dynamic resolver via buildApiPlan); falls back to the
  // QPRO11 hardcoded list when site wasn't threaded through.
  const catIds = catIdsForBrand
    ? catIdsForBrand
    : (isFs ? QPRO11_CAT_FS : QPRO11_CAT_LAYER1_EXCL);
  let gpIds;
  let fsProviderId = 0;
  let fsGameCode   = null;
  if (isFs) {
    const fsLabel = r.game_provider || DEFAULT_FS_PROVIDER_LABEL;
    fsProviderId = (fsProviderIdForBrand != null && fsProviderIdForBrand > 0)
      ? fsProviderIdForBrand
      : fsProviderIdFromLabel(fsLabel);
    // Prefer brand-resolved code (looked up via /api/bo/gameprovider/freespingame/<code>);
    // fall back to the operator-supplied label's code-portion when offline.
    fsGameCode = fsGameCodeForBrand || fsGameCodeFromLabel(r.game);
    gpIds = [fsProviderId];
  } else if (gpIdsForBrand) {
    // Brand-specific provider list, resolved at runtime by buildApiPlan.
    gpIds = gpIdsForBrand;
  } else {
    // Legacy fallback (QPRO11's catalog). Only hit when buildPromotionBody
    // is called without `site` — works on QPRO11 by coincidence, drifts
    // elsewhere.
    gpIds = QPRO11_GP_LAYER1_EXCL;
  }

  // Per-currency block (one entry per resolved.currencies)
  const currencies = resolved.currencies?.length ? resolved.currencies : ['MYR'];
  const promotion_currency = {};
  currencies.forEach((c, i) => {
    if (isFs)      promotion_currency[String(i)] = buildCurrencyBlockFS(resolved, c);
    else if (isFc) promotion_currency[String(i)] = buildCurrencyBlockFC(resolved, c);
    else           promotion_currency[String(i)] = buildCurrencyBlockDeposit(resolved, c);
  });

  // Multiplier (TO requirement)
  const multiplier = r.to_multiplier ?? 0;

  // Body matches POST capture shape. Booleans use true/false on POST
  // (per the captures); the PUT will flip them to 0/1 — see buildUpdate.
  const body = {
    code: resolved.promo_code,
    // QPRO BO `name` follows column M internal-reference (with tier
    // indicators stripped) per operator rule 2026-05-17. Consumer-facing
    // promotion names live in separate promotion_name rows.
    name: qproInternalName(resolved),
    free_spin_game_provider_id: fsProviderId,
    promotion_category_turnover: arrayToIntObj(catIds),
    promo_type,
    promo_sub_type: String(promo_sub_type),
    valid_from: nowYmdHms(),
    validity: resolved.validity_days ?? resolved.rewards_validity_days ?? 30,
    reward_validity: resolved.rewards_validity_days ?? 30,
    frequency: [],
    frequency_type: '1',
    first_deposit: 0,
    // Captures: Dep/FS send `true` (checked), FC sends `0` (unchecked).
    // Match Angular's form serialization observed in captures exactly.
    last_deposit: (isDep || isFs) ? true : 0,
    auto_approve: true,
    auto_reward_activation: 1,
    visible_by_affiliate: 0,
    recurring: resolved.recurring === true ? '1' : '0',
    // Operator-supplied caps from sheet col T (parsed in src/ingest-xlsx.js).
    // Fallback:
    //   - max_per_player=99999 (effectively unlimited)
    //   - daily_max=99999 for recurring promos
    //   - daily_max=1 for one-time promos
    max_per_player: resolved.max_per_player ?? 99999,
    daily_max: resolved.daily_max ?? (resolved.recurring === true ? 99999 : 1),
    limit_transfer_in: true,
    limit_transfer_out: true,
    // FS captures show `restrict_claim_round_active: true` (not 1); others 0.
    restrict_claim_round_active: isFs ? true : 0,
    // FS sends 0 (Angular unticked-checkbox); Dep/FC send false (untouched).
    restrict_same_provider_launch: isFs ? 0 : false,
    auto_unlock: true,
    allow_cancel: 0,
    fixed_amount: 0,
    game_provider_ids: arrayToIntObj(gpIds),
    target: {
      '0': {
        type: 1, // Included (Turnover)
        multiplier,
        game_provider_ids: arrayToIntObj(gpIds),
      },
    },
    deposit_count: 0,
    eligible_types: '1', // Members
    telemarketer_ids: [],
    normal_account_manager_ids: [],
    vip_account_manager_ids: [],
    requires_email: false,
    requires_mobile: false,
    requires_dob: false,
    requires_fullname: false,
    transfer_unlock: false,
    kyc_basic: !isFc,    // FC only ticks Pro per QPRO skill convention
    kyc_advanced: !isFc,
    kyc_pro: true,
    // Blacklist Template — selected right after game categories. Operator
    // rule 2026-05-26: must be set before save. Resolved by exact category-
    // set match (FS shortcut: always "Slots Only"). See blacklist-template.js.
    // NOTE: GET returns field as blacklist_id; PUT accepts blacklist_id.
    blacklist_id: blacklistTemplateId,
    black_list_sub_categories: [],
    dialog_popup_list: [],
    promotion_currency,
  };
  // Recurring promos carry a reset_frequency value (captured: 1 = Daily Max).
  if (resolved.recurring === true) body.reset_frequency = 1;
  // Bonus rate is only emitted for Deposit (FC capture shows it omitted;
  // FS capture sends 0). Match that behavior exactly.
  if (isDep) body.bonus_rate = r.bonus_rate_pct ?? 0;
  else if (isFs) body.bonus_rate = 0;
  if (isFs) body.free_spin_game_code = fsGameCode;
  return body;
}

// ── Name + Template builders ─────────────────────────────────────────────

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
    // Per-locale currency mapping (see api-mapper-qp2 buildNameBodies for
    // the parallel fix). Earlier code used resolved.currencies[0] for ALL
    // locales, so every name row landed on MYR.
    const region = (locale.match(/^([A-Z]{2})_/)||[])[1] || 'MY';
    const ccy = LOCALE_REGION_TO_CURRENCY[region] || 'MYR';
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

async function buildMessageTemplateBody(resolved, brand) {
  if (!(resolved.inbox_message === true)) return null;
  if (/cashback/i.test(resolved.bonus_type || '')) return null; // not authored yet

  // Inline override: operator pre-fetched bodies (e.g. cloned from QP2D ref).
  // Swap :merchantname → :brandname so QPRO BO substitutes correctly.
  if (resolved.inline_mt_bodies) {
    const details = {};
    for (const [key, loc] of Object.entries(resolved.inline_mt_bodies)) {
      details[key] = {
        settings_locale_id: loc.settings_locale_id,
        subject: loc.subject,
        message: String(loc.message).replace(/:merchantname/g, ':brandname'),
      };
    }
    return {
      name: resolved.promo_code,
      section: Number(MSG_TEMPLATE_SECTION_PROMOTIONS),
      type: Number(MSG_TEMPLATE_TYPE_MESSAGE),
      status: 1,
      details,
      code: `PROMOTIONS.MESSAGE.${resolved.promo_code}`,
    };
  }

  const details = {};
  const allowed = new Set(['EN', 'ZH', 'ID']);
  for (const locale of resolved.locales || []) {
    const dk = localeDocKey(locale);
    if (!allowed.has(dk)) continue;
    const rendered = await renderBody({
      bonusType: resolved.bonus_type,
      locale,
      brand,
      platform: 'qpro',
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
    section: Number(MSG_TEMPLATE_SECTION_PROMOTIONS), // integer (BO 6.6 form validation expects int)
    type: Number(MSG_TEMPLATE_TYPE_MESSAGE),
    status: 1,
    details,
    code: `PROMOTIONS.MESSAGE.${resolved.promo_code}`,
  };
}

function hasSmsRequirement(resolved) {
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

function buildSmsLocaleCopy(resolved, locale) {
  const dk = localeDocKey(locale);
  const isZh = dk === 'ZH';
  const currency = localeCurrency(locale) || (resolved.currencies || [])[0] || 'MYR';
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
      message: `${prefix}:brandname: :username, last call for ${spinCount}FS${gameToken ? ` ${gameToken}` : ''}.${minDepToken ? ` ${minDepToken}/` : ' '}TO${to}x. Claim now: :url`.replace(' .', '.'),
    };
  }

  if (bt.includes('free credit') && freeCredit != null && to != null) {
    if (isZh) {
      return {
        message: `${prefix}:username ${freeCredit}FC。TO${to}x。:url`,
      };
    }
    return {
      message: `${prefix}:brandname: :username, last call for ${freeCredit}FC. TO${to}x. Claim now: :url`,
    };
  }

  if ((bt.includes('deposit') || bt.includes('reload') || bt.includes('welcome')) && bonusPct != null && to != null) {
    if (isZh) {
      return {
        message: `${prefix}:username ${bonusPct}% dep BNS。${minDepToken ? `${minDepToken}/` : ''}TO${to}x。:url`,
      };
    }
    return {
      message: `${prefix}:brandname: :username, ${bonusPct}% dep BNS is on.${minDepToken ? ` Min ${minDepToken}/` : ' '}TO${to}x. Act now: :url`.replace(' .', '.'),
    };
  }

  return null;
}

async function buildSmsTemplateBody(resolved, brand) {
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

// ── Dialog Popup POST body (QPRO shape) ──────────────────────────────────
// QPRO POST /api/bo/popups body — 10 top-level fields. NO `site_id` (QPRO
// is single-merchant). NO `do_not_show_again`. Includes `label` (operator
// practice = EN promotion name). Captured from QPRO11 V7 (PUT 200).

// Left button label depends on min_deposit (operator rule 2026-05-20):
//   min_deposit > 0  → "DEPOSIT" + /member/deposit
//   min_deposit == 0 → "CLAIM NOW" + /member/reward
// Right button is always "READ MORE" → /member/message.
const CTA_TEXT_BY_DOCKEY = {
  EN: { claim: 'CLAIM NOW',     deposit: 'DEPOSIT', right: 'READ MORE' },
  ZH: { claim: '立即领取',       deposit: '存款',     right: '阅读更多' },
  ID: { claim: 'Klaim Sekarang', deposit: 'Deposit',  right: 'Info Lanjut' },
};

export async function buildDialogPopupBody(resolved, brand) {
  if (resolved.popup_dialog !== true) return null;
  if (/cashback/i.test(resolved.bonus_type || '')) return null;
  const r = resolved.parsed || {};
  const minDep = Number(r.min_deposit ?? 0);
  const useDeposit = minDep > 0;
  const ctaLeftLink  = useDeposit ? '/member/deposit' : '/member/reward';
  const ctaRightLink = '/member/message';

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
    platform: 1,
    start_date: nowYmdHms(),
    session: '3',  // After Login
    position: 99,
    status: 1,
    contents,
    location: 1,
    affiliates_visibility: 0,
    always_pop: 0,
    label: splitDualPromoName(resolved.promotion_name_en).generic || resolved.promo_code,
  };
}

// ── Update (PUT) builder ─────────────────────────────────────────────────
// Re-emits POST body with strict type normalization (booleans as 0/1, ints
// as ints) and the linked template ID. Matches PUT capture shape.
function buildUpdateBody(resolved, promotionId, templateId, dialogPopup, gpIdsForBrand = null, catIdsForBrand = null, fsProviderIdForBrand = null, fsGameCodeForBrand = null, memberGroupIdsForBrand = null, blacklistTemplateId = null, smsTemplateId = 0) {
  const promo = buildPromotionBody(resolved, gpIdsForBrand, catIdsForBrand, fsProviderIdForBrand, fsGameCodeForBrand, memberGroupIdsForBrand, blacklistTemplateId);
  const b01 = (v) => (v === true ? 1 : v === false ? 0 : v);
  return {
    id: promotionId,
    code: promo.code,
    name: promo.name,
    free_spin_game_provider_id: promo.free_spin_game_provider_id,
    promotion_category_turnover: promo.promotion_category_turnover,
    promotion_category_winloss: [],
    promo_type: promo.promo_type,
    promo_sub_type: Number(promo.promo_sub_type),
    promotion_ids: [],
    valid_from: promo.valid_from,
    validity: promo.validity,
    reward_validity: promo.reward_validity,
    frequency: promo.frequency,
    frequency_type: Number(promo.frequency_type),
    first_deposit: promo.first_deposit,
    // Per operator rule 2026-05-17 (feedback_qpro_no_member_groups.md):
    // QPRO never sets member_group_ids. Tier prefixes in promo_code are
    // internal reference only — audience segmentation is handled outside
    // the promo. Always emit empty array.
    member_group_ids: [],
    last_deposit: b01(promo.last_deposit),
    auto_approve: b01(promo.auto_approve),
    auto_reward_activation: 1,
    visible_by_affiliate: promo.visible_by_affiliate,
    recurring: Number(promo.recurring),
    max_per_player: promo.max_per_player,
    daily_max: promo.daily_max,
    status: 1,
    limit_transfer_in: b01(promo.limit_transfer_in),
    limit_transfer_out: b01(promo.limit_transfer_out),
    restrict_claim_round_active: b01(promo.restrict_claim_round_active),
    restrict_same_provider_launch: b01(promo.restrict_same_provider_launch),
    bonus_rate: promo.bonus_rate != null ? String(Number(promo.bonus_rate).toFixed(2)) : undefined,
    // reset_frequency=0 fails PUT validation ("invalid enum") — treat same as null.
    ...(promo.reset_frequency != null && promo.reset_frequency !== 0 ? { reset_frequency: promo.reset_frequency } : {}),
    ...(promo.free_spin_game_code ? { free_spin_game_code: promo.free_spin_game_code } : {}),
    auto_unlock: b01(promo.auto_unlock),
    allow_cancel: promo.allow_cancel,
    game_provider_ids: promo.game_provider_ids,
    target: promo.target,
    message_template_id: templateId || 0,
    message_template_sms_id: smsTemplateId || 0,
    eligible_types: Number(promo.eligible_types),
    affiliate_group_ids: [],
    telemarketer_ids: [],
    normal_account_manager_ids: [],
    vip_account_manager_ids: [],
    requires_email: promo.requires_email,
    requires_mobile: promo.requires_mobile,
    requires_dob: promo.requires_dob,
    requires_fullname: promo.requires_fullname,
    transfer_unlock: b01(promo.transfer_unlock),
    kyc_basic: promo.kyc_basic,
    kyc_advanced: promo.kyc_advanced,
    kyc_pro: promo.kyc_pro,
    blacklist_id: promo.blacklist_id,    // GET/PUT field is blacklist_id
    black_list_sub_categories: [],
    // QPRO PUT does NOT send promotion_currency — verified 2026-05-18:
    // POST creates correct per-currency rows; re-emitting the same shape
    // on PUT silently drops non-MYR rows (probably because the BO's PUT
    // handler treats promotion_currency.X.id absence as "create new" and
    // creates duplicates that collide on (promotion_id, currency_id) and
    // get soft-deleted). Earlier "preserve" comment was wrong.
    // QPRO dialog_popup_list shape: 6-field object keyed by "0".
    // Captured 2026-05-15 via dialog-link-mechanism-probe on QPRO11 MB17.
    dialog_popup_list: (dialogPopup && dialogPopup.id) ? {
      '0': {
        id: dialogPopup.id,
        popup_id: dialogPopup.id,
        start_date: dialogPopup.start_date || nowYmdHms(),
        end_date: null,
        promotion_id: promotionId,
        labelKey: dialogPopup.label ? `${dialogPopup.code} (${dialogPopup.label.slice(0, 14)} . . . )` : dialogPopup.code,
        code: dialogPopup.code,
      },
    } : [],
  };
}

// ── Public API ───────────────────────────────────────────────────────────

export async function buildApiPlan(resolved, { brand, site } = {}) {
  // Col W can hold multi-line codes (e.g. "CODE\nWS2: CODE_V2") for platforms
  // that need a separate code variant. QPRO/QP2 always use line 1.
  if (resolved.promo_code && resolved.promo_code.includes('\n')) {
    resolved = { ...resolved, promo_code: resolved.promo_code.split('\n')[0].trim() };
  }
  // Per-brand catalog resolution (when `site` is supplied):
  //   - game_provider_ids: GET /api/bo/gameprovider, filter by Layer-1
  //     exclusion NAMES → per-brand IDs.
  //   - promotion_category_turnover: GET /api/bo/categories, filter by
  //     allow-list NAMES (wallet categories) → per-brand IDs. FS narrows
  //     to SLOTS-only.
  // Both fall back to QPRO11 hardcoded lists if `site` isn't threaded.
  const isFs = String(resolved.bonus_type || '').toLowerCase() === 'free spin';
  const categoriesOnly = resolved.instructions?.categories_only || null;
  // Tier constraint parsed from instructions does NOT apply to QPRO — per
  // operator rule 2026-05-17, QPRO never sets member_group_ids. Keep the
  // pointer here only for reporting in canary preview output (the value is
  // not threaded into the mapper).
  const tierConstraint = resolved.instructions?.tier_constraint || null;
  let gpIdsForBrand = null;
  let catIdsForBrand = null;
  let catNamesForBrand = null;
  let fsProviderIdForBrand = null;
  let fsGameCodeForBrand = null;
  // Blacklist template fallback when `site` isn't threaded (dry-run, tests,
  // ad-hoc rebuilds): use "All games" (id=1) on the shared QPRO BO. All 17
  // QPRO brands share bo.mei707.com so the id is universal. Verified
  // 2026-06-22 — prevents the canary (and any rebuilt PUT body) from emitting
  // blacklist_id=null, which QPRO PUT silently accepts and detaches the
  // template association (surfaced on P119–P121).
  let blacklistTemplateIdForBrand = 1;
  const memberGroupIdsForBrand = null;
  let effectiveResolved = resolved;
  if (site) {
    const fsLabel = resolved.parsed?.game_provider_by_brand?.[brand] || resolved.parsed?.game_provider || DEFAULT_FS_PROVIDER_LABEL;
    let catRes;
    let fsProviderResolved = null;
    [gpIdsForBrand, catRes, fsProviderResolved] = await Promise.all([
      isFs ? Promise.resolve(null)
           : (Array.isArray(categoriesOnly) && categoriesOnly.length
               ? resolveCategoryGpIds(site, categoriesOnly)
               : resolveLayer1GpIds(site)),
      resolveCategoryIds(site, { isFs, categoriesOnly }),
      isFs ? resolveFsProvider(site, fsLabel) : Promise.resolve(null),
    ]);
    fsProviderIdForBrand = fsProviderResolved?.id || null;
    catIdsForBrand = catRes.ids;
    catNamesForBrand = catRes.names;
    if (isFs && fsProviderResolved?.code) {
      fsGameCodeForBrand = await resolveFsGameCode(site, fsProviderResolved.code, resolved.parsed?.game_by_brand?.[brand] || resolved.parsed?.game);
      if (fsProviderIdForBrand) {
        const detail = await getGameProviderDetail(site, fsProviderIdForBrand);
        const supportedIds = detail?.currency || [];
        const supportedLabels = supportedIds.map((id) => ID_TO_CURRENCY[id]).filter(Boolean);
        effectiveResolved = filterResolvedToSupportedCurrencies(resolved, supportedLabels);
      }
    }
    // Blacklist Template id. Callers may inject an explicit id (incl. null) via
    // instructions.blacklist_id to bypass category resolution — used by
    // replication that mirrors the source's exact template, and by FC codes
    // that carry no blacklist (null). Otherwise resolve by category-set match
    // (throws if no template matches — operator must create one in BO).
    if (resolved.instructions && 'blacklist_id' in resolved.instructions) {
      blacklistTemplateIdForBrand = resolved.instructions.blacklist_id;
    } else {
      blacklistTemplateIdForBrand = await resolveBlacklistTemplateId(site, {
        categoryNames: catNamesForBrand,
        isFs,
      });
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
    promotion: buildPromotionBody(effectiveResolved, gpIdsForBrand, catIdsForBrand, fsProviderIdForBrand, fsGameCodeForBrand, memberGroupIdsForBrand, blacklistTemplateIdForBrand),
    messageTemplate: await buildMessageTemplateBody(effectiveResolved, brand),
    smsTemplate: await buildSmsTemplateBody(effectiveResolved, brand),
    dialogPopup: await buildDialogPopupBody(effectiveResolved, brand),
    buildNames: (promotionId) => buildNameBodies(effectiveResolved, promotionId),
    buildUpdate: (promotionId, templateId, dialogPopup, smsTemplateId = 0) =>
      buildUpdateBody(effectiveResolved, promotionId, templateId, dialogPopup, gpIdsForBrand, catIdsForBrand, fsProviderIdForBrand, fsGameCodeForBrand, memberGroupIdsForBrand, blacklistTemplateIdForBrand, smsTemplateId),
    currencyFilter: effectiveResolved !== resolved
      ? { kept: effectiveResolved.currencies, dropped: resolved.currencies.filter((c) => !effectiveResolved.currencies.includes(c)) }
      : null,
    memberGroupIds: memberGroupIdsForBrand,
    categoriesOnly,
    tierConstraint,
  };
}
