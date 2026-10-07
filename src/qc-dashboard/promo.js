// Promo Effectiveness report — walled, multi-brand, served as a PATH on the existing
// qc-dashboard host (no separate subdomain / DNS):
//   GET /promo/<brand>                         -> branded login (unauth) or the report
//   GET /api/promo/<brand>/<market>/<code>.json -> that code's players (session-gated)
// Isolation is the ROLE-GATE in bin/qc-dashboard.mjs: a report-only `promo-report`
// account is refused the QC Hub (`/`) and Ops Dashboard (`/dashboard`), so it can reach
// only /promo. Per-brand data lives under data/promo/<brand>/ (report.json committed;
// players/ is gitignored PII; usernames present only on this authed server, never in git).
// See docs/plans/promo-gate.md.
import { existsSync, readFileSync, createReadStream, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { readSession } from './auth.js';
import { promoRefreshStore } from './promo-refresh-store.js';
import { macroServe } from './store_a_macro.mjs';

const BRAND_OVERLAY_FILE = (root) => path.join(root, 'data', 'promo', 'promo-brands.overlay.json');

/** Base brand entries straight from the git-tracked registry (no overlay). */
function baseBrands(root) {
  const f = path.join(root, 'data', 'promo', 'promo-brands.json');
  if (!existsSync(f)) return {};
  try { return JSON.parse(readFileSync(f, 'utf8')).brands || {}; } catch { return {}; }
}

/** Runtime-writable, gitignored overlay of extra per-brand report viewers, added via
 *  the Manage Users screen. Shape: { "emails": { "<brandId>": ["a@x", ...] } }. Lives
 *  outside the git-tracked base so grants survive deploys (same pattern as auth overlay). */
function loadBrandEmailOverlay(root) {
  try {
    const f = BRAND_OVERLAY_FILE(root);
    if (!existsSync(f)) return { emails: {} };
    const j = JSON.parse(readFileSync(f, 'utf8'));
    return { emails: (j && typeof j.emails === 'object' && j.emails) || {} };
  } catch { return { emails: {} }; }
}
function saveBrandEmailOverlay(root, ov) {
  writeFileSync(BRAND_OVERLAY_FILE(root), JSON.stringify({ emails: ov.emails || {} }, null, 2));
}

export function loadBrandRegistry(root) {
  const brands = baseBrands(root);
  const ov = loadBrandEmailOverlay(root);
  for (const [id, entry] of Object.entries(brands)) {
    const extra = Array.isArray(ov.emails[id]) ? ov.emails[id] : [];
    if (!extra.length) continue;
    const base = Array.isArray(entry.emails) ? entry.emails : [];
    const seen = new Set(base.map((e) => String(e).toLowerCase()));
    entry.emails = [...base];
    for (const e of extra) {
      const l = String(e).toLowerCase();
      if (!seen.has(l)) { seen.add(l); entry.emails.push(e); }
    }
  }
  return brands;
}

/** Grant a report-only viewer access to brand(s) — default every current brand — by
 *  writing into the gitignored overlay. Idempotent. Returns the brand ids granted. */
export function grantBrandAccess(root, email, brandIds) {
  const em = String(email || '').trim().toLowerCase();
  if (!em) return [];
  const ids = (Array.isArray(brandIds) && brandIds.length) ? brandIds : Object.keys(baseBrands(root));
  const ov = loadBrandEmailOverlay(root);
  for (const id of ids) {
    const list = Array.isArray(ov.emails[id]) ? ov.emails[id] : [];
    if (!list.some((e) => String(e).toLowerCase() === em)) list.push(em);
    ov.emails[id] = list;
  }
  saveBrandEmailOverlay(root, ov);
  return ids;
}

/** Remove a viewer from every brand's overlay list (on removal / role change away from
 *  report-only). Does NOT touch the git-tracked base emails. */
export function revokeBrandAccess(root, email) {
  const em = String(email || '').trim().toLowerCase();
  if (!em) return;
  const ov = loadBrandEmailOverlay(root);
  let changed = false;
  for (const id of Object.keys(ov.emails)) {
    const cur = Array.isArray(ov.emails[id]) ? ov.emails[id] : [];
    const next = cur.filter((e) => String(e).toLowerCase() !== em);
    if (next.length !== cur.length) changed = true;
    if (next.length) ov.emails[id] = next; else delete ov.emails[id];
  }
  if (changed) saveBrandEmailOverlay(root, ov);
}

const brandDir = (root, brand) => path.join(root, 'data', 'promo', brand);

/** Brand id from /promo/<brand> or /api/promo/<brand>/..., or null. */
export function promoBrandFromPath(pathname) {
  let m = pathname.match(/^\/promo\/([a-z0-9-]{1,40})(?:\/.*)?$/);
  if (m) return m[1];
  m = pathname.match(/^\/api\/promo\/([a-z0-9-]{1,40})\//);
  return m ? m[1] : null;
}

/** True if this path belongs to the promo app (dispatched before the qc-host routing). */
export function isPromoPath(pathname) {
  return pathname === '/promo' || pathname.startsWith('/promo/') ||
    pathname.startsWith('/promo-assets/') || pathname.startsWith('/api/promo/');
}

/** admin/promo-team see every brand; a report-only `promo-report` viewer sees ONLY
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

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Session controls injected into the report header: signed-in email, a Manage
 *  Users link for admins (report-only/promo-team viewers omit it — they would be
 *  403'd), and a Log out button. Static HTML (themed via the report CSS vars);
 *  the logout handler is wired in the injected report script. */
function sessionControls(user) {
  const role = (user && user.role) || '';
  const email = String((user && user.email) || '');
  const btn = 'border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font:600 11.5px \'IBM Plex Sans\',system-ui,sans-serif;padding:6px 9px;text-decoration:none;cursor:pointer;white-space:nowrap';
  const who = email ? `<span title="${escapeHtml(email)}" style="color:var(--muted);font-size:11px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(email)}</span>` : '';
  const manage = role === 'admin' ? `<a href="/admin/users" style="${btn}">Manage users</a>` : '';
  return `<span style="display:inline-flex;align-items:center;gap:8px;margin-right:8px">${who}${manage}<button type="button" id="pSessOut" style="${btn}">Log out</button></span>`;
}

/** Brand switcher — the top row of the report header. One pill per brand the
 *  viewer may access (active = current brand; others link to /promo/<id>, a PATH
 *  on this same host, NOT a subdomain), plus a couple of disabled placeholder
 *  slots so the multi-brand structure is visible. admin/promo-team see every
 *  brand; a report-only viewer sees only the brands their email is scoped to. */
function brandSwitcher(root, current, user) {
  const reg = loadBrandRegistry(root);
  const viewable = Object.keys(reg).filter((id) => canView(user, reg[id]));
  if (!viewable.includes(current)) viewable.unshift(current);
  const base = "border:1px solid var(--line);border-radius:999px;font:600 12px 'IBM Plex Sans',system-ui,sans-serif;padding:6px 13px;text-decoration:none;white-space:nowrap;line-height:1.1";
  const pills = viewable.map((id) => {
    const name = (reg[id] && reg[id].name) || id.toUpperCase();
    return id === current
      ? `<span style="${base};background:var(--accent);color:#fff;border-color:var(--accent)">${escapeHtml(name)}</span>`
      : `<a href="/promo/${encodeURIComponent(id)}" style="${base};background:var(--surface);color:var(--ink)">${escapeHtml(name)}</a>`;
  });
  const ph = [];  // placeholder "Project 1 / Project 2" pills removed — they were shown to every viewer with no data behind them
  return `<div class="wrap" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:9px 18px 3px">`
    + `<span style="font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin-right:2px">Project</span>`
    + `${pills.join('')}${ph.join('')}</div>`;
}

// Trim data the report never renders, so viewers never download it: dead analysis
// blocks (verification, ripple, moneycols, calls, meta, depositBehaviour) and the
// internal reviewer columns (group "CHECK" — "Wai Yip: agree?" etc.). Runs at serve
// time, so it stays clean regardless of what the build pipeline emits.
const DEAD_KEYS = ['verification', 'moneycols', 'calls', 'meta', 'ripple', 'depositBehaviour'];
function stripDeadData(payloadStr) {
  let obj;
  try { obj = JSON.parse(payloadStr); } catch { return payloadStr; }
  for (const mk of Object.keys(obj)) {
    const m = obj[mk];
    if (!m || typeof m !== 'object') continue;
    for (const k of DEAD_KEYS) delete m[k];
    if (Array.isArray(m.columns)) {
      const checkKeys = m.columns.filter((c) => c && c.group === 'CHECK').map((c) => c.key);
      if (checkKeys.length) {
        m.columns = m.columns.filter((c) => !c || c.group !== 'CHECK');
        if (Array.isArray(m.codes)) for (const code of m.codes) { if (code && code.cells) for (const ck of checkKeys) delete code.cells[ck]; }
      }
    }
    // Strip the "Game details by segment" config from Tab 5 — the by-membership
    // (tier x game-category) table. Remove its banner row through the next "Budget"
    // section banner, so its whole sub-tab disappears.
    if (Array.isArray(m.configFull)) {
      const first = (r) => (Array.isArray(r) ? String(r.find((x) => x) || '') : '');
      const start = m.configFull.findIndex((r) => /^Game details by segment/.test(first(r)));
      if (start >= 0) {
        let end = m.configFull.findIndex((r, i) => i > start && /^(Budget|Eligible|House margin|Reach|Sportsbook|Config basis)/.test(first(r)));
        if (end < 0) end = m.configFull.length;
        m.configFull = m.configFull.slice(0, start).concat(m.configFull.slice(end));
      }
    }
  }
  return JSON.stringify(obj);
}

// Refresh staleness gate: a report-only viewer may only trigger a re-pull when the
// data is older than this (admin/promo-team bypass it). 24h.
const STALE_MS = 24 * 60 * 60 * 1000;
// Rate limit: a report-only viewer may START at most one build per this window, so a
// viewer walking distinct date ranges can't churn the expensive shared endpoint (single-
// flight bounds concurrency, not serial frequency). admin/promo-team are unthrottled.
// In-memory by design — a process restart simply resets cooldowns, which is harmless.
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
const refreshCooldown = new Map();   // email -> epoch ms of the last build they started
// Cheap read of the current report's build time (prefers the live overlay), via a
// regex on the one-line JSON so we don't parse ~1.4MB just for one field. Returns
// epoch ms, or null (unknown -> caller treats as stale, i.e. allows a refresh).
function reportBuiltAtMs(root, brand) {
  const dir = brandDir(root, brand);
  for (const f of ['report.live.json', 'report.json']) {
    const p = path.join(dir, f);
    if (!existsSync(p)) continue;
    try {
      const m = readFileSync(p, 'utf8').match(/"builtAt"\s*:\s*"([^"]+)"/);
      if (m) { const t = Date.parse(m[1]); if (!Number.isNaN(t)) return t; }
    } catch { /* unreadable -> treat as unknown */ }
  }
  return null;
}

// Current built report's per-code window as "START .. END_EXCL" (cheap regex, prefers
// the live overlay), or null if unknown. Used by the window-aware staleness gate so a
// request for a DIFFERENT window is never refused as "already fresh".
function currentReportPeriod(root, brand) {
  const dir = brandDir(root, brand);
  for (const f of ['report.live.json', 'report.json']) {
    const p = path.join(dir, f);
    if (!existsSync(p)) continue;
    try {
      const mt = readFileSync(p, 'utf8').match(/"period"\s*:\s*"([^"]+)"/);
      if (mt) return mt[1];
    } catch { /* unreadable -> unknown */ }
  }
  return null;
}

// Refresh date-window bounds. The picker is open to every report viewer, so EVERY bound
// is validated here on the server — the UI is only a convenience.
const WINDOW_FLOOR = '2026-01-01';   // the report is tuned for 2026; no earlier starts
const MIN_SPAN_DAYS = 7;             // shorter than the report's smallest forward horizon is meaningless
const MAX_SPAN_DAYS = 400;           // sanity ceiling (a hair over a full year)
function isIsoDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')); }
function addDaysIso(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

// Resolve the refresh window from the request query to {start, endExcl, label} (ISO,
// endExcl EXCLUSIVE — the csir_config contract) or null for the pipeline's default
// window. Accepts ?month=YYYY-MM, or ?start=YYYY-MM-DD&end=YYYY-MM-DD (end INCLUSIVE).
// Returns { window } or { error } (400-worthy). No params -> { window: null } (default).
function parseRefreshWindow(url) {
  const qp = url.searchParams;
  const month = (qp.get('month') || '').trim();
  const startIn = (qp.get('start') || '').trim();
  const endIn = (qp.get('end') || '').trim();        // INCLUSIVE end from the UI
  if (!month && !startIn && !endIn) return { window: null };   // default (frozen) window
  let start, endExcl, label;
  if (month) {
    const mm = month.match(/^(\d{4})-(\d{2})$/);
    if (!mm) return { error: 'invalid month (expected YYYY-MM)' };
    start = `${mm[1]}-${mm[2]}-01`;
    if (!isIsoDate(start)) return { error: 'invalid month' };
    endExcl = `${addDaysIso(start, 32).slice(0, 8)}01`;   // first of the next month
    label = month;
  } else {
    if (!isIsoDate(startIn) || !isIsoDate(endIn)) return { error: 'invalid start/end date' };
    if (endIn < startIn) return { error: 'end is before start' };
    start = startIn; endExcl = addDaysIso(endIn, 1);     // inclusive end -> exclusive
    label = `${startIn} to ${endIn}`;
  }
  if (start < WINDOW_FLOOR) return { error: `start must be on or after ${WINDOW_FLOOR}` };
  // "today" in the warehouse timezone (GMT+8 / MYT) so the future bound matches the client's
  // local-date presets regardless of the server's own timezone (otherwise a UTC server a day
  // behind MYT rejects legitimate ends-today windows during local early morning).
  const whToday = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  if (endExcl > addDaysIso(whToday, 1)) return { error: 'end cannot be in the future' };
  const span = Math.round((Date.parse(endExcl + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000);
  if (span < MIN_SPAN_DAYS) return { error: `window too short (min ${MIN_SPAN_DAYS} days)` };
  if (span > MAX_SPAN_DAYS) return { error: `window too long (max ${MAX_SPAN_DAYS} days)` };
  return { window: { start, endExcl, label } };
}

function serveReport(res, root, brand, user, htmlHeaders, send, windowKey = '') {
  const tplPath = path.join(root, 'public', 'promo', 'report.template.html');
  const dataPath = path.join(brandDir(root, brand), 'report.json');
  if (!existsSync(tplPath) || !existsSync(dataPath)) return send(res, 503, { error: 'report not built for this brand yet' });
  const tpl = readFileSync(tplPath, 'utf8');
  // Phase 2: a standard window (?w=) prefers its nightly pre-built file; otherwise the gitignored
  // report.live.json overlay a refresh writes; otherwise the committed report.json. Each candidate is
  // JSON-validated (a corrupt/truncated one falls through); never blank the page. stripDeadData fails
  // open, so it CANNOT be the validation guard.
  const STD = ['ytd', 'thismonth', 'lastmonth', 'last90'];
  let raw = readFileSync(dataPath, 'utf8');
  // Serving precedence: ?w=<standard> -> its nightly pre-built file; ?w=latest -> the last custom
  // Generate (report.live.json); no ?w (default landing) -> the YTD pre-build. Each candidate is
  // JSON-validated and falls through to report.live.json then the committed report.json.
  const candidates = [];
  if (windowKey === 'latest') candidates.push('report.live.json');
  else if (windowKey && STD.includes(windowKey)) candidates.push(`report.${windowKey}.live.json`, 'report.live.json');
  else candidates.push('report.ytd.live.json', 'report.live.json');
  for (const name of candidates) {
    const p = path.join(brandDir(root, brand), name);
    if (existsSync(p)) { try { const t = readFileSync(p, 'utf8'); JSON.parse(t); raw = t; break; } catch { /* try next */ } }
  }
  const PREBUILT = STD.filter(k => existsSync(path.join(brandDir(root, brand), `report.${k}.live.json`)));
  const payload = stripDeadData(raw);
  const reg = loadBrandRegistry(root);
  const brandName = (reg[brand] && reg[brand].name) || String(brand || '').toUpperCase();
  const apiGlobal = `window.__PLAYERS_API__=${JSON.stringify('/api/promo/' + brand)};window.__PREBUILT__=${JSON.stringify(PREBUILT)};`;
  const wire = 'var _po=document.getElementById("pSessOut");if(_po)_po.onclick=function(){fetch("/auth/logout",{method:"POST",credentials:"same-origin"}).then(function(){location.reload();});};';
  // Brand-aware: the shared template's identity spots (title, header, footer) all
  // read "WS1" (the raw template has exactly those 3 identity occurrences).
  // Substitute the CURRENT brand's name FIRST — before injecting the switcher and
  // the per-brand DATA — so the switcher's own WS1 pill and the data are untouched.
  let html = tpl.replace(/WS1/g, () => brandName)
    .replace('<button class="tgl" id="tgl"', `${sessionControls(user)}<button class="tgl" id="tgl"`);
  html = html.replace('<header class="top"><div class="hbar">', `<header class="top">${brandSwitcher(root, brand, user)}<div class="hbar">`);
  if (html.includes('const DATA=/*__DATA__*/;')) {
    html = html.replace('const DATA=/*__DATA__*/;', `${apiGlobal}const DATA=${payload};${wire}`);
  } else {
    html = html.replace('/*__DATA__*/', payload).replace('</head>', `<script>${apiGlobal}</script></head>`);
  }
  res.writeHead(200, htmlHeaders);
  res.end(html);
}

function serveLogin(res, root, brand, entry, htmlHeaders) {
  const f = path.join(root, 'public', 'promo', 'login.html');
  const name = (entry && entry.name) || (brand ? brand.toUpperCase() : 'Promo');
  if (!existsSync(f)) { res.writeHead(200, htmlHeaders); res.end(`<h1>${name} — sign in</h1>`); return; }
  const html = readFileSync(f, 'utf8').replace(/__BRAND_ID__/g, brand || '').replace(/__BRAND_NAME__/g, name);
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

function servePlayers(req, res, url, root, send) {
  const user = readSession(req);
  if (!user) return send(res, 401, { error: 'sign in required' });
  const m = url.pathname.match(/^\/api\/promo\/([a-z0-9-]{1,40})\/([A-Za-z0-9_-]{1,12})\/([^/]{1,220})\.json$/);
  if (!m) return send(res, 404, { error: 'not found' });
  const [, brand, market, codeseg] = m;
  const entry = loadBrandRegistry(root)[brand] || null;
  if (!canView(user, entry)) return send(res, 403, { error: 'no access to this brand' });
  if (codeseg.includes('..')) return send(res, 404, { error: 'not found' });
  const base = path.join(brandDir(root, brand), 'players', market);
  const file = path.join(base, `${codeseg}.json`);
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' };
  if (!file.startsWith(base + path.sep) || !existsSync(file)) { res.writeHead(200, headers); res.end('[]'); return; }
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}

/** Ingest a gzipped bundle of per-code player files pushed from the build VDI over
 *  the relay (HMAC-authenticated, server-to-server — see handleRelayApi). The bundle
 *  is a gzipped JSON object mapping "<market>/<filename>.json" -> file text. Writes
 *  each file into data/promo/<project>/players/<market>/ (the gitignored PII dir that
 *  survives deploys), then PRUNES stale files not in this push (clean replace — so a
 *  code dropped from the latest pull does not linger). Never runs git; PII stays off
 *  the repo. Path-sanitised: only "<market>/<file>.json" entries, no traversal. */
export function ingestPromoPlayers(root, project, gzBuffer) {
  const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
  if (!/^[a-z0-9-]{1,40}$/.test(project)) throw bad('invalid project id');
  if (!loadBrandRegistry(root)[project]) throw bad('unknown project', 404);
  let bundle;
  try { bundle = JSON.parse(gunzipSync(gzBuffer).toString('utf8')); }
  catch { throw bad('bundle is not valid gzip/JSON'); }
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) throw bad('bundle must be an object');
  const base = path.join(root, 'data', 'promo', project, 'players');
  const REL = /^([A-Za-z0-9_-]{1,12})\/([A-Za-z0-9_.%()!~*'-]{1,220}\.json)$/;
  const keep = new Map(); // market -> Set(filename) written this push
  let written = 0;
  for (const [rel, content] of Object.entries(bundle)) {
    const m = String(rel).match(REL);
    if (!m || rel.includes('..')) continue;
    const [, market, filename] = m;
    const dir = path.join(base, market);
    const file = path.join(dir, filename);
    if (!file.startsWith(base + path.sep)) continue; // defence-in-depth against path escape
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
    written += 1;
    if (!keep.has(market)) keep.set(market, new Set());
    keep.get(market).add(filename);
  }
  if (!written) throw bad('bundle contained no valid <market>/<file>.json entries');
  let pruned = 0; // remove stale files in the markets this push touched
  for (const [market, names] of keep) {
    const dir = path.join(base, market);
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.json') && !names.has(f)) { rmSync(path.join(dir, f)); pruned += 1; }
    }
  }
  return { project, markets: [...keep.keys()], written, pruned };
}

/** Handle every promo path. `send` + `htmlHeaders` come from the server so responses
 *  match its conventions. Dispatched BEFORE the qc-host `/api/` gate (so promo-report
 *  can reach /api/promo/*) and before the qc-host page routing. */
export async function handlePromo(req, res, url, ctx) {
  const { root, send, htmlHeaders } = ctx;
  // Promo report refresh (Phase 2) — MUST be matched before the generic /api/promo/
  // -> servePlayers catch-all below, which would otherwise swallow these paths.
  {
    const rm = url.pathname.match(/^\/api\/promo\/([a-z0-9-]{1,40})\/refresh-(request|status)$/);
    if (rm) {
      const brand = rm[1], action = rm[2];
      const user = readSession(req);
      if (!user) return send(res, 401, { error: 'sign in required' });
      const entry = loadBrandRegistry(root)[brand] || null;
      if (!canView(user, entry)) return send(res, 403, { error: 'no access to this brand' });
      const role = user.role || '';
      if (action === 'status' && req.method === 'GET') {
        return send(res, 200, promoRefreshStore.getForUser({ user: user.email }));
      }
      if (action === 'request' && req.method === 'POST') {
        const parsed = parseRefreshWindow(url);
        if (parsed.error) return send(res, 400, { error: parsed.error });
        const window = parsed.window;   // null = default window, or {start, endExcl, label}
        // Window-aware staleness gate: admin/promo-team may rebuild any window anytime; a
        // report-only viewer is refused ONLY when re-pulling the SAME window that is still
        // fresh (<24h). A request for a DIFFERENT window is always allowed — that is the
        // point of the date-range picker. (A default-window request with no live period to
        // compare falls back to the plain freshness check, matching the pre-picker behavior.)
        if (role === 'promo-report') {
          const built = reportBuiltAtMs(root, brand);
          const fresh = built != null && (Date.now() - built) <= STALE_MS;
          if (fresh) {
            const curPeriod = currentReportPeriod(root, brand);
            const reqPeriod = window ? `${window.start} .. ${window.endExcl}` : null;
            const sameWindow = (reqPeriod == null) || (curPeriod != null && reqPeriod === curPeriod);
            if (sameWindow) {
              return send(res, 403, { error: 'already fresh', builtAt: new Date(built).toISOString() });
            }
          }
        }
        // Rate limit: a report-only viewer may START at most one build per cooldown window
        // (admin/promo-team unthrottled), so walking distinct windows can't churn the shared
        // expensive endpoint. Recorded only when a NEW build is actually started.
        if (role === 'promo-report') {
          const waitMs = REFRESH_COOLDOWN_MS - (Date.now() - (refreshCooldown.get(user.email) || 0));
          if (waitMs > 0) return send(res, 429, { error: 'please wait a few minutes before refreshing again', retryAfterSec: Math.ceil(waitMs / 1000) });
        }
        const market = url.searchParams.get('market') === 'SG' ? 'SG' : 'MY';
        const out = promoRefreshStore.request({ market, requestedBy: user.email, requestedRole: role, window });
        if (role === 'promo-report' && out.created) refreshCooldown.set(user.email, Date.now());
        return send(res, 200, { jobId: out.job.jobId, status: out.job.status, created: out.created, window: out.job.window || null });
      }
      return send(res, 405, { error: 'method not allowed' });
    }
  }
  // Instant Brands-overview from the nightly local Store A (no warehouse) — any window in ~ms.
  // Returns {ok:true, macro, builtAt, window} or {ok:false, reason} so the client falls back safely.
  {
    const mm = url.pathname.match(/^\/api\/promo\/([a-z0-9-]{1,40})\/macro$/);
    if (mm && req.method === 'GET') {
      const brand = mm[1];
      const user = readSession(req);
      if (!user) return send(res, 401, { error: 'sign in required' });
      const entry = loadBrandRegistry(root)[brand] || null;
      if (!canView(user, entry)) return send(res, 403, { error: 'no access to this brand' });
      const parsed = parseRefreshWindow(url);                 // reuse the picker's bounds + validation
      if (parsed.error) return send(res, 400, { error: parsed.error });
      const storePath = path.join(brandDir(root, brand), 'store_a.json');
      if (!existsSync(storePath)) return send(res, 200, { ok: false, reason: 'no local store' });
      let store;
      try { store = JSON.parse(readFileSync(storePath, 'utf8')); }
      catch { return send(res, 200, { ok: false, reason: 'store unreadable' }); }
      let start, endExcl, ytd;
      if (parsed.window) { start = parsed.window.start; endExcl = parsed.window.endExcl; ytd = false; }
      else {                                                  // default: YTD through the last complete month
        const e = new Date(store.date_max + 'T00:00:00');
        start = `${e.getFullYear()}-01-01`;
        endExcl = `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-01`;
        ytd = true;
      }
      const _ln = new Date(endExcl + 'T00:00:00Z'); _ln.setUTCDate(_ln.getUTCDate() - 1);   // UTC-safe (no TZ shift)
      const lastNeeded = _ln.toISOString().slice(0, 10);
      if (!(store.date_min <= start && store.date_max >= lastNeeded))
        return send(res, 200, { ok: false, reason: 'window outside store range', storeRange: [store.date_min, store.date_max] });
      try {
        const macro = macroServe(store, start, endExcl, { ytd });
        return send(res, 200, { ok: true, builtAt: store.built_at, window: { start, endExcl }, macro });
      } catch { return send(res, 200, { ok: false, reason: 'compute failed' }); }
    }
  }
  if (url.pathname.startsWith('/api/promo/')) return servePlayers(req, res, url, root, send);
  if (url.pathname.startsWith('/promo-assets/')) return serveAsset(res, root, url.pathname.slice('/promo-assets/'.length));
  if (url.pathname === '/promo' || url.pathname === '/promo/') {
    const brands = Object.keys(loadBrandRegistry(root));
    res.writeHead(302, { location: `/promo/${brands[0] || 'ws1'}` });
    res.end();
    return;
  }
  const m = url.pathname.match(/^\/promo\/([a-z0-9-]{1,40})\/?$/);
  if (m) {
    const brand = m[1];
    const entry = loadBrandRegistry(root)[brand] || null;
    const user = readSession(req);
    if (user && entry && canView(user, entry)) return serveReport(res, root, brand, user, htmlHeaders, send, (url.searchParams.get('w') || '').replace(/[^a-z0-9]/g, '').slice(0, 20));
    return serveLogin(res, root, brand, entry, htmlHeaders);
  }
  return send(res, 404, { error: 'not found' });
}
