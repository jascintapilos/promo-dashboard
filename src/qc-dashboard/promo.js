// Promo Effectiveness report — walled, multi-brand gate for `*.promo.zoom66.xyz`.
// This host serves ONLY the promo report + its own login + the per-code Players API.
// The QC Hub (`/`), Ops Dashboard (`/dashboard`) and every QC/BO route are ABSENT
// here (404). Multi-brand: brand = the subdomain label; per-brand data lives under
// data/promo/<brand>/ (report.json committed; players/ gitignored PII). Usernames are
// present only in the gitignored player files on this authed server, never in git/Artifact.
// See docs/plans/promo-gate.md.
import { existsSync, readFileSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { readSession } from './auth.js';

const PROMO_SUFFIX = (process.env.PROMO_HOST_SUFFIX || '.promo.zoom66.xyz').toLowerCase();
const PLAYERS_API_BASE = '/api/promo';

/** Brand id from the request host, or null when this is not a promo host.
 *  `ws1.promo.zoom66.xyz` -> 'ws1'. Local dev: set PROMO_DEV_HOST + PROMO_DEV_BRAND. */
export function promoBrandFromHost(req) {
  const host = String(req.headers.host || '').split(':')[0].toLowerCase();
  if (process.env.PROMO_DEV_HOST && host === process.env.PROMO_DEV_HOST.toLowerCase()) {
    return (process.env.PROMO_DEV_BRAND || 'ws1').toLowerCase();
  }
  if (host.endsWith(PROMO_SUFFIX)) {
    const b = host.slice(0, -PROMO_SUFFIX.length).replace(/\.$/, '');
    return /^[a-z0-9-]{1,40}$/.test(b) ? b : null;
  }
  return null;
}

export function loadBrandRegistry(root) {
  const f = path.join(root, 'data', 'promo', 'promo-brands.json');
  if (!existsSync(f)) return {};
  try { return JSON.parse(readFileSync(f, 'utf8')).brands || {}; } catch { return {}; }
}

const brandDir = (root, brand) => path.join(root, 'data', 'promo', brand);

/** May this session view this brand?
 *  admin / promo-team see every brand; a report-only `promo-report` viewer sees ONLY
 *  brands whose registry entry lists their email (per-brand scoping, no cross-brand bleed). */
function canView(user, entry) {
  if (!user || !entry) return false;
  const role = user.role || '';
  if (role === 'admin' || role === 'promo-team') return true;
  if (role === 'promo-report') {
    const emails = Array.isArray(entry.emails) ? entry.emails.map((e) => String(e).toLowerCase()) : [];
    return emails.includes(String(user.email || '').toLowerCase());
  }
  return false;
}

function serveReport(res, root, brand, htmlHeaders, send) {
  const tplPath = path.join(root, 'public', 'promo', 'report.template.html');
  const dataPath = path.join(brandDir(root, brand), 'report.json');
  if (!existsSync(tplPath) || !existsSync(dataPath)) return send(res, 503, { error: 'report not built for this brand yet' });
  const tpl = readFileSync(tplPath, 'utf8');
  const payload = readFileSync(dataPath, 'utf8');
  const apiGlobal = `window.__PLAYERS_API__=${JSON.stringify(PLAYERS_API_BASE)};`;
  let html;
  if (tpl.includes('const DATA=/*__DATA__*/;')) {
    html = tpl.replace('const DATA=/*__DATA__*/;', `${apiGlobal}const DATA=${payload};`);
  } else {
    html = tpl.replace('/*__DATA__*/', payload).replace('</head>', `<script>${apiGlobal}</script></head>`);
  }
  res.writeHead(200, htmlHeaders);
  res.end(html);
}

function serveLogin(res, root, brand, entry, htmlHeaders) {
  const f = path.join(root, 'public', 'promo', 'login.html');
  const name = (entry && entry.name) || (brand ? brand.toUpperCase() : 'Promo');
  if (!existsSync(f)) { res.writeHead(200, htmlHeaders); res.end(`<h1>${name} — sign in</h1>`); return; }
  const html = readFileSync(f, 'utf8')
    .replace(/__BRAND_ID__/g, brand || '')
    .replace(/__BRAND_NAME__/g, name);
  res.writeHead(200, htmlHeaders);
  res.end(html);
}

function serveAsset(res, root, rel) {
  const base = path.join(root, 'public', 'promo');
  const file = path.join(base, rel);
  if (!file.startsWith(base + path.sep) || rel.includes('..') || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  const ext = path.extname(file).toLowerCase();
  const ct = { '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': `${ct}; charset=utf-8`, 'cache-control': 'no-cache' });
  createReadStream(file).pipe(res);
}

function servePlayers(req, res, url, brand, entry, root, send) {
  const user = readSession(req);
  if (!user) return send(res, 401, { error: 'sign in required' });
  if (!canView(user, entry)) return send(res, 403, { error: 'no access to this brand' });
  const m = url.pathname.match(/^\/api\/promo\/([A-Za-z0-9_-]{1,12})\/([^/]{1,220})\.json$/);
  if (!m) return send(res, 404, { error: 'not found' });
  const market = m[1];
  const codeseg = m[2];
  if (codeseg.includes('..')) return send(res, 404, { error: 'not found' });
  const base = path.join(brandDir(root, brand), 'players', market);
  const file = path.join(base, `${codeseg}.json`);
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' };
  if (!file.startsWith(base + path.sep) || !existsSync(file)) { res.writeHead(200, headers); res.end('[]'); return; }
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}

/** Own the entire promo host. `send` + `htmlHeaders` are passed from the server so
 *  responses match its conventions. /api/config + /auth/* are handled upstream (host-agnostic). */
export async function handlePromo(req, res, url, brand, ctx) {
  const { root, send, htmlHeaders } = ctx;
  const entry = loadBrandRegistry(root)[brand] || null;

  if (url.pathname.startsWith('/api/promo/')) return servePlayers(req, res, url, brand, entry, root, send);
  if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
  if (url.pathname.startsWith('/promo-assets/')) return serveAsset(res, root, url.pathname.slice('/promo-assets/'.length));

  if (url.pathname === '/' || url.pathname === '') {
    const user = readSession(req);
    if (user && entry && canView(user, entry)) return serveReport(res, root, brand, htmlHeaders, send);
    return serveLogin(res, root, brand, entry, htmlHeaders);
  }
  return send(res, 404, { error: 'not found' });
}
