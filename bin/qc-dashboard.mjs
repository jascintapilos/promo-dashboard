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
import { validateManualPassOverride } from '../src/qc-dashboard/manual-pass.js';
import { getGoogleClientId, isLocalhost, loadAdmittedUsers, loginFromRequest, makeSessionCookie, readSession, validateProductionConfig } from '../src/qc-dashboard/auth.js';
import { normalizeRunQcRequest } from '../src/qc-dashboard/run-qc-request.js';
import { runComparison } from '../src/qc-dashboard/compare-flow.js';
import { recordRun } from '../src/qc-dashboard/run-store.js';
import { hashComparePayload } from '../src/qc-dashboard/manual-pass.js';
import { readJsonBounded } from '../src/qc-dashboard/read-json.js';
import { loadConfig as loadSitesConfig, getSite as getSiteById, writeRuntimeOverlay, getRuntimeOverlaySnapshot } from '../src/sites.js';
import { preflightBrand, preflightAllBrands, _clearPreflightCache } from '../src/qc-dashboard/preflight.js';

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
      const results = codes.map((code) => {
        // Blocker 1 fix: even the preflight-blocked MANUAL_REQUIRED paths get
        // a server-issued runId. That's what the MANUAL_PASS override endpoint
        // requires to prove the override targets a real, recent server-side
        // MANUAL_REQUIRED decision (not a crafted body claim).
        const runId = recordRun({ brand, code, verdict: 'MANUAL_REQUIRED', sourceType: 'preflight-blocked' });
        return {
          code,
          runId,
          verdict: 'MANUAL_REQUIRED',
          mechanics: 'Live BO evidence unavailable — preflight blocked',
          findings: [{
            severity: 'FAIL',
            check: 'fetch-failed',
            message: `Preflight: ${preflightDetail} — no live BO fetch attempted, enter QC verdict manually via Override.`,
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
      return send(res, 200, { results, preflight, duration_s: Number(((Date.now() - started) / 1000).toFixed(2)) });
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
