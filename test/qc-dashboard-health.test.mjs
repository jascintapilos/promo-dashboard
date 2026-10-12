// Item 6 tests — per-brand health states (connectivity + evidence-catalogue
// completeness). All BO/network access is dependency-injected.

import test from 'node:test';
import assert from 'node:assert/strict';
import { getBrandHealth, getAllBrandsHealth } from '../src/qc-dashboard/health.js';

function stubDeps(overrides = {}) {
  return {
    preflightBrand: async () => ({ status: 'READY', checks: [{ name: 'bo-reachable', ok: true }] }),
    resolveBrandRuntime: () => ({ platform: 'qpro', siteId: 'qpro1' }),
    getSite: (siteId) => ({ id: siteId }),
    getCategoryCatalogue: async () => ({ complete: true, source: 'api:/api/bo/categories', byCode: { SL: 'SLOTS' } }),
    getProviderCatalogue: async () => ({ complete: true, source: 'api:/api/bo/gameprovider', byCode: { AP: 'AdvantPlay' } }),
    getPopupCatalogue: async () => ({ complete: true, source: 'api:/api/bo/popups', total: 701, pages: 2 }),
    ...overrides,
  };
}

test('getBrandHealth reports READY with full evidence completeness when everything succeeds', async () => {
  const health = await getBrandHealth('QPRO1', { deps: stubDeps() });
  assert.equal(health.connectivity, 'READY');
  assert.equal(health.overall, 'READY');
  assert.equal(health.transport, 'api');
  assert.equal(health.browserFallbackAvailable, false);
  assert.equal(health.evidence.categories.complete, true);
  assert.equal(health.evidence.providers.complete, true);
  assert.equal(health.evidence.popups.total, 701);
});

test('Gap-closure item 3: a provider-catalogue-only failure (e.g. a live HTTP 500) stays overall:READY, not PARTIAL_DATA', async () => {
  const health = await getBrandHealth('QP2A', {
    deps: stubDeps({
      getProviderCatalogue: async () => ({ complete: false, source: 'api:/api/bo/gameprovider', error: 'HTTP 500 https://54505721qp2api.960806.com/api/bo/gameprovider\n  Something is wrong. Please contact system admin. (I22-3955d076)' }),
    }),
  });
  assert.equal(health.overall, 'READY', 'provider codes are resolved directly from promotion detail — the catalogue is a non-blocking drift check only');
  assert.equal(health.evidence.providers.complete, false);
  assert.match(health.evidence.providers.error, /HTTP 500/, 'the upstream error must stay visible in evidence even though it does not downgrade overall');
  assert.deepEqual(health.degraded, [{
    check: 'providers', loadBearing: false,
    reason: 'providers catalogue unavailable — drift/validation check disabled only; provider-code comparisons are unaffected (resolved directly from promotion detail, not this catalogue)',
    error: health.evidence.providers.error,
  }]);
});

test('Gap-closure item 3: a categories or popups catalogue failure IS load-bearing and still downgrades overall to PARTIAL_DATA', async () => {
  const catFail = await getBrandHealth('QPRO1', {
    deps: stubDeps({ getCategoryCatalogue: async () => ({ complete: false, source: 'api:/api/bo/categories', error: 'boom' }) }),
  });
  assert.equal(catFail.overall, 'PARTIAL_DATA');
  assert.equal(catFail.degraded[0].check, 'categories');
  assert.equal(catFail.degraded[0].loadBearing, true);

  const popFail = await getBrandHealth('QPRO1', {
    deps: stubDeps({ getPopupCatalogue: async () => ({ complete: false, source: 'api:/api/bo/popups', error: 'boom' }) }),
  });
  assert.equal(popFail.overall, 'PARTIAL_DATA');
  assert.equal(popFail.degraded[0].check, 'popups');
});

test('Gap-closure item 3: when everything succeeds, degraded is empty', async () => {
  const health = await getBrandHealth('QPRO1', { deps: stubDeps() });
  assert.deepEqual(health.degraded, []);
});

test('Item 7: getBrandHealth bypasses the MVP rollout gate — a non-MVP brand still gets a real connectivity probe', async () => {
  let calledWith = null;
  const health = await getBrandHealth('QPRO9', {
    deps: stubDeps({
      preflightBrand: async (brandId, opts) => { calledWith = opts; return { status: 'READY', mvpEnabled: false, checks: [] }; },
    }),
  });
  assert.equal(calledWith.bypassMvpGate, true, 'health checks must never be silently skipped by the dashboard rollout stage');
  assert.equal(health.mvpEnabled, false, 'the rollout-stage fact is still surfaced, just not used to block the probe');
  assert.equal(health.overall, 'READY');
});

test('getBrandHealth short-circuits at connectivity — never claims evidence completeness for an unreachable brand', async () => {
  const health = await getBrandHealth('QPRO1', {
    deps: stubDeps({ preflightBrand: async () => ({ status: 'BO_UNREACHABLE', checks: [{ name: 'bo-reachable', ok: false, detail: 'timeout' }] }) }),
  });
  assert.equal(health.connectivity, 'BO_UNREACHABLE');
  assert.equal(health.overall, 'BO_UNREACHABLE');
  assert.equal(health.evidence, null, 'no catalogue call should even be attempted for an unreachable brand');
});

test('getBrandHealth reports PARTIAL_DATA when connectivity is READY but one catalogue endpoint fails', async () => {
  const health = await getBrandHealth('QPRO1', {
    deps: stubDeps({ getPopupCatalogue: async () => ({ complete: false, source: 'api:/api/bo/popups', error: 'transient timeout' }) }),
  });
  assert.equal(health.connectivity, 'READY');
  assert.equal(health.overall, 'PARTIAL_DATA', 'a reachable brand with a genuinely failed catalogue call must not report fully READY');
  assert.equal(health.evidence.categories.complete, true);
  assert.equal(health.evidence.popups.complete, false);
  assert.equal(health.evidence.popups.error, 'transient timeout');
});

test('getBrandHealth treats IGMP as not-applicable for catalogue completeness, not a gap', async () => {
  const health = await getBrandHealth('WS1_MY', {
    deps: stubDeps({ resolveBrandRuntime: () => ({ platform: 'igmp', siteId: 'ws1-v3-my' }) }),
  });
  assert.equal(health.overall, 'READY');
  assert.equal(health.evidence.applicable, false);
});

test('getBrandHealth reports CONFIG_MISSING when runtime resolution throws, without crashing', async () => {
  const health = await getBrandHealth('UNKNOWN_BRAND', {
    deps: stubDeps({ resolveBrandRuntime: () => { throw new Error('brand not in qc-dashboard-brands.json'); } }),
  });
  assert.equal(health.overall, 'CONFIG_MISSING');
  assert.match(health.error, /not in qc-dashboard-brands/);
});

test('getAllBrandsHealth sweeps every configured brand and reports per-brand results', async () => {
  const brandConfig = [{ id: 'QPRO1' }, { id: 'QP2A' }];
  const seen = [];
  const results = await getAllBrandsHealth({
    brandConfig, delayMs: 0, onBrand: (h) => seen.push(h.brand),
    deps: stubDeps(),
  });
  assert.deepEqual(Object.keys(results).sort(), ['QP2A', 'QPRO1']);
  assert.deepEqual(seen.sort(), ['QP2A', 'QPRO1']);
  assert.equal(results.QPRO1.overall, 'READY');
});
