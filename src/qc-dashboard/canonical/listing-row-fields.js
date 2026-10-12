// Phase 2 collector: fields that live on the QPRO/QP2 *listing row* rather
// than on the detail record.
//
// Discovered 2026-07-31 while re-probing G4. The listing row returned by
// /api/bo/promotion?code=... is much richer than the code assumed — it already
// carries message-template bodies, dialog-popup links, provider codes,
// category codes and the auto-reward flag. Several fields the adapters were
// reporting as UNAVAILABLE were sitting here the whole time.
//
// Shared by qpro-adapter and qp2-adapter because the shapes are identical
// (both platforms are the same BO software family); the only divergence is
// the auto-reward field name, handled in autoRewardFromRow().

import { normalizeDecimal } from './canonical-model.js';
import { resolveCategoryCode } from './catalogues.js';

// settings_locale_id → canonical locale key.
//
// Derived empirically across 120 production bundles (QPRO + QP2A-D):
//   1 → MY_EN   (English subjects)         3 → MY_ZH   (Chinese subjects)
//   6 → SG_EN   (English subjects)         7 → SG_ZH   (Chinese subjects)
//   8 → ID_ID   (per bin/fix-b46-content-and-idlocale.mjs, which writes
//                settings_locale_id: 8 for the Indonesian locale)
//
// Unknown ids are surfaced as LOCALE_<id> rather than guessed — a wrong
// locale label would silently compare the wrong body against the wrong
// expected value.
export const SETTINGS_LOCALE_ID_MAP = Object.freeze({
  1: 'MY_EN', 3: 'MY_ZH', 6: 'SG_EN', 7: 'SG_ZH', 8: 'ID_ID',
});

export function localeKeyForSettingsId(id) {
  if (id == null) return null;
  const n = Number(id);
  if (!Number.isFinite(n)) return null;
  return SETTINGS_LOCALE_ID_MAP[n] || `LOCALE_${n}`;
}

// Collapse a locale key to its language for canonical content buckets, which
// are language-keyed (EN / ZH / ID) rather than region-keyed. Both MY_EN and
// SG_EN carry English copy; the compare engine asserts language-level content.
export function languageForLocaleKey(localeKey) {
  if (!localeKey) return null;
  if (/_EN$/.test(localeKey)) return 'EN';
  if (/_ZH$/.test(localeKey)) return 'ZH';
  if (/_(ID|IN)$/.test(localeKey)) return 'ID';
  if (/_TH$/.test(localeKey)) return 'TH';
  if (/_KM$/.test(localeKey)) return 'KM';
  return localeKey;
}

// ── G2: message-template bodies ─────────────────────────────────────────
//
// list_row.message_templates is an array of
//   { id, settings_locale_id, message_template_id, subject, message, ... }
// where `message` is the full HTML body. No follow-up fetch is required —
// the earlier plan to call /api/bo/messagetemplate/{id} per row was
// unnecessary.
//
// Returns { mtBody: {LANG: html}, mtSubject: {LANG: subject},
//           byLocale: {LOCALE_KEY: {subject, message}}, templateIds: [...] }
export function messageTemplatesFromRow(row = {}) {
  const list = Array.isArray(row.message_templates) ? row.message_templates : [];
  const mtBody = {};
  const mtSubject = {};
  const byLocale = {};
  const templateIds = [];
  for (const t of list) {
    if (!t || typeof t !== 'object') continue;
    const localeKey = localeKeyForSettingsId(t.settings_locale_id);
    if (!localeKey) continue;
    const lang = languageForLocaleKey(localeKey);
    const subject = typeof t.subject === 'string' ? t.subject : null;
    const message = typeof t.message === 'string' ? t.message : null;
    byLocale[localeKey] = { subject, message };
    // First writer per language wins so MY_EN (id 1) takes precedence over
    // SG_EN (id 6) — deterministic, and MY is the primary region.
    if (lang && message != null && mtBody[lang] == null) mtBody[lang] = message;
    if (lang && subject != null && mtSubject[lang] == null) mtSubject[lang] = subject;
    if (t.message_template_id != null && !templateIds.includes(t.message_template_id)) {
      templateIds.push(t.message_template_id);
    }
  }
  return { mtBody, mtSubject, byLocale, templateIds };
}

// SMS templates use the identical shape on a sibling key.
export function smsTemplatesFromRow(row = {}) {
  return messageTemplatesFromRow({ message_templates: row.sms_message_templates });
}

// ── G3: dialog popups ──────────────────────────────────────────────────
//
// list_row.dialog_popup_list is { id, promotion_id, popup_id } — LINKAGE
// only, no body. The popup body needs a separate read (and per team memory
// the direct popup GET 405s, so the listing endpoint is the supported path).
// This helper returns the linkage; body collection is a separate concern and
// must not be faked from the linkage alone.
export function dialogLinkageFromRow(row = {}) {
  const list = Array.isArray(row.dialog_popup_list) ? row.dialog_popup_list : [];
  const popupIds = [];
  for (const d of list) {
    const id = d?.popup_id ?? d?.id;
    if (id != null && !popupIds.includes(id)) popupIds.push(id);
  }
  return { popupIds, count: list.length };
}

// ── G8/G9: provider codes + category codes ─────────────────────────────
//
// list_row.game_provider is a comma-delimited STRING of provider codes:
//   "AG, AP, BNG, ... PP, PP2, PTI, ..."
// list_row.category is a comma-delimited string of short category codes:
//   "SL" | "LC" | "SP" | "SL, LC"
// The adapters previously looked only at detail.game_provider_codes, which is
// frequently absent — hence gameProviderCodes coming back empty.
export function splitCodeString(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))].sort();
  if (typeof raw !== 'string') return [];
  return [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))].sort();
}

// Gap-closure item 3: explicit provider-code fallback order — NOT a union.
//
// The old code unioned detail.game_provider_codes + target[] + the listing
// row's comma-delimited string. Live evidence (2026-08-10, QP2A
// WHALE_CRM_PROBE_DEP50PCT_500_12X) proved that union was quietly wrong:
// detail.game_provider_codes and target[].game_provider_codes were IDENTICAL
// (46 codes) — this promo's real, own restriction — but list_row.game_provider
// carried 6 MORE codes (GXW, PNG, PP, SBO, SPRIBE, YL — note PP/SBO are
// distinct codes from PP2/SBO2, not the same provider). The listing-row
// string is not a weaker copy of the same data; it reads as the SITE's
// broader provider availability, not this specific promo's scope. Unioning
// it in was silently widening every promo's provider restriction whenever
// detail/target already had the correct, narrower answer.
//
// Priority chain instead: detail.game_provider_codes (if non-empty) ->
// target[].game_provider_codes (if non-empty — QP2 only; observed always
// identical to detail.game_provider_codes when both are present) ->
// list_row.game_provider string (last resort — kept because QPRO's
// detail.game_provider_codes is frequently genuinely absent, confirmed
// live, and the listing string is the only signal left in that case).
// Provider codes are always compared directly (never through catalogue
// names), so this chain never needs the site-wide provider catalogue —
// that catalogue stays a separate, non-blocking drift/validation check
// (checkProviderCodesAgainstCatalogue in catalogues.js). Injecting it here
// as a code SOURCE would be a bug: an unrestricted promo (expected=[]) would
// then compare against every provider on the BO and look falsely restricted.
//
// Returns { codes, source } — source is 'detail' | 'target' | 'listing-row'
// | 'none', so "we resolved codes from X" is distinguishable from "there is
// no provider-scope evidence anywhere for this promo".
export function gameProviderCodesFromRow({ row = {}, detail = {} } = {}) {
  const detailCodes = Array.isArray(detail.game_provider_codes) ? detail.game_provider_codes.map(String) : [];
  if (detailCodes.length) return { codes: [...new Set(detailCodes)].sort(), source: 'detail' };

  const targetCodes = Array.isArray(detail.target)
    ? detail.target.flatMap((t) => (Array.isArray(t.game_provider_codes) ? t.game_provider_codes.map(String) : []))
    : [];
  if (targetCodes.length) return { codes: [...new Set(targetCodes)].sort(), source: 'target' };

  const rowCodes = splitCodeString(row.game_provider);
  if (rowCodes.length) return { codes: rowCodes, source: 'listing-row' };

  return { codes: [], source: 'none' };
}

// Short category code -> canonical category token.
//
// GATE 3 CORRECTION: this map previously contained FH/AR/LT/PK, which I had
// invented rather than verified. Only these three were backed by evidence at
// the time (an api-client comment enumerating
// `category: "SPORT"|"LIVE CASINO"|"SLOTS", code: "SP"|"LC"|"SL"`) plus their
// appearance in production listing rows.
//
// Collector item 2 (2026-08-10): CG, CK, FS and ES are now resolved live via
// catalogues.js against /api/bo/categories per site (CG=CRASH, CK=CRICKET,
// FS=FISHING, ES=E-SPORTS — confirmed on QPRO1/QPRO11/QP2 live). That is the
// PRIMARY resolution path now (see the `catalogue` option below). This
// static map remains only as the bootstrap/offline fallback for callers that
// have no live catalogue available (e.g. bundle-replay or unit tests) — kept
// deliberately small and unchanged so it never re-introduces a guess.
export const CATEGORY_SHORT_CODE_MAP = Object.freeze({
  SL: 'SLOTS',
  LC: 'LIVE_CASINO',
  SP: 'SPORTS',
});

// Returns { categories, unmapped, complete, catalogue }.
//   categories — canonical tokens, with unmapped codes passed through verbatim
//                so a restriction is never silently dropped
//   unmapped   — codes with no verified canonical mapping (live catalogue nor
//                static fallback)
//   complete   — true only when every code mapped to a known token
//   catalogue  — provenance of the live catalogue used, if any was supplied
//
// `catalogue` (from catalogues.js's getCategoryCatalogue) is tried FIRST —
// it is per-site authoritative and covers codes the static map never will.
// The static map is the fallback for codes the catalogue doesn't have
// (stale cache, or no catalogue passed at all), never the other way round.
export function categoriesFromShortCodesDetailed(raw, { catalogue = null } = {}) {
  const codes = splitCodeString(raw);
  const categories = [];
  const unmapped = [];
  for (const c of codes) {
    const up = c.toUpperCase();
    const mapped = resolveCategoryCode(catalogue, up) || CATEGORY_SHORT_CODE_MAP[up];
    if (mapped) categories.push(mapped);
    else { categories.push(up); unmapped.push(up); }
  }
  return {
    categories: [...new Set(categories)].sort(),
    unmapped: [...new Set(unmapped)].sort(),
    complete: unmapped.length === 0,
    catalogue: catalogue
      ? { source: catalogue.source, siteId: catalogue.siteId, fetchedAt: catalogue.fetchedAt, complete: catalogue.complete !== false }
      : null,
  };
}

// Backwards-compatible thin wrapper.
export function categoriesFromShortCodes(raw, opts) {
  return categoriesFromShortCodesDetailed(raw, opts).categories;
}

// ── G4: auto-reward flag ───────────────────────────────────────────────
//
// QP2  exposes list_row.auto_reward_activation (and sometimes detail.*).
// QPRO does NOT have that key anywhere — enumerated the full listing-row key
// set across 470 QPRO bundles to confirm. QPRO's equivalent is `auto_approve`
// (auto-approve the reward), which sits alongside auto_unlock on the row.
//
// Returns true/false when a source carries the flag, else null (→ the compare
// engine treats null as UNAVAILABLE, never as an implicit false).
//
// ITEM 3 PROOF (2026-08-10) — auto_approve IS the Auto Reward Activation
// setting for QPRO. Phase 2.5's "zero variance across 469 bundles" finding
// was a sampling artifact: that corpus is only OUR team's approved requests,
// a small slice of everything on the live BOs. Two independent pieces of
// live evidence now confirm the mapping:
//
// 1. Compiled frontend source (QPRO1's Angular production bundle,
//    main.f284229d038652acaabf.js, fetched read-only and unauthenticated —
//    it's a public static asset): the promotion edit form's "Eligibility
//    Setting" panel has a toggle with formControlName="auto_approve",
//    label "Auto Approve", tooltip "Auto approves promotion applied or
//    claimed from user portal by the user." The SAME field also drives a
//    listing-view checkmark/cross column with the identical "Auto Approve"
//    tooltip (`auto_approve > 0` → check, else cross). That tooltip text
//    IS the vendor's own description of auto-activating a claimed reward —
//    exactly what this codebase calls Auto Reward Activation.
// 2. Live read-only sweep of all 17 QPRO brands' active+inactive listings
//    (7,324 promotions total) found real variance: 522 rows with
//    auto_approve=0 across EVERY bonus type (Free Credit, Deposit-Reload,
//    Deposit-Welcome, Free Spin-Reload, Free Spin-Welcome), not the
//    constant-1 the narrower bundle corpus suggested.
//
// A live interactive-browser DOM read of the toggle's rendered ON/OFF state
// was NOT performed — it would require entering BO login credentials into a
// browser form, which is a prohibited action regardless of read-only intent.
// The evidence above (vendor-authored semantic description + confirmed
// real-world variance across every bonus type) is what establishes the
// mapping; `trustQproAutoApprove` defaults to true on that basis. Pass
// `trustQproAutoApprove: false` to fall back to the pre-proof conservative
// behavior (named field only) if a caller wants that stricter bar.
//
// QP2 is unaffected: it exposes a field literally named
// auto_reward_activation, which is self-identifying.
export function autoRewardFromRow({ row = {}, detail = {}, platform, trustQproAutoApprove = true } = {}) {
  const named = [row.auto_reward_activation, detail.auto_reward_activation];
  const qproProxy = [row.auto_approve, detail.auto_approve];
  const candidates = (platform === 'qpro' && !trustQproAutoApprove)
    ? named
    : [...named, ...qproProxy];
  for (const v of candidates) {
    if (v === undefined || v === null) continue;
    if (v === true || v === 1 || v === '1' || v === 'true') return true;
    if (v === false || v === 0 || v === '0' || v === 'false') return false;
  }
  return null;
}

// ── PROMOTION NAMES — separate from MT subjects, deliberately ───────────
//
// Authoritative source is /api/bo/promotionname, surfaced as
// detail.promotion_name_list = [{ locale: 'MY_EN', promotion_name, ... }].
// The api-client normalized record instead exposes promotion_name_en /
// promotion_name_zh_id, so both shapes are handled.
//
// This must NEVER be populated from a message-template subject. Observed on
// QPRO1/P026-r27 the two legitimately differ:
//   promotion name : "88% Slots Reload Bonus"
//   MT subject     : "Exclusive Reload Bonus — Claim Yours — 88% Bonus"
// Conflating them either fabricates a mismatch or hides a real promo-name
// defect behind an already-populated key.
export function promotionNamesFrom({ detail = {}, row = {} } = {}) {
  const byLocale = {};
  const byLanguage = {};
  const localesDeclared = [];

  const list = Array.isArray(detail.promotion_name_list) ? detail.promotion_name_list : [];
  for (const n of list) {
    if (!n || typeof n !== 'object') continue;
    const locale = typeof n.locale === 'string' ? n.locale.toUpperCase() : null;
    if (!locale) continue;
    const name = typeof n.promotion_name === 'string' ? n.promotion_name : null;
    if (!localesDeclared.includes(locale)) localesDeclared.push(locale);
    if (name == null) continue;
    byLocale[locale] = name;
    const lang = languageForLocaleKey(locale);
    // MY wins over SG for the same language — deterministic, MY is primary.
    if (lang && byLanguage[lang] == null) byLanguage[lang] = name;
    else if (lang && /^MY_/.test(locale)) byLanguage[lang] = name;
  }

  // Normalized-record fallback (qc-bundles path).
  if (typeof detail.promotion_name_en === 'string' && byLanguage.EN == null) {
    byLanguage.EN = detail.promotion_name_en;
  }
  if (typeof detail.promotion_name_zh_id === 'string' && byLanguage.ZH == null) {
    byLanguage.ZH = detail.promotion_name_zh_id;
  }
  // detail.locales is the normalized record's declared locale list.
  if (Array.isArray(detail.locales)) {
    for (const l of detail.locales) {
      const up = String(l || '').toUpperCase();
      if (up && !localesDeclared.includes(up)) localesDeclared.push(up);
    }
  }
  // Last resort: the plain row/detail name (no locale information).
  if (byLanguage.EN == null) {
    const plain = (typeof detail.name === 'string' && detail.name)
      || (typeof row.name === 'string' && row.name) || null;
    if (plain) byLanguage.EN = plain;
  }

  return { byLocale, byLanguage, localesDeclared: localesDeclared.sort() };
}

// ── currency list from the row (fallback when detail lacks it) ──────────
// list_row.currencies is "MYR, SGD" — useful as a cross-check that the
// per-currency rows we collected cover every currency the promo declares.
export function currencyCodesFromRow(row = {}) {
  return splitCodeString(row.currencies);
}

export { normalizeDecimal };
