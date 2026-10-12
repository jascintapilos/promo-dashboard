// Locale coverage matrix — correctness gate #2.
//
// "EN + ZH found" is not completeness. A brand serving Indonesia requires ID
// content; a Thai site requires TH; Cambodia requires KM. Conversely, a
// MY-only brand must NOT be penalised for lacking TH.
//
// This module answers, per brand:
//   required   — which locales that brand's regions oblige
//   collected  — which locales we actually got content for
//   missing    — required minus collected  (→ detectable automatically)
//   extra      — collected beyond required (informational, not a failure)
//
// Region → locale mapping mirrors src/ingest.js REGION_TO_CURRENCY_LOCALES so
// the expected and live sides agree on vocabulary. Kept as its own module
// (rather than importing ingest.js) because ingest pulls in googleapis and the
// collector must stay dependency-light.

// Region → the locale keys a promo must carry for that region.
export const REGION_LOCALES = Object.freeze({
  MY: ['MY_EN', 'MY_ZH'],
  SG: ['SG_EN', 'SG_ZH'],
  ID: ['ID_EN', 'ID_ID'],
  TH: ['TH_EN', 'TH_TH'],
  KH: ['KH_EN', 'KH_KM'],
});

// Brand → regions it serves. QP2 merchants share one BO that carries all
// four regional currencies; QPRO is tiered (1-3 keep SG, 4-17 are MY-only);
// each WS1 site is single-region.
export const BRAND_REGIONS = Object.freeze({
  // QP2 — shared ibc22 BO
  QP2A: ['MY', 'SG', 'ID', 'TH'],
  QP2B: ['MY', 'SG', 'ID', 'TH'],
  QP2C: ['MY', 'SG', 'ID', 'TH'],
  QP2D: ['MY', 'SG', 'ID', 'TH'],
  // QPRO — 1..3 support SG, 4..17 are MY-only
  QPRO1: ['MY', 'SG'], QPRO2: ['MY', 'SG'], QPRO3: ['MY', 'SG'],
  // IGMP — one region per site
  WS1_MY: ['MY'], WS1_SG: ['SG'], WS1_ID: ['ID'], WS1_TH: ['TH'], WS1_KH: ['KH'],
  WS2: ['MY'],
});

export function regionsForBrand(brand) {
  if (!brand) return [];
  const b = String(brand).toUpperCase();
  if (BRAND_REGIONS[b]) return [...BRAND_REGIONS[b]];
  // QPRO4..QPRO17 default to MY-only (matches allowedCurrenciesForBrand and
  // the noSgRegion rule in data/qc-dashboard-brands.json).
  if (/^QPRO(\d+)$/.test(b)) {
    const n = Number(b.match(/^QPRO(\d+)$/)[1]);
    return n <= 3 ? ['MY', 'SG'] : ['MY'];
  }
  return [];
}

// Currency → region. A promo's ACTUAL market footprint is defined by the
// currencies it carries, not by everything its brand could theoretically
// serve. A MY/SG-only promo (MYR + SGD) must NOT be required to localize
// ID/TH just because its shared BO also hosts Indonesian and Thai currencies.
// Verified live 2026-08-11: QP2A WHALE_CRM_PROBE_DEP50PCT_500_12X carries
// exactly MYR + SGD and is localized exactly MY_EN/MY_ZH/SG_EN/SG_ZH —
// internally consistent, not a gap; QPRO2 TEST_RET_CRM_REL_5FS_... carries
// MYR only and is MY-localized only. Requiring the brand's full region set
// there was a false MANUAL_REQUIRED. (The "promo missing a whole market's
// currency" case is a DIFFERENT defect, owned by the currency comparison in
// compare-engine.js ruleCurrencies — narrowing this gate never hides it.)
export const CURRENCY_TO_REGION = Object.freeze({
  MYR: 'MY', SGD: 'SG', IDR: 'ID', THB: 'TH', KHR: 'KH',
});

// Regions a promo actually serves, derived from the currencies on its
// canonical. Empty when nothing maps (e.g. a KH site priced in USD) — callers
// treat that as "no currency signal" and fall back to brand scope so the gate
// is never silently dropped.
export function regionsFromCanonicalCurrencies(canonical) {
  const out = [];
  const list = Array.isArray(canonical?.currencies) ? canonical.currencies : [];
  for (const cur of list) {
    const region = CURRENCY_TO_REGION[String(cur?.code || '').toUpperCase()];
    if (region && !out.includes(region)) out.push(region);
  }
  return out;
}

// The regions THIS promo must localize for. The brand mapping is the authority
// on whether a brand has ANY locale obligation at all: an unmapped brand
// fabricates no requirement (returns []), exactly as before. Within a mapped
// brand, the promo's own currency footprint NARROWS the requirement to the
// markets it actually serves — never widening beyond the brand's regions, and
// falling back to the full brand scope when the promo carries no mappable
// currency (over-check, never under-check).
export function requiredRegionsForCanonical(canonical, brand) {
  const brandRegions = regionsForBrand(brand);
  if (brandRegions.length === 0) return [];
  const promoRegions = regionsFromCanonicalCurrencies(canonical);
  if (promoRegions.length === 0) return brandRegions;
  const capped = promoRegions.filter((r) => brandRegions.includes(r));
  return capped.length ? capped : brandRegions;
}

// Locales required for an explicit set of regions.
export function requiredLocalesForRegions(regions) {
  const out = [];
  for (const r of (regions || [])) {
    for (const l of (REGION_LOCALES[r] || [])) if (!out.includes(l)) out.push(l);
  }
  return out.sort();
}

// Languages required for an explicit set of regions (locale keys collapsed).
export function requiredLanguagesForRegions(regions) {
  const langs = new Set();
  for (const l of requiredLocalesForRegions(regions)) {
    const m = l.match(/_([A-Z]{2})$/);
    if (m) langs.add(m[1] === 'IN' ? 'ID' : m[1]);
  }
  return [...langs].sort();
}

// Locales a brand is REQUIRED to localize for (its maximal region set). Kept
// for callers that genuinely want the brand-wide obligation; the per-promo
// gate uses requiredRegionsForCanonical to narrow to the promo's real scope.
export function requiredLocalesForBrand(brand) {
  return requiredLocalesForRegions(regionsForBrand(brand));
}

// Languages a brand requires (locale keys collapsed).
export function requiredLanguagesForBrand(brand) {
  return requiredLanguagesForRegions(regionsForBrand(brand));
}

// ── Coverage evaluation ────────────────────────────────────────────────
//
// `kind` names which content surface is being measured so a report can say
// "promotion name missing ID_ID" separately from "MT body missing ID_ID".
//
// Returns { kind, brand, required, collected, missing, extra, complete }.
// A brand with no region mapping yields required: [] and complete: true —
// we never invent a requirement we cannot justify.
export function evaluateLocaleCoverage({ brand, collectedLocales = [], kind = 'content', regions = null } = {}) {
  const required = regions ? requiredLocalesForRegions(regions) : requiredLocalesForBrand(brand);
  const collected = [...new Set(collectedLocales.map((l) => String(l || '').toUpperCase()).filter(Boolean))].sort();
  const missing = required.filter((l) => !collected.includes(l));
  const extra = collected.filter((l) => !required.includes(l));
  return { kind, brand: brand || null, required, collected, missing, extra, complete: missing.length === 0 };
}

// Language-level variant. Useful because several BOs store one body per
// LANGUAGE rather than per region-locale — requiring MY_EN and SG_EN
// separately would raise false gaps there.
export function evaluateLanguageCoverage({ brand, collectedLanguages = [], kind = 'content', regions = null } = {}) {
  const required = regions ? requiredLanguagesForRegions(regions) : requiredLanguagesForBrand(brand);
  const collected = [...new Set(collectedLanguages.map((l) => String(l || '').toUpperCase()).filter(Boolean))].sort();
  const missing = required.filter((l) => !collected.includes(l));
  const extra = collected.filter((l) => !required.includes(l));
  return { kind, brand: brand || null, required, collected, missing, extra, complete: missing.length === 0 };
}

// Evaluate every content surface on a canonical record at once.
// Promotion names are checked per LOCALE (the BO stores one row per locale);
// MT and dialog bodies are checked per LANGUAGE, which is how those BOs
// actually key them.
export function evaluateCanonicalLocaleCoverage(canonical, { brand } = {}) {
  const c = canonical || {};
  const content = c.content || {};
  const b = brand || c.identity?.brand || null;
  // Per-promo scope: localization is required only for the regions this promo
  // actually serves (its currency footprint), not every region the brand
  // could serve. `regions` is passed to every sub-evaluation below so name,
  // subject, MT-body and dialog completeness all agree on the same scope.
  const regions = requiredRegionsForCanonical(c, b);
  const mtSubjectLocales = Object.keys(content.messageTemplate?.subjectByLocale || {});
  const mtBodyLocales = Object.keys(content.messageTemplate?.bodyByLocale || {});
  return {
    brand: b,
    regions,
    promotionName: evaluateLocaleCoverage({
      brand: b, regions, kind: 'promotionName',
      collectedLocales: Object.keys(content.promotionNamesByLocale || {}),
    }),
    promotionNameLanguages: evaluateLanguageCoverage({
      brand: b, regions, kind: 'promotionNameLanguages',
      collectedLanguages: Object.keys(content.names || {}),
    }),
    messageTemplateSubject: evaluateLocaleCoverage({
      brand: b, regions, kind: 'messageTemplateSubject', collectedLocales: mtSubjectLocales,
    }),
    messageTemplateBody: evaluateLocaleCoverage({
      brand: b, regions, kind: 'messageTemplateBody', collectedLocales: mtBodyLocales,
    }),
    mtBodyLanguages: evaluateLanguageCoverage({
      brand: b, regions, kind: 'mtBodyLanguages', collectedLanguages: Object.keys(content.mtBody || {}),
    }),
    dialogBodyLanguages: evaluateLanguageCoverage({
      brand: b, regions, kind: 'dialogBodyLanguages', collectedLanguages: Object.keys(content.dialogBody || {}),
    }),
    localesDeclaredByBo: [...(content.localesDeclared || [])],
  };
}
