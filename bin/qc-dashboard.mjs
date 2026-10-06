#!/usr/bin/env node
import http from 'node:http';
import { createReadStream, existsSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBrandList, loadQcBrandConfig, resolveBrandRuntime } from '../src/qc-dashboard/brand-config.js';
import { fetchPromoSnapshot, probeDuplicateAcrossMvp } from '../src/qc-dashboard/fetch-promo.js';
import { runAutoChecks } from '../src/qc-dashboard/auto-checks.js';
import { buildMechanics, computeVerdict } from '../src/qc-dashboard/verdict-engine.js';
import { dispatchFixRequest } from '../src/qc-dashboard/fix-request.js';
import { findDuplicateRecent, queryHistory, saveQcRecord } from '../src/qc-dashboard/qc-log.js';
import { listEntries, addEntry, updateEntry, deleteEntry } from '../src/qc-dashboard/leave-board-store.js';
import { validateManualPassOverride } from '../src/qc-dashboard/manual-pass.js';
import { getGoogleClientId, isLocalhost, loadAdmittedUsers, loginFromRequest, makeSessionCookie, readSession, validateProductionConfig, REPORT_ONLY_ROLES, upsertAdmittedUser, removeAdmittedUser } from '../src/qc-dashboard/auth.js';
import { isPromoPath, handlePromo, ingestPromoPlayers, grantBrandAccess, revokeBrandAccess } from '../src/qc-dashboard/promo.js';
import { normalizeRunQcRequest } from '../src/qc-dashboard/run-qc-request.js';
import { runComparison } from '../src/qc-dashboard/compare-flow.js';
import { recordRun } from '../src/qc-dashboard/run-store.js';
import { hashComparePayload } from '../src/qc-dashboard/manual-pass.js';
import { readJsonBounded } from '../src/qc-dashboard/read-json.js';
import { loadConfig as loadSitesConfig, getSite as getSiteById, writeRuntimeOverlay, getRuntimeOverlaySnapshot } from '../src/sites.js';
import { preflightBrand, preflightAllBrands, _clearPreflightCache } from '../src/qc-dashboard/preflight.js';
import { runComparisonFromRelay } from '../src/qc-dashboard/compare-flow.js';
import { readServerRelaySecret, verifySignedRequest, readRawBodyBounded, MAX_BODY_BYTES, MAX_REPORT_BUILD_BYTES, _clearNonceCacheForTest as _clearRelayNonceCache } from '../src/qc-dashboard/relay-auth.js';
import { relayJobStore, safeJobForClient, JOB_STATUS } from '../src/qc-dashboard/relay-job-store.js';
import { promoRefreshStore } from '../src/qc-dashboard/promo-refresh-store.js';
import { sanitizeResultPayload, payloadCarriesEvidence } from '../src/qc-dashboard/relay-result.js';
import { readStatus as readRelayStatus, rotateSecret as rotateRelaySecret, registerRotationInvalidation } from '../src/qc-dashboard/relay-secret-store.js';

// BO Relay: the secret is read on demand each request. The admin can rotate
// via POST /api/admin/relay-secret/rotate without restarting the server —
// that's the "no tech team needed" requirement. `getRelaySecret()` returns
// null when neither RELAY_SECRET env nor the persisted file is present.
function getRelaySecret() {
  const status = readServerRelaySecret();
  return status.present ? status.secret : null;
}
{
  const initial = readServerRelaySecret();
  if (!initial.present) console.log('[relay] disabled — no secret configured; admin can generate one via the QC Hub');
  else console.log(`[relay] enabled — secret source: ${process.env.RELAY_SECRET ? 'env' : 'admin-managed file'}`);
}

// Rotation invalidation (§1): drop every pending job + worker heartbeat
// tied to the OLD secret. Registered once at boot.
const RELAY_FALLBACK_PREFLIGHT_STATUSES = new Set(['BO_UNREACHABLE', 'AUTH_EXPIRED', 'CONFIG_MISSING']);
const WORKER_HEARTBEAT = new Map(); // workerId → { lastSeenAt, workerVersion }
// §4: rotation must invalidate EVERYTHING keyed to the previous secret:
//  · pending / leased jobs (their finalRunId would have been derived
//    under the old key context; safer to drop)
//  · worker heartbeats (a stale worker's next lease attempt should
//    surface as "workers: 0" until it re-signs with the new key)
//  · HMAC replay-nonce cache (nonces are only meaningful against a
//    specific key; keeping old entries is harmless but wastes memory)
registerRotationInvalidation(() => {
  relayJobStore._clearForTest();
  WORKER_HEARTBEAT.clear();
  _clearRelayNonceCache();
});

function _workerSeen(workerId, extras = {}) {
  if (!workerId) return;
  const wid = String(workerId).slice(0, 64);
  WORKER_HEARTBEAT.set(wid, { lastSeenAt: Date.now(), workerVersion: extras.version || null });
}

// CSRF/origin check for state-changing admin endpoints (§1). SameSite=Lax on
// the session cookie already prevents most cross-site POSTs; this is
// defense in depth. Rejects requests whose Origin/Referer host does not
// match the Host the request came in on. Localhost/dev is allowed.
function _verifySameOrigin(req) {
  const host = String(req.headers.host || '').toLowerCase();
  if (!host) return { ok: false, error: 'missing host header' };
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) {
    // fetch() sends Origin on every POST from browser. Its absence on a
    // state-changing request is suspicious — reject.
    return { ok: false, error: 'origin/referer header required for state-changing admin request' };
  }
  let parsed;
  try { parsed = new URL(origin); } catch { return { ok: false, error: 'invalid origin' }; }
  if (parsed.host.toLowerCase() !== host) {
    return { ok: false, error: `cross-origin request rejected (origin=${parsed.host}, host=${host})` };
  }
  return { ok: true };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public', 'qc-hub');
const PORT = Number(process.env.PORT || 4321);

// ── BUILD_ID for CDN cache-busting ───────────────────────────────────────────
// Priority: explicit BUILD_ID env → Bitbucket pipeline commit → startup fallback.
// Must be URL-safe: /^[A-Za-z0-9._-]+$/. Invalid values fall back with a warn.
const URL_SAFE_BUILD = /^[A-Za-z0-9._-]+$/;
function resolveBuildId() {
  const startup = 't-' + Date.now().toString(36);
  const candidates = [
    { source: 'BUILD_ID env var', value: process.env.BUILD_ID },
    { source: 'BITBUCKET_COMMIT env var', value: process.env.BITBUCKET_COMMIT },
  ];
  for (const { source, value } of candidates) {
    if (!value) continue;
    if (URL_SAFE_BUILD.test(value)) return value.length > 40 ? value.slice(0, 40) : value;
    console.warn(`BUILD_ID rejected from ${source}: not URL-safe. Falling back.`);
  }
  return startup;
}
const BUILD_ID = resolveBuildId();
console.log(`BUILD_ID = ${BUILD_ID}`);

validateProductionConfig();
loadQcBrandConfig();

const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache, must-revalidate' };
function assetCacheHeader(url) {
  const v = new URL(url, 'http://localhost').searchParams.get('v');
  return v === BUILD_ID
    ? 'public, max-age=31536000, immutable'
    : 'no-cache, must-revalidate';
}
async function sendHtml(res, filePath) {
  const raw = await readFile(filePath, 'utf8');
  res.writeHead(200, HTML_HEADERS);
  res.end(raw.replace(/__BUILD__/g, BUILD_ID));
}

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, {
    'content-type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(body);
}

// A report-only (`promo-report`) account that lands on the QC Hub / Ops Dashboard
// host is refused here and pointed at its promo site — it can reach neither app.
function sendReportOnly(res) {
  res.writeHead(403, HTML_HEADERS);
  res.end('<!doctype html><meta charset=utf-8><title>Report-only access</title><body style="font:15px system-ui,sans-serif;max-width:34rem;margin:14vh auto;padding:0 1.2rem;color:#1b2740"><h2 style="font-weight:600">Report-only account</h2><p>This account can view the Promo Effectiveness report only — the QC Hub and Ops Dashboard are not available to it.</p><p>Open your promo report from the link you were given (a <code>*.promo.zoom66.xyz</code> address).</p></body>');
}


function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.woff2')) return 'font/woff2';
  return 'application/octet-stream';
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^\/qc-hub/, '') || '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC) || !existsSync(file)) return false;
  if (file.endsWith('.html')) {
    await sendHtml(res, file);
    return true;
  }
  res.writeHead(200, {
    'content-type': contentType(file),
    'cache-control': assetCacheHeader(req.url),
  });
  createReadStream(file).pipe(res);
  return true;
}

function requireSession(req, res) {
  const user = readSession(req);
  if (!user) {
    send(res, 401, { error: 'unauthorized' });
    return null;
  }
  return user;
}

function checkCsrf(req, res) {
  if (process.env.AUTH_MODE === 'dev') return true;
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin requests without Origin header are tolerated
  const host = req.headers.host || '';
  try {
    const oHost = new URL(origin).host;
    if (oHost !== host) {
      send(res, 403, { error: `CSRF: origin "${origin}" does not match host "${host}"` });
      return false;
    }
  } catch {
    send(res, 403, { error: 'CSRF: invalid Origin header' });
    return false;
  }
  return true;
}

/* R17: admin-only diagnostic — per-site config status.
   Returns id + platform + host-only URL + which required fields are present
   (never the values). Lets an admin see "why is Open BO disabled for QPRO1?"
   without server access. NEVER exposes: password, username, reqSignKey, tokens. */
function _safeHost(u) {
  try { return new URL(u).host; } catch { return null; }
}
function buildSiteDiag() {
  let cfg;
  try { cfg = loadSitesConfig(); }
  catch (e) { return { error: 'sites-config-load-failed', detail: e?.message?.replace(/[A-Z]:\\\S+|\/var\/\S+|\/etc\/\S+|\/opt\/\S+|\/home\/\S+/g, '<server-path>') || 'unknown' }; }
  const REQUIRED_QP2 = ['baseUrl', 'apiHost', 'reqSignKey', 'loginMerchantCode', 'username'];
  // R21: QPRO uses the same login flow as QP2 (POST {apiHost}/api/bo/login with
  // AES-CBC(password, reqSignKey) + loginMerchantCode). Pre-R21 this list was
  // just ['baseUrl', 'username'] — Codex flagged that as a false-green source
  // for QPRO in the Site Configs modal. Aligning with QP2 so the diag reflects
  // real usability of the auto-fetch path.
  const REQUIRED_QPRO = ['baseUrl', 'apiHost', 'reqSignKey', 'loginMerchantCode', 'username'];
  const REQUIRED_BIA = ['baseUrl', 'username'];
  const requiredFor = (p) => (p === 'qp2' ? REQUIRED_QP2 : p === 'qpro' ? REQUIRED_QPRO : REQUIRED_BIA);
  const sites = Object.values(cfg.sites || {}).map((s) => {
    const fields = requiredFor(s.platform);
    const has = {};
    for (const f of fields) {
      const v = s[f];
      has[`has_${f}`] = !!(v && !(typeof v === 'string' && v.startsWith('REPLACE')));
    }
    let valid = true;
    let invalid_reason = null;
    try { getSiteById(s.id); }
    catch (e) {
      valid = false;
      invalid_reason = e?.code === 'SITE_CONFIG_INCOMPLETE'
        ? { code: 'SITE_CONFIG_INCOMPLETE', field: e.field || null }
        : { code: 'OTHER', message: (e?.message || 'unknown').slice(0, 120).replace(/[A-Z]:\\\S+|\/var\/\S+|\/etc\/\S+|\/opt\/\S+|\/home\/\S+/g, '<server-path>') };
    }
    return {
      id: s.id,
      platform: s.platform,
      baseUrl_host: _safeHost(s.baseUrl),
      apiHost_host: _safeHost(s.apiHost),
      ...has,
      valid,
      invalid_reason,
    };
  });
  return { sites, defaultSite: cfg.defaultSite };
}

/* R22 pre-flight: check whether Playwright + Chromium are actually available
   on this server BEFORE we invest in wiring the relay. Reports back:
     { playwrightPkg: version | 'missing', chromiumBinary: path | null,
       launchOk: bool, launchError: <sanitized>, browserVersion: string | null }
   Admin-only. Read-only — never launches long-lived processes. */
async function checkPlaywrightReadiness() {
  const out = { playwrightPkg: null, chromiumBinary: null, launchStrategy: null, launchOk: false, launchError: null, browserVersion: null };
  let chromium;
  try {
    const mod = await import('playwright');
    chromium = mod.chromium;
    try { out.playwrightPkg = (await import('playwright/package.json', { with: { type: 'json' } })).default.version; } catch { out.playwrightPkg = 'installed (version unknown)'; }
  } catch (e) { out.launchError = 'playwright package missing: ' + (e?.message || 'unknown').slice(0, 120); return out; }
  try { out.chromiumBinary = chromium.executablePath ? chromium.executablePath() : null; } catch {}
  // Try multiple launch configs so a partial install (full Chromium present but
  // chrome-headless-shell missing) still succeeds. Playwright 1.55+ defaults to
  // the headless-shell binary when `headless:true`; forcing executablePath +
  // args=--headless=new falls back to the full Chromium that IS installed here.
  const attempts = [
    { name: 'default(headless:true)', opts: { headless: true, timeout: 15000 } },
    { name: 'headless-new(force-full-chromium)', opts: { headless: true, executablePath: out.chromiumBinary, args: ['--headless=new'], timeout: 15000 } },
    { name: 'headed(fallback)', opts: { headless: false, executablePath: out.chromiumBinary, timeout: 15000 } },
  ];
  const failures = [];
  for (const attempt of attempts) {
    if (attempt.opts.executablePath == null) { failures.push(`${attempt.name}: no executablePath`); continue; }
    let browser;
    try {
      browser = await chromium.launch(attempt.opts);
      const ctx = await browser.newContext();
      out.browserVersion = browser.version();
      out.launchStrategy = attempt.name;
      out.launchOk = true;
      await ctx.close();
      break;
    } catch (e) {
      failures.push(`${attempt.name}: ${(e?.message || 'launch failed').split('\n')[0].slice(0, 160)}`);
    } finally {
      try { if (browser) await browser.close(); } catch {}
    }
  }
  if (!out.launchOk) out.launchError = failures.join(' | ');
  return out;
}

async function handleApi(req, res, user) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/api/me') return send(res, 200, { user });
  if (req.method === 'GET' && url.pathname === '/api/admin/users') {
    if (user.role !== 'admin') return send(res, 403, { error: 'admin role required' });
    return send(res, 200, { users: loadAdmittedUsers() });
  }
  if (req.method === 'GET' && url.pathname === '/api/diag/sites') {
    if (user.role !== 'admin') return send(res, 403, { error: 'admin role required' });
    return send(res, 200, buildSiteDiag());
  }
  if (req.method === 'GET' && url.pathname === '/api/diag/playwright') {
    if (user.role !== 'admin') return send(res, 403, { error: 'admin role required' });
    return send(res, 200, await checkPlaywrightReadiness());
  }
  if (req.method === 'GET' && url.pathname === '/api/preflight') {
    // Increment 2 (real-QC upgrade): per-brand preflight so RunQC can skip
    // brands where the BO cannot be reached with valid session, and report
    // MANUAL_REQUIRED with the preflight reason instead of a promotion FAIL.
    // Safe to expose to any admitted user — payload strips secrets/paths.
    const brand = url.searchParams.get('brand');
    if (brand) {
      const skipCache = url.searchParams.get('skipCache') === '1';
      return send(res, 200, await preflightBrand(brand, { skipCache }));
    }
    return send(res, 200, await preflightAllBrands({ skipCache: url.searchParams.get('skipCache') === '1' }));
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/site-configs') {
    if (user.role !== 'admin') return send(res, 403, { error: 'admin role required' });
    const diag = buildSiteDiag();
    // Augment with per-site "has_overlay" flag so the UI can show
    // which sites are patched via runtime overlay vs bare bo-sites.json.
    const overlay = getRuntimeOverlaySnapshot();
    const overlaidSiteIds = new Set(Object.keys(overlay.sites || {}));
    if (Array.isArray(diag.sites)) {
      diag.sites = diag.sites.map((s) => ({ ...s, has_overlay: overlaidSiteIds.has(s.id) }));
    }
    return send(res, 200, diag);
  }
  if (req.method === 'GET' && url.pathname === '/api/brands') return send(res, 200, { brands: buildBrandList() });
  if (req.method === 'POST' && !checkCsrf(req, res)) return;
  // Leave Board — casual team leave tracker (any logged-in team member; no approval).
  if (req.method === 'GET' && url.pathname === '/api/leave') {
    return send(res, 200, { entries: await listEntries() });
  }
  if (req.method === 'POST' && url.pathname === '/api/leave') {
    const body = await readJsonBounded(req);
    await addEntry(body, user);
    return send(res, 200, { entries: await listEntries() });
  }
  {
    const md = url.pathname.match(/^\/api\/leave\/([A-Za-z0-9_-]{6,64})\/delete$/);
    if (md && req.method === 'POST') {
      await deleteEntry(md[1], user);
      return send(res, 200, { entries: await listEntries() });
    }
    const mu = url.pathname.match(/^\/api\/leave\/([A-Za-z0-9_-]{6,64})$/);
    if (mu && req.method === 'POST') {
      const body = await readJsonBounded(req);
      await updateEntry(mu[1], body, user);
      return send(res, 200, { entries: await listEntries() });
    }
  }
  // Manage Users — admin-only, self-service. Writes go to the server-side overlay
  // (auth.js), so they persist across deploys that rewrite the git-tracked base.
  if (req.method === 'POST' && url.pathname === '/api/admin/users') {
    if (user.role !== 'admin') return send(res, 403, { error: 'admin role required' });
    let body;
    try { body = await readJsonBounded(req, 8192); }
    catch (e) { return send(res, 400, { error: `invalid JSON: ${e.message}` }); }
    try {
      const users = upsertAdmittedUser({ email: body.email, role: body.role, actingEmail: user.email });
      // Keep brand access in step with the role so the grant is complete in ONE action:
      // a report-only viewer is granted the brand(s) here (default: every current brand),
      // so they can actually SEE the report — no separate promo-brands.json edit. Any
      // other role already sees all brands, so clear any stale overlay grant.
      const em = String(body.email || '').trim().toLowerCase();
      if (String(body.role) === 'promo-report') {
        grantBrandAccess(ROOT, em, Array.isArray(body.brands) ? body.brands : null);
      } else {
        revokeBrandAccess(ROOT, em);
      }
      return send(res, 200, { ok: true, users });
    } catch (e) { return send(res, e.status && e.status < 500 ? e.status : 400, { error: e.message }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/users/remove') {
    if (user.role !== 'admin') return send(res, 403, { error: 'admin role required' });
    let body;
    try { body = await readJsonBounded(req, 8192); }
    catch (e) { return send(res, 400, { error: `invalid JSON: ${e.message}` }); }
    try {
      const users = removeAdmittedUser({ email: body.email, actingEmail: user.email });
      revokeBrandAccess(ROOT, String(body.email || '').trim().toLowerCase());
      return send(res, 200, { ok: true, users });
    } catch (e) { return send(res, e.status && e.status < 500 ? e.status : 400, { error: e.message }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/site-configs') {
    if (user.role !== 'admin') return send(res, 403, { error: 'admin role required' });
    let body;
    try { body = await readJsonBounded(req, 65536); }
    catch (e) { return send(res, 400, { error: `invalid JSON: ${e.message}` }); }
    try {
      const result = writeRuntimeOverlay(body);
      // Preflight caches per-brand READY/BO_UNREACHABLE for 30s. When admin
      // rewrites the overlay we invalidate so the next /api/run-qc probes
      // fresh — otherwise the operator sees stale advice for up to half a
      // minute after a site fix. Also makes route tests deterministic.
      _clearPreflightCache();
      try { console.log(`[admin] site-configs overlay written by ${user.email} — sites=${result.sitesWritten} passwords=${result.passwordsWritten}`); } catch {}
      return send(res, 200, { ok: true, ...result });
    } catch (e) {
      return send(res, 400, { error: (e?.message || 'overlay write failed').slice(0, 200) });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/history') {
    return send(res, 200, await queryHistory({
      brand: url.searchParams.get('brand') || '',
      result: url.searchParams.get('result') || '',
      from: url.searchParams.get('from') || '',
      to: url.searchParams.get('to') || '',
    }));
  }
  if (req.method === 'POST' && url.pathname === '/api/run-qc') {
    const started = Date.now();
    const body = await readJsonBounded(req);
    const normalized = normalizeRunQcRequest(body);
    if (!normalized.ok) return send(res, normalized.status, { error: normalized.error });
    const { brand, codes, handle } = normalized;
    const brands = buildBrandList();
    const selected = brands.find((b) => b.id === brand);
    if (!selected) return send(res, 400, { error: `Unknown brand ${brand}` });
    if (!selected.enabled) return send(res, 400, { error: `${brand} is not enabled — coming soon` });
    // Increment 6 (real-QC upgrade): MVP brands run the deterministic
    // expected-vs-live comparator; other brands keep the pre-existing
    // auto-checks path unchanged.
    const isMvpBrand = selected.qcRules?.mvp === true;

    // Increment 2 (real-QC upgrade): preflight the brand ONCE per RunQC call
    // before any BO fetch. If not READY, every code returns MANUAL_REQUIRED
    // with the preflight reason as a single fetch-failed finding — no BO
    // fetches attempted. Preflight failures are per brief §1: transport /
    // config / auth issues MUST be reported separately from promotion FAILs.
    const preflight = await preflightBrand(brand);
    if (preflight.status !== 'READY') {
      const preflightDetail = `${preflight.status}: ${(preflight.checks || []).filter((c) => !c.ok).map((c) => `${c.name} — ${c.detail}`).join('; ') || 'not ready'}`;
      // Correction brief §1: relay fallback covers connectivity/credential
      // gaps on the company server when the brand is VALID + ENABLED (the
      // enabled check above already guaranteed this). Codes still go to
      // MANUAL_REQUIRED when the relay is disabled OR the preflight status
      // isn't in the whitelist (e.g. PARTIAL_DATA — the relay wouldn't
      // help). Invalid brands / codes never get here (400 above / snapshot-
      // notFound handled by the direct-fetch code path).
      const relaySecret = getRelaySecret();
      const shouldRelay = isMvpBrand
        && relaySecret != null
        && RELAY_FALLBACK_PREFLIGHT_STATUSES.has(preflight.status);
      const results = codes.map((code) => {
        if (shouldRelay) {
          const job = relayJobStore.createJob({
            brand, code, handle: handle || null, requestedBy: user.email,
          });
          return {
            code,
            jobId: job.jobId,
            status: 'QUEUED',
            verdict: null,
            mechanics: 'Awaiting relay evidence from VDI',
            findings: [],
            details: {},
            snapshotPath: null,
            duplicateRecent: null,
            error: null,
            detail: `Preflight: ${preflightDetail} — dispatched to BO relay`,
            preflight,
            duration_s: Number(((Date.now() - started) / 1000).toFixed(2)),
          };
        }
        // No relay path — same MANUAL_REQUIRED-with-runId behavior as before.
        const runId = recordRun({ brand, code, verdict: 'MANUAL_REQUIRED', sourceType: 'preflight-blocked' });
        return {
          code, runId,
          verdict: 'MANUAL_REQUIRED',
          mechanics: 'Live BO evidence unavailable — preflight blocked',
          findings: [{
            severity: 'FAIL',
            check: 'fetch-failed',
            message: `Preflight: ${preflightDetail}${relaySecret ? '' : ' — BO relay not configured (admin can rotate a key from the QC Hub admin panel)'} — no live BO fetch attempted, enter QC verdict manually via Override.`,
          }],
          details: {},
          snapshotPath: null,
          duplicateRecent: null,
          error: 'Preflight not READY',
          detail: preflightDetail,
          preflight,
          duration_s: Number(((Date.now() - started) / 1000).toFixed(2)),
        };
      });
      return send(res, 200, { results, preflight, relayDispatched: shouldRelay && results.some((r) => r.status === 'QUEUED'), duration_s: Number(((Date.now() - started) / 1000).toFixed(2)) });
    }

    const settled = await Promise.allSettled(codes.map(async (code) => {
      const codeStarted = Date.now();
      const duplicateRecent = await findDuplicateRecent({ brand, code });
      const [snapshot, duplicateFindings] = await Promise.all([
        fetchPromoSnapshot({ brand, code }),
        probeDuplicateAcrossMvp({ brand, code }, brands),
      ]);
      const autoFindings = runAutoChecks(snapshot, { duplicateFindings });
      const baseline = computeVerdict({ findings: autoFindings, details: snapshot.details });
      let verdict = baseline.verdict;
      let findings = baseline.findings;
      let compareBlock = null;
      // Increment 6 (real-QC upgrade): for MVP brands, layer the deterministic
      // expected-vs-live comparator on top of the auto-checks path. Its
      // verdict takes precedence, but auto-check findings still surface so
      // duplicate-brand warnings / preflight advisories don't get lost. Non-MVP
      // brands run only the pre-existing path (Increment 8 will gate this
      // more strictly if needed).
      if (isMvpBrand) {
        try {
          const cmp = runComparison({ brand, code, handle, snapshot, brandConfig: selected });
          if (cmp.status === 'ok') {
            verdict = cmp.verdict;
            findings = [...cmp.findings, ...findings.filter((f) => f.check !== 'run-qc-error')];
            compareBlock = {
              expectedSource: cmp.expectedSource,
              expected: cmp.expectedRef,
              actual: cmp.actualRef,
              fields: cmp.fields,
              summary: cmp.summary,
            };
          }
        } catch (e) {
          // Defensive: a bug in the compare engine must not turn the whole
          // /api/run-qc call into a 500. Fall back to the baseline verdict,
          // add a WARNING so operators know the compare didn't run cleanly.
          findings = [...findings, {
            severity: 'WARNING',
            check: 'compare-engine-error',
            message: `Compare engine failed: ${e?.message || 'unknown error'} — auto-check verdict used instead.`,
          }];
        }
      }
      // Blocker 1 fix: record every /api/run-qc outcome server-side, keyed
      // by a runId returned to the client. The MANUAL_PASS override
      // endpoint requires this runId + re-verifies the recorded verdict, so
      // priorVerdict claims in the request body cannot bypass eligibility.
      const runCompareHash = compareBlock ? hashComparePayload({
        expected: compareBlock.expected,
        actual: compareBlock.actual,
        fields: compareBlock.fields,
      }) : null;
      const runId = recordRun({ brand, code, verdict, compareHash: runCompareHash, sourceType: compareBlock?.expectedSource?.sourceType || null });
      return {
        code,
        runId,
        verdict,
        mechanics: snapshot.notFound ? snapshot.detail : buildMechanics(snapshot.details),
        findings,
        details: snapshot.details,
        snapshotPath: snapshot.snapshotPath,
        duplicateRecent,
        error: snapshot.error || null,
        detail: snapshot.detail || null,
        preflight,
        compare: compareBlock,
        duration_s: Number(((Date.now() - codeStarted) / 1000).toFixed(2)),
      };
    }));
    const results = settled.map((item, index) => {
      if (item.status === 'fulfilled') return item.value;
      const message = item.reason?.message || String(item.reason);
      return {
        code: codes[index],
        verdict: 'NOT_SAFE',
        mechanics: 'Mechanics unavailable',
        findings: [{ severity: 'FAIL', check: 'run-qc-error', message }],
        details: {},
        snapshotPath: '',
        duplicateRecent: null,
        error: 'QC run failed',
        detail: message,
        duration_s: Number(((Date.now() - started) / 1000).toFixed(2)),
      };
    });
    return send(res, 200, { results });
  }
  if (req.method === 'POST' && url.pathname === '/api/qc-record') {
    const body = await readJsonBounded(req);
    return send(res, 200, await saveQcRecord(body, user));
  }
  if (req.method === 'POST' && url.pathname === '/api/qc-manual-pass-override') {
    // Increment 7 (real-QC upgrade): D5 override endpoint. Distinct from
    // /api/qc-record so a client bug (or a curl-happy operator) can't
    // silently turn a FAIL into an automated PASS by posting to the wrong
    // route. Precondition is validated server-side: only MANUAL_REQUIRED
    // results are eligible. Reason + evidence + checker are captured into
    // a separate audit record — the original MANUAL_REQUIRED row stays.
    const body = await readJsonBounded(req);
    const parsed = validateManualPassOverride({ body, user });
    if (!parsed.ok) return send(res, parsed.status, { error: parsed.error });
    const saved = await saveQcRecord(parsed.record, user);
    return send(res, 200, { ...saved, override: parsed.record.override });
  }
  // ─────────────────────────────────────────────────────────────────────
  // GET /api/qc-jobs/:jobId — session-gated, ownership-checked (§3).
  {
    const m = url.pathname.match(/^\/api\/qc-jobs\/([A-Za-z0-9_-]{4,64})$/);
    if (m && req.method === 'GET') {
      const jobId = m[1];
      const lookup = relayJobStore.getForUser({ jobId, user });
      if (!lookup.ok) {
        // NOT_FOUND for both nonexistent and wrong-owner: prevents id-guess enumeration.
        const status = lookup.code === 'UNAUTHORIZED' ? 401 : 404;
        return send(res, status, { error: lookup.code === 'UNAUTHORIZED' ? 'unauthorized' : 'not found' });
      }
      const safe = safeJobForClient(lookup.job);
      return send(res, 200, { job: safe });
    }
  }
  // GET /api/admin/relay-health — admin-only aggregate view (no PII).
  // Deliberately NOT under /api/relay/* so it stays on the session-gate
  // dispatch path — HMAC is for the worker's own routes only.
  if (req.method === 'GET' && url.pathname === '/api/admin/relay-health') {
    if (user?.role !== 'admin') return send(res, 403, { error: 'forbidden' });
    const now = Date.now();
    const workers = [];
    for (const [wid, hb] of WORKER_HEARTBEAT) {
      workers.push({
        workerId: wid,
        lastSeenAt: hb.lastSeenAt,
        ageSeconds: Math.floor((now - hb.lastSeenAt) / 1000),
        offline: (now - hb.lastSeenAt) > 30_000,
        workerVersion: hb.workerVersion,
      });
    }
    // §1: status only carries { configured, source, lastRotatedAt, lastRotatedBy }
    // — never the value. `configured` is the observable state.
    const secretStatus = readRelayStatus();
    return send(res, 200, {
      relaySecretConfigured: secretStatus.configured,
      relaySecretSource: secretStatus.source,
      relaySecretLastRotatedAt: secretStatus.lastRotatedAt,
      relaySecretLastRotatedBy: secretStatus.lastRotatedBy,
      jobs: relayJobStore.counts(now),
      workers: workers.sort((a, b) => b.lastSeenAt - a.lastSeenAt),
    });
  }
  // POST /api/admin/relay-secret/rotate — admin + CSRF/origin check.
  // Returns the freshly generated key ONCE. Response is Cache-Control:
  // no-store. Never returns the value again through any other endpoint.
  if (req.method === 'POST' && url.pathname === '/api/admin/relay-secret/rotate') {
    if (user.role !== 'admin') return send(res, 403, { error: 'admin role required' });
    const originCheck = _verifySameOrigin(req);
    if (!originCheck.ok) return send(res, 403, { error: originCheck.error });
    try {
      // Read (and discard) any body — the route is body-less by design.
      await readJsonBounded(req, 512).catch(() => null);
      const result = rotateRelaySecret({ actorEmail: user.email });
      // Deliberately spartan log: rotated + who + when. Never the value,
      // never the length beyond "rotated".
      try { console.log(`[relay-secret] rotated by ${user.email} at ${result.rotatedAt}`); } catch {}
      return send(res, 200, {
        secret: result.secret,
        rotatedAt: result.rotatedAt,
        rotatedBy: result.rotatedBy,
        instructions: 'Copy this value to the VDI file %USERPROFILE%\\.qc-relay\\relay-secret (one line, no trailing newline). This is the only time this value is shown.',
      }, {
        'cache-control': 'no-store',
        pragma: 'no-cache',
      });
    } catch (e) {
      if (e?.code === 'EXTERNALLY_MANAGED') {
        // §3: never pretend the write became effective when the env var
        // still wins. 409 is the semantic match ("cannot rotate in this
        // state") — the admin UI turns this into a clear banner.
        return send(res, 409, { error: e.message, code: 'EXTERNALLY_MANAGED' });
      }
      return send(res, 500, { error: (e?.message || 'rotate failed').slice(0, 200) });
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/fix-request') {
    const body = await readJsonBounded(req, 65536);
    return send(res, 200, await dispatchFixRequest({ ...body, requestedBy: user.email }));
  }
  send(res, 404, { error: 'not found' });
}

async function handle(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/config') {
      return send(res, 200, {
        googleClientId: getGoogleClientId(),
        devMode: process.env.AUTH_MODE === 'dev',
      });
    }
    if (req.method === 'POST' && url.pathname === '/auth/login') {
      const user = await loginFromRequest(req, await readJsonBounded(req));
      const secure = !isLocalhost(req);
      return send(res, 200, { user }, { 'set-cookie': makeSessionCookie(user, { secure }) });
    }
    if (req.method === 'POST' && url.pathname === '/auth/logout') {
      return send(res, 200, { ok: true }, { 'set-cookie': 'qc_hub_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
    }
    // Walled promo report, served as a PATH (/promo/<brand> + /api/promo/<brand>/...).
    // Dispatched after host-agnostic /api/config + /auth/* (so sign-in works) and BEFORE
    // the qc-host `/api/` role-gate below (so a report-only account can reach /api/promo/*).
    if (isPromoPath(url.pathname)) {
      return await handlePromo(req, res, url, { root: ROOT, send, htmlHeaders: HTML_HEADERS });
    }
    // Relay endpoints authenticate via HMAC on raw request bytes — must be
    // dispatched BEFORE the session gate. Session-holding humans never call
    // these; only the VDI worker with the shared RELAY_SECRET does.
    if (url.pathname.startsWith('/api/relay/')) {
      return await handleRelayApi(req, res, url);
    }
    if (url.pathname.startsWith('/api/')) {
      const user = requireSession(req, res);
      if (!user) return;
      // Report-only accounts (promo-report) never reach the QC/BO APIs on this host.
      if (url.pathname !== '/api/me' && REPORT_ONLY_ROLES.has(user.role)) {
        return send(res, 403, { error: 'report-only account — no access to the QC Hub' });
      }
      return await handleApi(req, res, user);
    }
    if (url.pathname === '/dashboard-switcher.css') {
      const file = path.join(ROOT, 'public', 'dashboard-switcher.css');
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': assetCacheHeader(req.url) });
      createReadStream(file).pipe(res);
      return;
    }
    if (url.pathname === '/dashboard.html') {
      res.writeHead(301, { location: '/dashboard' });
      res.end();
      return;
    }
    if (url.pathname === '/dashboard') {
      const s = readSession(req);
      if (!s) {
        res.writeHead(302, { location: `/?return=${encodeURIComponent(url.pathname)}` });
        res.end();
        return;
      }
      if (REPORT_ONLY_ROLES.has(s.role)) return sendReportOnly(res);
      return await sendHtml(res, path.join(ROOT, 'public', 'dashboard.html'));
    }
    if (url.pathname === '/leave-board.html') {
      const s = readSession(req);
      if (!s) {
        res.writeHead(302, { location: `/?return=${encodeURIComponent('/dashboard')}` });
        res.end();
        return;
      }
      if (REPORT_ONLY_ROLES.has(s.role)) return sendReportOnly(res);
      return await sendHtml(res, path.join(ROOT, 'public', 'leave-board.html'));
    }
    // Manage Users — admin-only screen (linked from the QC Hub and Ops Dashboard).
    // Served from public/ (NOT public/qc-hub/), so serveStatic can't expose it ungated.
    if (url.pathname === '/admin/users') {
      const s = readSession(req);
      if (!s) { res.writeHead(302, { location: `/?return=${encodeURIComponent(url.pathname)}` }); res.end(); return; }
      if (REPORT_ONLY_ROLES.has(s.role)) return sendReportOnly(res);
      if (s.role !== 'admin') {
        res.writeHead(403, HTML_HEADERS);
        res.end('<!doctype html><meta charset=utf-8><title>Admins only</title><body style="font:15px system-ui,sans-serif;max-width:34rem;margin:14vh auto;padding:0 1.2rem;color:#1b2740"><h2 style="font-weight:600">Admins only</h2><p>Managing users requires an admin account. Your role can’t change the allowlist.</p><p><a href="/">← Back to QC Hub</a></p></body>');
        return;
      }
      return await sendHtml(res, path.join(ROOT, 'public', 'admin-users.html'));
    }
    // Report-only accounts can't open the QC Hub entry HTML either (assets are harmless).
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const s = readSession(req);
      if (s && REPORT_ONLY_ROLES.has(s.role)) return sendReportOnly(res);
    }
    if (await serveStatic(req, res)) return;
    return await sendHtml(res, path.join(PUBLIC, 'index.html'));
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    send(res, status, { error: status < 500 ? e.message : 'Internal server error' });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// BO Relay endpoints. Signed with HMAC over raw bytes; no session cookie.
// Correction brief §§3-6.

async function handleRelayApi(req, res, url) {
  const relaySecret = getRelaySecret();
  if (!relaySecret) return send(res, 503, { error: 'relay unavailable' });
  // Promo player-data pushes (bulk PII, gzipped ~1.4MB) get a higher read cap on
  // their one path; every other relay message stays at the 64KB DoS guard.
  const PROMO_INGEST_MAX = 24 * 1024 * 1024;
  const isPromoIngest = req.method === 'POST' && /^\/api\/relay\/promo\/[a-z0-9-]{1,40}\/players$/.test(url.pathname);
  const isReportBuild = req.method === 'POST' && url.pathname === '/api/relay/promo/ws1/report-build';
  const isStoreBuild = req.method === 'POST' && url.pathname === '/api/relay/promo/ws1/store-build';
  let rawBody;
  try {
    rawBody = await readRawBodyBounded(req, isPromoIngest ? PROMO_INGEST_MAX : (isReportBuild || isStoreBuild) ? MAX_REPORT_BUILD_BYTES : MAX_BODY_BYTES);
  } catch (e) {
    return send(res, e.status || 413, { error: 'body too large' });
  }
  const verify = verifySignedRequest({
    method: req.method,
    path: url.pathname,
    headers: req.headers,
    bodyBuffer: rawBody,
    secret: relaySecret,
  });
  if (!verify.ok) {
    // Generic 401 — never leak WHY the auth failed.
    return send(res, verify.status || 401, { error: 'unauthorized' });
  }
  const workerId = String(req.headers['x-relay-worker'] || 'unknown').slice(0, 64);

  // POST /api/relay/promo/<project>/players — bulk player-data push from the build
  // VDI. Writes the gzipped bundle into the gitignored (deploy-surviving) players
  // dir; PII travels server-to-server, never through git. See ingestPromoPlayers.
  {
    const pm = url.pathname.match(/^\/api\/relay\/promo\/([a-z0-9-]{1,40})\/players$/);
    if (pm && req.method === 'POST') {
      try {
        const result = ingestPromoPlayers(ROOT, pm[1], rawBody);
        return send(res, 200, { ok: true, ...result });
      } catch (e) {
        return send(res, e.status && e.status < 500 ? e.status : 400, { error: e.message });
      }
    }
  }

  // POST /api/relay/jobs/lease
  if (req.method === 'POST' && url.pathname === '/api/relay/jobs/lease') {
    let body;
    try { body = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {}; }
    catch { return send(res, 400, { error: 'invalid json' }); }
    _workerSeen(workerId, { version: typeof body.workerVersion === 'string' ? body.workerVersion.slice(0, 32) : null });
    const limit = Number.isInteger(body.limit) && body.limit > 0 && body.limit <= 5 ? body.limit : 5;
    const leased = relayJobStore.leaseJobs({ workerId, limit });
    return send(res, 200, { jobs: leased });
  }
  // POST /api/relay/jobs/:jobId/result
  {
    const m = url.pathname.match(/^\/api\/relay\/jobs\/([A-Za-z0-9_-]{4,64})\/result$/);
    if (m && req.method === 'POST') {
      const jobId = m[1];
      _workerSeen(workerId);
      const parsed = sanitizeResultPayload(rawBody.toString('utf8'));
      if (!parsed.ok) return send(res, 400, { error: parsed.code === 'TOO_LARGE' ? 'payload too large' : 'invalid payload' });
      const payload = parsed.payload;
      if (payload.jobId !== jobId) return send(res, 400, { error: 'jobId mismatch' });

      // Look up the job (server-side identity is authoritative — we compare
      // the payload against what WE stored, not what the worker claims).
      const stored = relayJobStore._peekForTest(jobId);
      if (!stored) return send(res, 404, { error: 'unknown job' });

      // Verdict re-derivation: we NEVER take the worker's verdict at face
      // value. If evidence is present, compare(); if not, MANUAL_REQUIRED.
      let bundle;
      if (payload.workerError || !payloadCarriesEvidence(payload)) {
        const reason = payload.workerError?.code || 'RELAY_INCOMPLETE_EVIDENCE';
        bundle = {
          status: 'ok',
          verdict: 'MANUAL_REQUIRED',
          findings: [{
            severity: 'FAIL',
            check: `relay-${reason.toLowerCase().replace(/_/g, '-')}`,
            message: payload.workerError?.message || 'Relay could not produce complete evidence — enter QC verdict manually via Override.',
            field: 'relayEvidence',
          }],
          fields: [],
          summary: { total: 0, passed: 0, failed: 0, warnings: 0, unavailable: 0, skipped: 0 },
          expectedSource: { sourceType: 'not-found', requestedHandle: stored.handle || null },
          expectedRef: null, actualRef: null,
        };
      } else {
        bundle = runComparisonFromRelay({
          brand: stored.brand,
          code: stored.code,
          handle: stored.handle,
          expectedCanonical: payload.expectedCanonical,
          actualCanonical: payload.actualCanonical,
          expectedSourceMeta: payload.expectedSourceMeta,
          platform: payload.platform || null,
        });
        // A "skip" from the compare flow means the relay evidence was
        // unusable (unknown platform / missing fields). Never trust it.
        if (bundle.status !== 'ok') {
          bundle = {
            status: 'ok', verdict: 'MANUAL_REQUIRED',
            findings: [{ severity: 'FAIL', check: 'relay-unusable-evidence', message: `Relay evidence unusable: ${bundle.reason || 'unknown'}`, field: 'relayEvidence' }],
            fields: [], summary: { total: 0, passed: 0, failed: 0, warnings: 0, unavailable: 0, skipped: 0 },
            expectedSource: { sourceType: 'not-found', requestedHandle: stored.handle || null },
            expectedRef: null, actualRef: null,
          };
        }
      }

      const submit = relayJobStore.submitResult({
        jobId, brand: stored.brand, code: stored.code, handle: stored.handle,
        workerId, verdictBundle: bundle,
      });
      if (!submit.ok) return send(res, 409, { error: submit.code });

      // Record the FINAL runId — this is what the MP-override endpoint will
      // require (§5). Attach it to the job so the browser sees the same id.
      if (!submit.alreadyComplete) {
        const compareHash = bundle.fields?.length
          ? hashComparePayload({ expected: bundle.expectedRef, actual: bundle.actualRef, fields: bundle.fields })
          : null;
        const runId = recordRun({
          brand: stored.brand, code: stored.code, verdict: bundle.verdict,
          compareHash, sourceType: bundle.expectedSource?.sourceType || 'relay',
        });
        relayJobStore.attachFinalRunId(jobId, runId);
      }
      return send(res, 200, { ok: true });
    }
  }

  // ── Promo report refresh (Phase 2) — pre-session relay routes, HMAC-verified above ──
  // POST /api/relay/promo/ws1/refresh-lease — VDI worker claims the queued refresh.
  if (req.method === 'POST' && url.pathname === '/api/relay/promo/ws1/refresh-lease') {
    _workerSeen(workerId);
    return send(res, 200, promoRefreshStore.lease({ workerId }));
  }
  // POST /api/relay/promo/ws1/refresh-heartbeat — keep-alive {jobId, progress}; a
  // body with {error} is the terminal fail channel (frees the single-flight slot).
  if (req.method === 'POST' && url.pathname === '/api/relay/promo/ws1/refresh-heartbeat') {
    let body;
    try { body = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {}; }
    catch { return send(res, 400, { error: 'invalid json' }); }
    const jobId = String(body.jobId || '').slice(0, 64);
    const r = body.error
      ? promoRefreshStore.fail({ jobId, error: body.error })
      : promoRefreshStore.heartbeat({ jobId, progress: body.progress });
    return send(res, r.ok ? 200 : 404, r.ok ? { ok: true } : { error: 'unknown job' });
  }
  // POST /api/relay/promo/ws1/report-build — body = rebuilt report.json bytes
  // (jobId in x-refresh-job). Validate, then ATOMIC-swap to report.live.json (D2):
  // the committed report.json is never touched, so a bad/truncated push leaves the
  // live report intact (Constraint 5). serveReport prefers the valid overlay.
  if (isReportBuild) {
    const jobId = String(req.headers['x-refresh-job'] || '').slice(0, 64);
    // Phase 2: a nightly pre-build names its standard window here -> report.<win>.live.json.
    // '' (an interactive refresh) targets the live custom report.live.json as before. No jobId on pre-builds.
    const win = String(req.headers['x-refresh-window'] || '').replace(/[^a-z0-9]/g, '').slice(0, 20);
    const text = rawBody.toString('utf8');
    let obj;
    try { obj = JSON.parse(text); }
    catch { if (jobId) promoRefreshStore.fail({ jobId, error: 'rebuilt report is not valid JSON' }); return send(res, 400, { error: 'invalid report json' }); }
    if (!obj || typeof obj !== 'object' || !obj.MY || !obj.SG || rawBody.length < 100 * 1024) {
      if (jobId) promoRefreshStore.fail({ jobId, error: 'rebuilt report failed validation (missing MY/SG or too small)' });
      return send(res, 422, { error: 'report failed validation' });
    }
    const builtAt = typeof obj.builtAt === 'string' ? obj.builtAt : new Date().toISOString();
    const asOf = (obj.macro && obj.macro.asOf) || obj.period || null;
    try {
      const liveDir = path.join(ROOT, 'data', 'promo', 'ws1');
      if (!existsSync(liveDir)) mkdirSync(liveDir, { recursive: true });
      const live = path.join(liveDir, win ? `report.${win}.live.json` : 'report.live.json');
      const tmp = `${live}.tmp-${process.pid}-${Date.now()}`;
      writeFileSync(tmp, text, 'utf8');
      renameSync(tmp, live);   // atomic swap — last step; live report updates on next load, no restart
    } catch {
      if (jobId) promoRefreshStore.fail({ jobId, error: 'failed to publish rebuilt report' });
      return send(res, 500, { error: 'publish failed' });
    }
    if (jobId) promoRefreshStore.complete({ jobId, asOf, builtAt });
    return send(res, 200, { ok: true, builtAt, window: win || null });
  }
  // POST /api/relay/promo/ws1/store-build — body = store_a.json bytes (the nightly money rollup
  // that powers the instant Brands-overview). Validate shape, then ATOMIC-swap to
  // data/promo/ws1/store_a.json. Independent of the report; a bad push leaves the live store intact.
  if (isStoreBuild) {
    const text = rawBody.toString('utf8');
    let obj;
    try { obj = JSON.parse(text); }
    catch { return send(res, 400, { error: 'invalid store json' }); }
    if (!obj || !Array.isArray(obj.cols) || !Array.isArray(obj.rows) || !obj.date_min || !obj.date_max || rawBody.length < 10 * 1024) {
      return send(res, 422, { error: 'store failed validation' });
    }
    try {
      const dir = path.join(ROOT, 'data', 'promo', 'ws1');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const dst = path.join(dir, 'store_a.json');
      const tmp = `${dst}.tmp-${process.pid}-${Date.now()}`;
      writeFileSync(tmp, text, 'utf8');
      renameSync(tmp, dst);   // atomic swap — live store updates on next request, no restart
    } catch {
      return send(res, 500, { error: 'store publish failed' });
    }
    return send(res, 200, { ok: true, date_max: obj.date_max, n_rows: obj.n_rows || obj.rows.length });
  }

  return send(res, 404, { error: 'not found' });
}

http.createServer(handle).listen(PORT, () => {
  console.log(`QC Hub listening on http://localhost:${PORT}`);
});
