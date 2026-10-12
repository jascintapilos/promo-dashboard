// Collector item 2: authoritative category/provider catalogues, sourced
// live from the BO itself — never invented abbreviations.
//
// getAllCategories(site) / getAllGameProviders(site) already exist in
// api-client.js. Live read-only probe (2026-08-10) confirmed the shape on
// QPRO1, QPRO11 and QP2/ibc22:
//   /api/bo/categories   -> { id, code, name, type, position }
//   /api/bo/gameprovider -> { id, code, name, categories:[{code,category}], ... }
// The core game-type code vocabulary (SL/LC/SP/ES/FS/LT/PK/CF/CG/TB/AR/CK) is
// shared across every site probed, but each site can also carry its OWN
// admin/meta categories the others don't (QPRO1 has VIP/EVENT/LOTTERY2;
// QPRO11 has Test/APPS instead) — confirming the existing api-client.js
// comment that per-brand rows drift. This module therefore always resolves
// PER SITE from a live fetch, never from one hardcoded global map.
//
// A fetch failure returns complete:false with an empty map (never throws,
// never invents a substitute) so callers can fall back to whatever
// per-promotion evidence they already collected, with the gap visible.

import { getAllCategories, getAllGameProviders } from '../../api-client.js';
import { withBoundedRetry } from '../readonly-client.js';

// "Briefly" per the brief: long enough to cover one acceptance batch across
// all 27 brands (each brand's fetch takes well under a second serialized),
// short enough that a same-day BO-side category/provider addition is picked
// up on the next run rather than frozen indefinitely.
const DEFAULT_TTL_MS = 5 * 60 * 1000;

const categoryCacheBySite = new Map();
const providerCacheBySite = new Map();

function isFresh(entry, ttlMs, now) {
  return Boolean(entry) && (now - entry.fetchedAtMs) < ttlMs;
}

// BO catalogue names don't always match this codebase's pre-existing
// canonical vocabulary verbatim (e.g. code SP's live `name` is "SPORT"
// singular, but the earlier hand-verified static map already established
// "SPORTS" plural as the canonical token for that same code). This performs
// ONLY a lossless format normalization (case + whitespace/hyphen -> `_`)
// plus that one confirmed reconciliation — it never guesses a code's
// meaning, since the name itself always comes straight from the BO.
function canonicalizeCatalogueName(name) {
  if (!name) return null;
  const upper = String(name).trim().toUpperCase();
  if (!upper) return null;
  if (upper === 'SPORT') return 'SPORTS';
  return upper.replace(/[\s-]+/g, '_');
}

function byCodeMap(rows) {
  const byCode = {};
  for (const r of (rows || [])) {
    if (r?.code == null) continue;
    byCode[String(r.code).toUpperCase()] = r.name ?? null;
  }
  return byCode;
}

export async function getCategoryCatalogue(site, { ttlMs = DEFAULT_TTL_MS, now = Date.now(), force = false, retry, fetchImpl } = {}) {
  const cached = categoryCacheBySite.get(site.id);
  if (!force && isFresh(cached, ttlMs, now)) return cached.catalogue;
  try {
    const rows = await withBoundedRetry(() => (fetchImpl || getAllCategories)(site), retry);
    const catalogue = {
      siteId: site.id,
      source: 'api:/api/bo/categories',
      fetchedAt: new Date(now).toISOString(),
      complete: true,
      byCode: byCodeMap(rows),
      raw: rows,
    };
    categoryCacheBySite.set(site.id, { catalogue, fetchedAtMs: now });
    return catalogue;
  } catch (e) {
    // Not cached — a transient failure must not freeze a permanent "this
    // site has no categories" state into later calls within the TTL window.
    return {
      siteId: site.id,
      source: 'api:/api/bo/categories',
      fetchedAt: new Date(now).toISOString(),
      complete: false,
      byCode: {},
      raw: [],
      error: e?.message || String(e),
    };
  }
}

export async function getProviderCatalogue(site, { ttlMs = DEFAULT_TTL_MS, now = Date.now(), force = false, retry, siteFilterId = null, fetchImpl } = {}) {
  const cacheKey = `${site.id}:${siteFilterId ?? ''}`;
  const cached = providerCacheBySite.get(cacheKey);
  if (!force && isFresh(cached, ttlMs, now)) return cached.catalogue;
  try {
    const { rows } = await (fetchImpl
      ? withBoundedRetry(() => fetchImpl(site, { siteId: siteFilterId }), retry)
      : withBoundedRetry(() => getAllGameProviders(site, { siteId: siteFilterId }), retry));
    const catalogue = {
      siteId: site.id,
      source: 'api:/api/bo/gameprovider',
      fetchedAt: new Date(now).toISOString(),
      complete: true,
      byCode: byCodeMap(rows),
      raw: rows,
    };
    providerCacheBySite.set(cacheKey, { catalogue, fetchedAtMs: now });
    return catalogue;
  } catch (e) {
    return {
      siteId: site.id,
      source: 'api:/api/bo/gameprovider',
      fetchedAt: new Date(now).toISOString(),
      complete: false,
      byCode: {},
      raw: [],
      error: e?.message || String(e),
    };
  }
}

// Resolve a single category code against a catalogue, applying the same
// lossless canonicalization the compare engine's existing vocabulary uses.
// Returns null (never a guess) when the catalogue doesn't cover this code.
export function resolveCategoryCode(catalogue, code) {
  if (!catalogue?.byCode || !code) return null;
  const name = catalogue.byCode[String(code).toUpperCase()];
  return name ? canonicalizeCatalogueName(name) : null;
}

// Cross-check a promotion's provider codes against the site's authoritative
// provider catalogue. This is a completeness/drift signal, not a pass/fail
// comparison — the compare engine still diffs the code SETS between
// expected and live directly; this only tells the caller whether every code
// on the live side is a code the BO's own catalogue recognises right now.
export function checkProviderCodesAgainstCatalogue(catalogue, codes) {
  const list = Array.isArray(codes) ? codes : [];
  if (!catalogue || catalogue.complete === false) {
    return { checked: false, unknownCodes: [], catalogueComplete: false, source: catalogue?.source || null };
  }
  const known = new Set(Object.keys(catalogue.byCode || {}));
  const unknownCodes = [...new Set(list.map((c) => String(c).toUpperCase()))].filter((c) => !known.has(c)).sort();
  return { checked: true, unknownCodes, catalogueComplete: true, source: catalogue.source };
}

export function resetCatalogueCache() {
  categoryCacheBySite.clear();
  providerCacheBySite.clear();
}

export { canonicalizeCatalogueName };
