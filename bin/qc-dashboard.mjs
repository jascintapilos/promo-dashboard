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
import { isLocalhost, loginFromRequest, makeSessionCookie, readSession, validateProductionConfig } from '../src/qc-dashboard/auth.js';
import { normalizeRunQcRequest } from '../src/qc-dashboard/run-qc-request.js';
import { readJsonBounded } from '../src/qc-dashboard/read-json.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public', 'qc-hub');
const PORT = Number(process.env.PORT || 4321);

validateProductionConfig();
loadQcBrandConfig();

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

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^\/qc-hub/, '') || '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC) || !existsSync(file)) return false;
  res.writeHead(200, { 'content-type': contentType(file) });
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

async function handleApi(req, res, user) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/api/me') return send(res, 200, { user });
  if (req.method === 'GET' && url.pathname === '/api/brands') return send(res, 200, { brands: buildBrandList() });
  if (req.method === 'POST' && !checkCsrf(req, res)) return;
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
        googleClientId: process.env.GOOGLE_CLIENT_ID || null,
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
    if (serveStatic(req, res)) return;
    const index = await readFile(path.join(PUBLIC, 'index.html'));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(index);
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    send(res, status, { error: status < 500 ? e.message : 'Internal server error' });
  }
}

http.createServer(handle).listen(PORT, () => {
  console.log(`QC Hub listening on http://localhost:${PORT}`);
});
