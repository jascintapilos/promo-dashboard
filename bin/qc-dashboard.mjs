#!/usr/bin/env node
import http from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBrandList, loadQcBrandConfig, resolveBrandRuntime } from '../src/qc-dashboard/brand-config.js';
import { fetchPromoSnapshot, probeDuplicateAcrossMvp } from '../src/qc-dashboard/fetch-promo.js';
import { runAutoChecks } from '../src/qc-dashboard/auto-checks.js';
import { buildMechanics, computeVerdict } from '../src/qc-dashboard/verdict-engine.js';
import { dispatchFixRequest } from '../src/qc-dashboard/fix-request.js';
import { findDuplicateRecent, queryHistory, saveQcRecord } from '../src/qc-dashboard/qc-log.js';
import { getGoogleClientId, isLocalhost, loadAdmittedUsers, loginFromRequest, makeSessionCookie, readSession, validateProductionConfig } from '../src/qc-dashboard/auth.js';
import { normalizeRunQcRequest } from '../src/qc-dashboard/run-qc-request.js';
import { readJsonBounded } from '../src/qc-dashboard/read-json.js';
import { loadConfig as loadSitesConfig, getSite as getSiteById, writeRuntimeOverlay, getRuntimeOverlaySnapshot } from '../src/sites.js';

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
  const out = { playwrightPkg: null, chromiumBinary: null, launchOk: false, launchError: null, browserVersion: null };
  let chromium;
  try {
    const mod = await import('playwright');
    chromium = mod.chromium;
    try { out.playwrightPkg = (await import('playwright/package.json', { with: { type: 'json' } })).default.version; } catch { out.playwrightPkg = 'installed (version unknown)'; }
  } catch (e) { out.launchError = 'playwright package missing: ' + (e?.message || 'unknown').slice(0, 120); return out; }
  try { out.chromiumBinary = chromium.executablePath ? chromium.executablePath() : null; } catch {}
  let browser;
  try {
    browser = await chromium.launch({ headless: true, timeout: 15000 });
    const ctx = await browser.newContext();
    out.browserVersion = browser.version();
    out.launchOk = true;
    await ctx.close();
  } catch (e) {
    out.launchError = (e?.message || 'launch failed').split('\n')[0].slice(0, 240);
  } finally {
    try { if (browser) await browser.close(); } catch {}
  }
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
  if (req.method === 'POST' && url.pathname === '/api/admin/site-configs') {
    if (user.role !== 'admin') return send(res, 403, { error: 'admin role required' });
    let body;
    try { body = await readJsonBounded(req, 65536); }
    catch (e) { return send(res, 400, { error: `invalid JSON: ${e.message}` }); }
    try {
      const result = writeRuntimeOverlay(body);
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
    const { brand, codes } = normalized;
    const brands = buildBrandList();
    const selected = brands.find((b) => b.id === brand);
    if (!selected) return send(res, 400, { error: `Unknown brand ${brand}` });
    if (!selected.enabled) return send(res, 400, { error: `${brand} is not enabled — coming soon` });
    const settled = await Promise.allSettled(codes.map(async (code) => {
      const codeStarted = Date.now();
      const duplicateRecent = await findDuplicateRecent({ brand, code });
      const [snapshot, duplicateFindings] = await Promise.all([
        fetchPromoSnapshot({ brand, code }),
        probeDuplicateAcrossMvp({ brand, code }, brands),
      ]);
      const autoFindings = runAutoChecks(snapshot, { duplicateFindings });
      const { verdict, findings } = computeVerdict({ findings: autoFindings, details: snapshot.details });
      return {
        code,
        verdict,
        mechanics: snapshot.notFound ? snapshot.detail : buildMechanics(snapshot.details),
        findings,
        details: snapshot.details,
        snapshotPath: snapshot.snapshotPath,
        duplicateRecent,
        error: snapshot.error || null,
        detail: snapshot.detail || null,
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
    if (url.pathname.startsWith('/api/')) {
      const user = requireSession(req, res);
      if (!user) return;
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
      if (!readSession(req)) {
        res.writeHead(302, { location: `/?return=${encodeURIComponent(url.pathname)}` });
        res.end();
        return;
      }
      return await sendHtml(res, path.join(ROOT, 'public', 'dashboard.html'));
    }
    if (await serveStatic(req, res)) return;
    return await sendHtml(res, path.join(PUBLIC, 'index.html'));
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    send(res, status, { error: status < 500 ? e.message : 'Internal server error' });
  }
}

http.createServer(handle).listen(PORT, () => {
  console.log(`QC Hub listening on http://localhost:${PORT}`);
});
