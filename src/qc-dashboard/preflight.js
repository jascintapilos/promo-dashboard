// Increment 2 (real-QC upgrade): per-brand preflight.
//
// Runs BEFORE any promotion fetch to establish whether the BO can be reached
// with valid credentials/session. Preflight failures MUST be reported
// separately from promotion FAIL findings (per brief §1).
//
// Status vocabulary (fixed set):
//   READY            — brand is MVP-enabled, config is valid, BO reached OK
//   NOT_ENABLED      — brand is not on the MVP allowlist; do not attempt QC
//   CONFIG_MISSING   — bo-sites.json entry missing/invalid for this brand
//   AUTH_EXPIRED     — credentials/session exist in config but BO rejected them
//                      (or IGMP cookie file missing — see D4)
//   BO_UNREACHABLE   — network / DNS / WAF blocked us at the transport layer
//   PARTIAL_DATA     — some endpoints reachable, others not (rare — surfaces
//                      when a brand has multiple hosts and one is degraded)
//
// This module NEVER attempts a login when a cached session is unavailable —
// preflight is a diagnostic; login retry lives in the fetch path. It also
// NEVER exposes cookies, session tokens, passwords, or absolute filesystem
// paths in its return payload (safe to expose via /api/preflight for any
// admitted user).

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { loadQcBrandConfig, resolveBrandRuntime } from './brand-config.js';

const IGMP_SESSION_FILE = path.resolve(process.env.IGMP_SESSION_FILE || 'igmp-sessions.local.json');

// Preflight results are cached briefly so a Run-QC that hits N brands does
// not hammer the BO with N preflight probes. TTL kept short (30s) so an
// operator who just fixed a config issue sees the READY state without a
// server restart.
const _cache = new Map(); // brandId → { result, expiresAt }
const CACHE_TTL_MS = 30_000;

export function _clearPreflightCache() { _cache.clear(); }

// Sanitized error message — strips absolute filesystem paths and URLs so the
// return payload can safely reach the client.
function _cleanReason(err) {
  const raw = (err?.message || String(err || 'unknown error')).slice(0, 240);
  return raw
    .replace(/[A-Z]:\\\S+|\/var\/\S+|\/etc\/\S+|\/opt\/\S+|\/home\/\S+/g, '<server-path>')
    .replace(/https?:\/\/\S+/g, '<upstream>')
    .replace(/\s+/g, ' ')
    .trim();
}

function _mvpEnabled(brand) {
  // qcRules.mvp === true means the brand is in the MVP conformance-tested set
  // (QP2A/QPRO1/QPRO5/WS1_MY today). All other brands report NOT_ENABLED.
  return brand?.qcRules?.mvp === true;
}

// IGMP cookie readiness — checks existence + basic validity of the session
// store WITHOUT ever returning the cookie value itself. Age is optional info
// (some deployments run keepalive so age doesn't imply expiry).
function _checkIgmpCookie(siteId) {
  if (!existsSync(IGMP_SESSION_FILE)) {
    return { ok: false, detail: `no igmp session file present (run bin/igmp-session-capture.mjs --site=${siteId})` };
  }
  try {
    const raw = readFileSync(IGMP_SESSION_FILE, 'utf8');
    const store = JSON.parse(raw);
    const entry = store?.sessions?.[siteId];
    if (!entry?.cookieHeader) {
      return { ok: false, detail: `no cookie captured for site "${siteId}" (run bin/igmp-session-capture.mjs --site=${siteId})` };
    }
    let ageHours = null;
    try {
      const mtimeMs = statSync(IGMP_SESSION_FILE).mtimeMs;
      ageHours = Math.round((Date.now() - mtimeMs) / 3.6e6);
    } catch {}
    return { ok: true, detail: ageHours != null ? `session store age ~${ageHours}h` : 'session store present' };
  } catch (e) {
    return { ok: false, detail: `igmp session file unreadable: ${_cleanReason(e)}` };
  }
}

// Lightweight QPRO/QP2 reachability probe — HEAD the API host root. Never
// attempts login. If the host itself is unreachable/refused/blocked at edge,
// we get a network-layer error or non-200 status without touching creds.
async function _probeQproQp2Reachable(apiHost) {
  if (!apiHost) return { ok: false, status: 'CONFIG_MISSING', detail: 'apiHost missing from site config' };
  try {
    const res = await fetch(apiHost.replace(/\/$/, '') + '/api/bo/promotion?perPage=1&page=1', {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    // 401/403 without auth is EXPECTED (we sent no credentials). What matters:
    // the request reached the app layer AT ALL. If the WAF blocks at edge we
    // get 403 with no JSON body / nginx-style response.
    const contentType = res.headers.get('content-type') || '';
    if (res.status >= 200 && res.status < 300) return { ok: true, detail: `probe HTTP ${res.status}` };
    if ((res.status === 401 || res.status === 419) && contentType.includes('json')) {
      // App-layer auth challenge — BO is reachable, credentials just weren't sent
      return { ok: true, detail: `probe HTTP ${res.status} (app-layer auth challenge — BO reachable)` };
    }
    if (res.status === 403 && !contentType.includes('json')) {
      return { ok: false, status: 'BO_UNREACHABLE', detail: `probe HTTP 403 at edge (WAF-level block, not app auth)` };
    }
    if (res.status >= 500) return { ok: false, status: 'BO_UNREACHABLE', detail: `probe HTTP ${res.status} (upstream error)` };
    return { ok: false, status: 'BO_UNREACHABLE', detail: `probe HTTP ${res.status} unexpected` };
  } catch (e) {
    return { ok: false, status: 'BO_UNREACHABLE', detail: _cleanReason(e) };
  }
}

export async function preflightBrand(brandId, { skipCache = false, brandConfig = null, deps = {} } = {}) {
  const cached = _cache.get(brandId);
  if (!skipCache && cached && cached.expiresAt > Date.now()) return cached.result;

  const checks = [];
  const build = (status, extras = {}) => {
    const result = { brand: brandId, status, checks, reachedAt: new Date().toISOString(), ...extras };
    _cache.set(brandId, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  };

  // 1. Is the brand MVP-enabled?
  let brand;
  try {
    const cfg = brandConfig || loadQcBrandConfig();
    brand = cfg.find((b) => b.id === brandId);
  } catch (e) {
    checks.push({ name: 'load-brand-config', ok: false, detail: _cleanReason(e) });
    return build('CONFIG_MISSING', { platform: null, siteId: null });
  }
  if (!brand) {
    checks.push({ name: 'brand-known', ok: false, detail: `brand "${brandId}" not in qc-dashboard-brands.json` });
    return build('CONFIG_MISSING', { platform: null, siteId: null });
  }
  const enabled = _mvpEnabled(brand);
  checks.push({ name: 'mvp-enabled', ok: enabled, detail: enabled ? 'in MVP conformance set' : 'not in MVP set (real-QC comparison disabled)' });
  if (!enabled) return build('NOT_ENABLED', { platform: null, siteId: null });

  // 2. Runtime resolves? (brandToSite → getSite)
  let runtime;
  try {
    runtime = resolveBrandRuntime(brandId);
  } catch (e) {
    checks.push({ name: 'resolve-runtime', ok: false, detail: _cleanReason(e) });
    return build('CONFIG_MISSING', { platform: null, siteId: null });
  }
  checks.push({ name: 'resolve-runtime', ok: true, detail: `platform=${runtime.platform} siteId=${runtime.siteId}` });

  // 3. Platform-specific readiness
  if (runtime.platform === 'igmp') {
    const cookieCheck = _checkIgmpCookie(runtime.siteId);
    checks.push({ name: 'igmp-session', ok: cookieCheck.ok, detail: cookieCheck.detail });
    if (!cookieCheck.ok) return build('AUTH_EXPIRED', { platform: 'igmp', siteId: runtime.siteId });
    // For MVP we consider a valid session file sufficient — an actual probe
    // POST would consume the operator's session and is the fetch pipeline's
    // job. If prod IGMP silently expires, the fetch will surface it.
    return build('READY', { platform: 'igmp', siteId: runtime.siteId });
  }

  // QPRO / QP2 — probe apiHost reachability. Sanitize probe.detail at the
  // preflight boundary so an injected deps.probeReachable (used by tests or
  // future adapters) that returns raw URLs/paths cannot leak them out.
  const probe = deps.probeReachable
    ? await deps.probeReachable(runtime.apiHost || runtime.baseUrl)
    : await _probeQproQp2Reachable(runtime.apiHost || runtime.baseUrl);
  const safeDetail = probe.detail ? _cleanReason({ message: probe.detail }) : probe.detail;
  checks.push({ name: 'bo-reachable', ok: probe.ok, detail: safeDetail });
  if (!probe.ok) return build(probe.status || 'BO_UNREACHABLE', { platform: runtime.platform, siteId: runtime.siteId });

  return build('READY', { platform: runtime.platform, siteId: runtime.siteId });
}

export async function preflightAllBrands(opts = {}) {
  const cfg = opts.brandConfig || loadQcBrandConfig();
  const results = {};
  for (const brand of cfg) {
    results[brand.id] = await preflightBrand(brand.id, { ...opts, brandConfig: cfg });
  }
  return results;
}
