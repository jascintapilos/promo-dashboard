// Item 6 (orchestrator): per-brand health states.
//
// Combines two things that were previously separate and never surfaced
// together:
//   1. Raw BO connectivity (preflight.js — READY/NOT_ENABLED/CONFIG_MISSING/
//      AUTH_EXPIRED/BO_UNREACHABLE). Already exists, unchanged.
//   2. Evidence-catalogue completeness (catalogues.js / dialog-bodies.js from
//      items 2 + 4) — a brand can be perfectly REACHABLE while its category,
//      provider or popup catalogue endpoint independently fails. Preflight
//      alone would call that brand READY and miss it.
//
// Connectivity ordering (item 6 "API -> session-refresh/retry -> browser
// fallback"): every catalogue/promo fetch already goes through
// readonly-client.js's withBoundedRetry (item 1), which itself sits on top
// of api-client.js's authedFetch (one-shot session refresh on 401/419) —
// that ordering is already composed correctly by calling those functions;
// nothing here re-implements it. `browserFallbackAvailable` stays false
// because item 1's diagnosis found no genuine WAF/network block once the
// stale test override was cleared — QP2A-D all fetch cleanly through the
// plain API. It is surfaced explicitly so a FUTURE real block on any brand
// is a visible, actionable gap rather than a silent one.
//
// Read-only throughout; never throws — a broken brand reports its own
// degraded state rather than aborting the whole health sweep (mirrors R14's
// graceful-degrade precedent for sites.js).

import { preflightBrand } from './preflight.js';
import { resolveBrandRuntime, loadQcBrandConfig } from './brand-config.js';
import { getSite } from '../sites.js';
import { getCategoryCatalogue, getProviderCatalogue } from './canonical/catalogues.js';
import { getPopupCatalogue } from './canonical/dialog-bodies.js';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export async function getBrandHealth(brandId, { brandConfig = null, skipCache = false, deps = {} } = {}) {
  const _preflightBrand = deps.preflightBrand || preflightBrand;
  const _resolveBrandRuntime = deps.resolveBrandRuntime || resolveBrandRuntime;
  const _getSite = deps.getSite || getSite;
  const _getCategoryCatalogue = deps.getCategoryCatalogue || getCategoryCatalogue;
  const _getProviderCatalogue = deps.getProviderCatalogue || getProviderCatalogue;
  const _getPopupCatalogue = deps.getPopupCatalogue || getPopupCatalogue;

  // bypassMvpGate: true — health/evidence-completeness is a technical fact
  // about the BO, independent of whether this brand has been rolled out for
  // automatic dashboard comparisons yet (that's a separate, deliberate
  // staging decision from Real-QC Increment 8). mvpEnabled is still
  // reported on the result so callers can see both facts.
  const preflight = await _preflightBrand(brandId, { brandConfig, skipCache, bypassMvpGate: true });
  const base = {
    brand: brandId,
    connectivity: preflight.status,
    connectivityChecks: preflight.checks,
    mvpEnabled: preflight.mvpEnabled,
    transport: 'api',
    browserFallbackAvailable: false,
    checkedAt: new Date().toISOString(),
  };

  if (preflight.status !== 'READY') {
    // A genuine outage/config gap — never claim evidence completeness for a
    // brand we couldn't even reach. Distinct from a catalogue-specific
    // failure below, which implies the BO itself IS reachable.
    return { ...base, overall: preflight.status, evidence: null, degraded: [] };
  }

  let runtime;
  try {
    runtime = _resolveBrandRuntime(brandId);
  } catch (e) {
    return { ...base, overall: 'CONFIG_MISSING', evidence: null, error: e?.publicMessage || e?.message || String(e), degraded: [] };
  }

  if (runtime.platform === 'igmp') {
    // IGMP has no category/provider/popup catalogue concept (its scope and
    // dialog fields come from a different API shape entirely) — nothing to
    // check here, not a gap.
    return { ...base, overall: 'READY', evidence: { applicable: false, reason: 'IGMP has no category/provider/popup catalogue concept' }, degraded: [] };
  }

  const site = _getSite(runtime.siteId);
  const [cats, provs, pops] = await Promise.all([
    _getCategoryCatalogue(site, { force: skipCache }),
    _getProviderCatalogue(site, { force: skipCache }),
    _getPopupCatalogue(site, { force: skipCache }),
  ]);
  const evidence = {
    categories: { complete: cats.complete, source: cats.source, count: Object.keys(cats.byCode || {}).length, error: cats.error || null },
    providers: { complete: provs.complete, source: provs.source, count: Object.keys(provs.byCode || {}).length, error: provs.error || null },
    popups: { complete: pops.complete, source: pops.source, total: pops.total ?? null, pages: pops.pages ?? null, error: pops.error || null },
  };
  // Gap-closure item 3: the provider catalogue is a non-blocking drift/
  // validation check only (checkProviderCodesAgainstCatalogue) — a promo's
  // OWN provider-code scope is always resolved directly from
  // detail.game_provider_codes / target[] / the listing row
  // (gameProviderCodesFromRow in listing-row-fields.js), never from this
  // catalogue. So a provider-catalogue failure does not, on its own, mean
  // promo comparisons for this brand are degraded — categories and popups
  // ARE load-bearing (an incomplete category catalogue can leave a code
  // genuinely unresolved; an incomplete popup catalogue can leave a dialog
  // body genuinely unresolved). `overall` reflects load-bearing completeness
  // only; every incomplete check — load-bearing or not — is still fully
  // visible in `degraded` and in evidence.*.error, so a real upstream outage
  // (e.g. a live HTTP 500 on /api/bo/gameprovider) is never hidden, it just
  // no longer inflates the brand's status past what it actually means.
  const checks = [
    { key: 'categories', result: cats, loadBearing: true },
    { key: 'providers', result: provs, loadBearing: false },
    { key: 'popups', result: pops, loadBearing: true },
  ];
  const degraded = checks.filter((c) => !c.result.complete).map((c) => ({
    check: c.key,
    loadBearing: c.loadBearing,
    reason: c.loadBearing
      ? `${c.key} catalogue unavailable — code/dialog resolution for this brand may be incomplete`
      : `${c.key} catalogue unavailable — drift/validation check disabled only; provider-code comparisons are unaffected (resolved directly from promotion detail, not this catalogue)`,
    error: c.result.error || null,
  }));
  const overall = checks.filter((c) => c.loadBearing).every((c) => c.result.complete) ? 'READY' : 'PARTIAL_DATA';
  return { ...base, overall, evidence, degraded };
}

// Serialized, not Promise.all'd across brands — matches the standing rate-
// limiting rule (serialize per-BO requests, never a 27-brand burst). A small
// inter-brand delay spreads the 3 catalogue calls each READY brand makes.
export async function getAllBrandsHealth({ brandConfig = null, skipCache = false, delayMs = 150, onBrand = null, deps = {} } = {}) {
  const cfg = brandConfig || loadQcBrandConfig();
  const results = {};
  for (const brand of cfg) {
    const health = await getBrandHealth(brand.id, { brandConfig: cfg, skipCache, deps });
    results[brand.id] = health;
    if (onBrand) { try { onBrand(health); } catch { /* observability only */ } }
    if (delayMs > 0) await sleep(delayMs);
  }
  return results;
}
