// Increment 6/7 bug-fix (blocker 3, WS1 region scoping):
//
// Approved-request sources declare every currency the request targets across
// its brand fan-out. A single Free Spin request that covers MY + SG produces
// source.currencies = ['MYR', 'SGD']. The canary then fans out and saves
// that promo on WS1_MY (MYR only) and separately on WS1_SG (SGD only) — each
// site's live BO only carries its own currency.
//
// The expected-vs-live compare must reflect this: for WS1_MY, "expected
// currencies" is MYR, not MYR + SGD. Without this filter, every multi-region
// request generates a false FAIL for the currencies that live on the other
// brand's BO.
//
// This module owns the brand → allowed currencies mapping. Kept small and
// data-driven so future brands can be added without touching the adapter.

const IGMP_SITE_TO_CURRENCY = Object.freeze({
  'ws1-v3-my': 'MYR',
  'ws1-v3-sg': 'SGD',
  'ws1-v3-id': 'IDR',
  'ws1-v3-th': 'THB',
  'ws1-v3-kh': 'USD',
  'ws2': 'MYR',
});

// QP2 shares one BO (ibc22) across four merchants — the BO itself supports
// all four regional currencies, so we do NOT filter on the QP2 side.
const QP2_CURRENCIES = Object.freeze(['MYR', 'SGD', 'IDR', 'THB']);

// QPRO region support is tiered:
//   QPRO1/2/3 — full MY + SG support (MYR, SGD)
//   QPRO4..QPRO17 — MY only (noSgRegion flag in data/qc-dashboard-brands.json,
//                             matches compare-engine.js's QPRO_NO_SG set)
const QPRO_FULL_REGION = Object.freeze(['MYR', 'SGD']);
const QPRO_MY_ONLY = Object.freeze(['MYR']);

// Returns the allowed currencies for a (brand, platform, siteId) triple.
// Returns null when the mapping is unknown — callers must treat null as
// "don't filter" so unknown brands don't accidentally start dropping data.
export function allowedCurrenciesForBrand({ brand, platform, siteId } = {}) {
  if (!brand) return null;
  const b = String(brand).toUpperCase();
  const p = String(platform || '').toLowerCase();
  if (p === 'igmp') {
    const cur = IGMP_SITE_TO_CURRENCY[siteId];
    return cur ? [cur] : null;
  }
  if (p === 'qp2') return [...QP2_CURRENCIES];
  if (p === 'qpro') {
    const m = b.match(/^QPRO(\d+)$/);
    if (!m) return null;
    const n = Number(m[1]);
    return n <= 3 ? [...QPRO_FULL_REGION] : [...QPRO_MY_ONLY];
  }
  return null;
}
