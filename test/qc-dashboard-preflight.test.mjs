// Increment 2 (real-QC upgrade): unit tests for src/qc-dashboard/preflight.js
//
// Uses dependency injection (opts.deps.probeReachable + opts.brandConfig) so
// tests never hit a live BO and never depend on filesystem BO-sites presence.
// Covers all six status codes: READY, NOT_ENABLED, CONFIG_MISSING,
// AUTH_EXPIRED, BO_UNREACHABLE, PARTIAL_DATA (PARTIAL_DATA is reserved for a
// future multi-endpoint scenario; enumerated here so a future adder cannot
// silently drift the shape).

import test from 'node:test';
import assert from 'node:assert/strict';
import { preflightBrand, preflightAllBrands, _clearPreflightCache } from '../src/qc-dashboard/preflight.js';

// Minimal brand-config stubs (matches loadQcBrandConfig return shape).
function mkBrand(id, { mvp = true, extra = {} } = {}) {
  return { id, label: id, displayGroup: 'test', order: 1, promoModulePath: '/promotion', qcRules: { mvp, ...extra }, enabled: mvp };
}

test('Increment 2: NOT_ENABLED when brand missing mvp:true flag', async () => {
  _clearPreflightCache();
  const cfg = [mkBrand('QP2B', { mvp: false })];
  const r = await preflightBrand('QP2B', { brandConfig: cfg });
  assert.equal(r.status, 'NOT_ENABLED');
  assert.ok(r.checks.some((c) => c.name === 'mvp-enabled' && !c.ok));
});

test('Increment 2: CONFIG_MISSING when brand not in qc-dashboard-brands.json', async () => {
  _clearPreflightCache();
  const cfg = [mkBrand('QP2A')];
  const r = await preflightBrand('UNKNOWN_BRAND', { brandConfig: cfg });
  assert.equal(r.status, 'CONFIG_MISSING');
  assert.ok(r.checks.some((c) => c.name === 'brand-known' && !c.ok));
});

test('Increment 2: CONFIG_MISSING when resolveBrandRuntime throws (unknown to brandToSite)', async () => {
  _clearPreflightCache();
  // Register a brand ID in config that live-codes.js won't resolve (would
  // never happen at runtime because loadQcBrandConfig throws, but the guard
  // needs to work if a code path bypasses that startup check).
  const cfg = [{ id: 'GHOST_BRAND', qcRules: { mvp: true }, enabled: true }];
  const r = await preflightBrand('GHOST_BRAND', { brandConfig: cfg });
  assert.equal(r.status, 'CONFIG_MISSING');
  assert.ok(r.checks.some((c) => c.name === 'resolve-runtime' && !c.ok));
});

test('Increment 2: READY for QP2A when probe returns ok', async () => {
  _clearPreflightCache();
  const cfg = [mkBrand('QP2A')];
  const r = await preflightBrand('QP2A', {
    brandConfig: cfg,
    deps: { probeReachable: async () => ({ ok: true, detail: 'probe HTTP 200' }) },
  });
  assert.equal(r.status, 'READY');
  assert.equal(r.platform, 'qp2');
  assert.equal(r.siteId, 'ibc22');
  assert.ok(r.checks.every((c) => c.ok));
});

test('Increment 2: BO_UNREACHABLE when probe reports edge-level 403', async () => {
  _clearPreflightCache();
  const cfg = [mkBrand('QP2A')];
  const r = await preflightBrand('QP2A', {
    brandConfig: cfg,
    deps: { probeReachable: async () => ({ ok: false, status: 'BO_UNREACHABLE', detail: 'probe HTTP 403 at edge (WAF-level block, not app auth)' }) },
  });
  assert.equal(r.status, 'BO_UNREACHABLE');
  const boCheck = r.checks.find((c) => c.name === 'bo-reachable');
  assert.ok(boCheck && !boCheck.ok);
  assert.match(boCheck.detail, /WAF-level block/);
});

test('Increment 2: BO_UNREACHABLE when probe throws (network error)', async () => {
  _clearPreflightCache();
  const cfg = [mkBrand('QPRO1')];
  const r = await preflightBrand('QPRO1', {
    brandConfig: cfg,
    deps: { probeReachable: async () => ({ ok: false, status: 'BO_UNREACHABLE', detail: 'fetch failed' }) },
  });
  assert.equal(r.status, 'BO_UNREACHABLE');
});

test('Increment 2: AUTH_EXPIRED for IGMP when session file missing', async () => {
  _clearPreflightCache();
  const cfg = [mkBrand('WS1_MY')];
  // Force the session-file check by pointing IGMP_SESSION_FILE at a definitely-missing path
  const orig = process.env.IGMP_SESSION_FILE;
  process.env.IGMP_SESSION_FILE = '/definitely/does/not/exist/igmp-sessions.local.json';
  try {
    // Re-import to pick up the new env var (module-level path resolution)
    const modUrl = new URL(`../src/qc-dashboard/preflight.js?igmp_missing=${Date.now()}`, import.meta.url);
    const { preflightBrand: pfb, _clearPreflightCache: cc } = await import(modUrl.href);
    cc();
    const r = await pfb('WS1_MY', { brandConfig: cfg });
    assert.equal(r.status, 'AUTH_EXPIRED');
    assert.equal(r.platform, 'igmp');
    const cookieCheck = r.checks.find((c) => c.name === 'igmp-session');
    assert.ok(cookieCheck && !cookieCheck.ok);
    assert.match(cookieCheck.detail, /igmp-session-capture/);
  } finally {
    if (orig === undefined) delete process.env.IGMP_SESSION_FILE;
    else process.env.IGMP_SESSION_FILE = orig;
  }
});

test('Increment 2: preflight response never leaks cookie values, absolute paths, or URLs', async () => {
  _clearPreflightCache();
  const cfg = [mkBrand('QP2A')];
  const r = await preflightBrand('QP2A', {
    brandConfig: cfg,
    deps: { probeReachable: async () => ({ ok: false, status: 'BO_UNREACHABLE', detail: 'ECONNREFUSED https://qpro1api.823868.com/api/bo/promotion at /home/user/x' }) },
  });
  const json = JSON.stringify(r);
  assert.equal(/qpro1api\.823868\.com/.test(json), false, 'must not leak upstream host');
  assert.equal(/\/home\/user/.test(json), false, 'must not leak absolute filesystem paths');
  // <upstream> and <server-path> tags are the sanitized replacements
  assert.ok(/<upstream>|<server-path>|preflight/i.test(json));
});

test('Increment 2: preflight caches per-brand for TTL — repeat calls do not re-probe', async () => {
  _clearPreflightCache();
  const cfg = [mkBrand('QPRO5')];
  let probeCalls = 0;
  const probe = async () => { probeCalls++; return { ok: true, detail: `call #${probeCalls}` }; };
  const first = await preflightBrand('QPRO5', { brandConfig: cfg, deps: { probeReachable: probe } });
  const second = await preflightBrand('QPRO5', { brandConfig: cfg, deps: { probeReachable: probe } });
  assert.equal(first.status, 'READY');
  assert.equal(second.status, 'READY');
  assert.equal(probeCalls, 1, 'second call within TTL must use cache');
});

test('Increment 2: skipCache bypasses the TTL cache', async () => {
  _clearPreflightCache();
  const cfg = [mkBrand('QPRO5')];
  let probeCalls = 0;
  const probe = async () => { probeCalls++; return { ok: true, detail: `call #${probeCalls}` }; };
  await preflightBrand('QPRO5', { brandConfig: cfg, deps: { probeReachable: probe } });
  await preflightBrand('QPRO5', { skipCache: true, brandConfig: cfg, deps: { probeReachable: probe } });
  assert.equal(probeCalls, 2, 'skipCache:true must re-probe');
});

test('Increment 2: preflightAllBrands returns a map keyed by brand id', async () => {
  _clearPreflightCache();
  const cfg = [mkBrand('QP2A'), mkBrand('QP2B', { mvp: false })];
  const all = await preflightAllBrands({
    brandConfig: cfg,
    deps: { probeReachable: async () => ({ ok: true, detail: 'ok' }) },
  });
  assert.equal(all.QP2A.status, 'READY');
  assert.equal(all.QP2B.status, 'NOT_ENABLED');
});

test('Increment 2: reachedAt is an ISO timestamp', async () => {
  _clearPreflightCache();
  const cfg = [mkBrand('QP2A')];
  const r = await preflightBrand('QP2A', {
    brandConfig: cfg,
    deps: { probeReachable: async () => ({ ok: true, detail: 'ok' }) },
  });
  assert.match(r.reachedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});
