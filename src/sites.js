// Site config loader. One JSON file, multiple sites, one default.
// `bo-sites.json` lives at repo root (gitignored, mode 0600).
// Passwords live in a separate gitignored `bo-sites.local.json`, keyed by
// username, so multiple sites that share a service account share a lookup.

import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

// Per-platform required fields at config-parse time.
//
// QP2 and QPRO share the same login flow empirically (same endpoint path,
// same AES-CBC password scheme, same response shape — discovered by the
// Phase 1 login spy). When fully configured, both need the same five fields.
//
// QPRO entries are deliberately lenient here so the config can hold "stub"
// rows (just baseUrl + username) for sites whose apiHost / reqSignKey /
// loginMerchantCode haven't been discovered yet. rawLogin enforces complete-
// ness at the moment of use — a clear "config incomplete for site X" error
// fires only when someone actually tries to authenticate that site.
const REQUIRED_BY_PLATFORM = {
  qp2:  ['baseUrl', 'apiHost', 'reqSignKey', 'loginMerchantCode', 'username'],
  qpro: ['baseUrl', 'username'],
  bia:  ['baseUrl', 'username'],
};
const REQUIRED_FOR_LOGIN = ['apiHost', 'reqSignKey', 'loginMerchantCode'];
const SUPPORTED_PLATFORMS = Object.keys(REQUIRED_BY_PLATFORM);

const FILE = path.resolve(process.env.BO_SITES_FILE || 'bo-sites.json');
const LOCAL_FILE = path.resolve(process.env.BO_SITES_LOCAL_FILE || 'bo-sites.local.json');

// R18-lite: admin-writable runtime overlay. Merged on top of FILE at load
// time (overlay wins per-site + per-field). Lives outside git so real BO
// credentials never touch the repo. Lets an admin patch prod site configs
// via QC Hub Settings without server access.
const RUNTIME_FILE = path.resolve(process.env.BO_SITES_RUNTIME_FILE || 'data/bo-sites-runtime.json');

let _cached = null;

function softPermsCheck(file) {
  if (process.platform === 'win32') return;
  try {
    const mode = statSync(file).mode & 0o777;
    if (mode & 0o044) {
      console.warn(`warning: ${file} is readable by group/other (mode ${mode.toString(8)}). chmod 600.`);
    }
  } catch {}
}

// R18-lite: overlay support. Loaded fresh each readRaw() so a runtime write
// (via invalidateCache) is picked up on the next getSite() call. Overlay
// schema mirrors the base file: `{ sites: { <id>: {...fields} } }`, plus an
// optional top-level `passwords: {<username>: <pw>}` object that merges into
// the local-passwords cache the same way bo-sites.local.json does.
function readRuntimeOverlay() {
  if (!existsSync(RUNTIME_FILE)) return { sites: {}, passwords: {} };
  softPermsCheck(RUNTIME_FILE);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(RUNTIME_FILE, 'utf8'));
  } catch (e) {
    // Runtime file is admin-editable; a corrupt paste shouldn't kill loading.
    // Log and continue with empty overlay so base config still works.
    try { console.warn(`[sites] runtime overlay ${RUNTIME_FILE} is invalid JSON, ignoring: ${e.message}`); } catch {}
    return { sites: {}, passwords: {} };
  }
  return {
    sites: parsed.sites && typeof parsed.sites === 'object' ? parsed.sites : {},
    passwords: parsed.passwords && typeof parsed.passwords === 'object' ? parsed.passwords : {},
  };
}
function mergeRuntimeOverlay(baseSites) {
  const overlay = readRuntimeOverlay();
  if (!overlay.sites || Object.keys(overlay.sites).length === 0) return baseSites;
  const merged = { ...baseSites };
  for (const [id, override] of Object.entries(overlay.sites)) {
    if (!override || typeof override !== 'object') continue;
    merged[id] = { ...(merged[id] || {}), ...override };
  }
  return merged;
}

// R18-lite: exposed so admin endpoints can bust cache after a POST. Also
// clears the passwords cache so a runtime-added password on the overlay is
// picked up on the next getSite() call.
export function invalidateSitesCache() {
  _cached = null;
  _passwordsCache = null;
}

// R18-lite: server writes admin-supplied overlay JSON. Validates shape
// (top-level sites object, per-site fields are strings only) but does NOT
// validate credentials — that happens lazily in getSite() as usual. Returns
// { sitesWritten: N }.
export function writeRuntimeOverlay(overlayJson) {
  if (!overlayJson || typeof overlayJson !== 'object') throw new Error('Overlay must be an object');
  const sites = overlayJson.sites;
  if (sites !== undefined && (typeof sites !== 'object' || sites === null || Array.isArray(sites))) {
    throw new Error('overlay.sites must be an object');
  }
  const passwords = overlayJson.passwords;
  if (passwords !== undefined && (typeof passwords !== 'object' || passwords === null || Array.isArray(passwords))) {
    throw new Error('overlay.passwords must be an object');
  }
  if (sites) {
    for (const [id, entry] of Object.entries(sites)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`overlay.sites["${id}"] must be an object`);
      for (const [k, v] of Object.entries(entry)) {
        if (typeof v !== 'string' && typeof v !== 'number') throw new Error(`overlay.sites["${id}"].${k} must be a string`);
      }
    }
  }
  const payload = { sites: sites || {}, passwords: passwords || {} };
  mkdirSync(path.dirname(RUNTIME_FILE), { recursive: true });
  writeFileSync(RUNTIME_FILE, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
  invalidateSitesCache();
  return {
    sitesWritten: Object.keys(payload.sites).length,
    passwordsWritten: Object.keys(payload.passwords).length,
  };
}

// R18-lite: admin diag needs to know which sites were overlay-patched vs came
// straight from bo-sites.json. Returns the raw overlay for that comparison —
// no credential exposure risk because the endpoint that consumes it strips
// values down to has_<field> booleans before returning to the client.
export function getRuntimeOverlaySnapshot() {
  return readRuntimeOverlay();
}

function loadLocalPasswords() {
  // R18-lite: overlay passwords take precedence over LOCAL_FILE so an admin-
  // added password wins over a stale entry (or fills in when LOCAL_FILE is
  // absent, which is the prod case).
  const overlayPasswords = readRuntimeOverlay().passwords || {};
  if (!existsSync(LOCAL_FILE)) return { ...overlayPasswords };
  softPermsCheck(LOCAL_FILE);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(LOCAL_FILE, 'utf8'));
  } catch (e) {
    throw new Error(`Invalid JSON in ${LOCAL_FILE}: ${e.message}`);
  }
  if (!parsed.passwords || typeof parsed.passwords !== 'object') {
    throw new Error(`${LOCAL_FILE}: missing top-level "passwords" object`);
  }
  return { ...parsed.passwords, ...overlayPasswords };
}

function readRaw() {
  let raw;
  try {
    raw = readFileSync(FILE, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new Error(
        `Missing ${path.relative(process.cwd(), FILE)}.\n` +
        `  Copy bo-sites.example.json → bo-sites.json and fill in your sites.\n` +
        `  (See README for setup.)`,
      );
    }
    throw e;
  }
  softPermsCheck(FILE);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in ${FILE}: ${e.message}`);
  }
  if (!parsed.sites || typeof parsed.sites !== 'object') {
    throw new Error(`${FILE}: missing top-level "sites" object`);
  }
  // R18-lite: merge runtime overlay on top of base. Overlay wins per-site +
  // per-field so an admin can e.g. patch just the `password` on one site
  // without having to re-declare the whole entry.
  parsed.sites = mergeRuntimeOverlay(parsed.sites);
  const ids = Object.keys(parsed.sites);
  if (ids.length === 0) throw new Error(`${FILE}: no sites defined`);

  // R16: readRaw() now handles only shape + platform + id + URL normalization.
  // Per-site credential/placeholder validation moved to validateSiteCredentials()
  // and runs lazily from getSite() so one broken site doesn't poison the loader
  // for every OTHER site. See docs/plans (R16) for rationale.
  for (const id of ids) {
    const s = parsed.sites[id];
    s.platform ||= 'qp2'; // backward compat for entries written before the platform field existed
    if (!SUPPORTED_PLATFORMS.includes(s.platform)) {
      throw new Error(`${FILE}: site "${id}" has unsupported platform "${s.platform}". Supported: ${SUPPORTED_PLATFORMS.join(', ')}`);
    }
    s.id = id;
    if (typeof s.baseUrl === 'string') s.baseUrl = s.baseUrl.replace(/\/$/, '');
    if (s.apiHost) s.apiHost = s.apiHost.replace(/\/$/, '');
  }
  if (parsed.defaultSite && !parsed.sites[parsed.defaultSite]) {
    throw new Error(`${FILE}: defaultSite "${parsed.defaultSite}" is not in sites`);
  }
  parsed.defaultSite ||= ids[0];
  return parsed;
}

/* R16: lazy per-site credential validation. Called from getSite() the first
   time a given site is requested. The site object gets `_validated=true`
   marker so repeat calls skip the work; passwords injected from LOCAL_FILE
   are cached on the site object too (same shape as before, just done on
   demand instead of upfront-for-all). Throws SITE_CONFIG_INCOMPLETE with
   .code/.siteId/.platform/.field/.publicMessage for graceful downstream
   handling by fetchPromoSnapshot / probeDuplicateAcrossMvp. */
let _passwordsCache = null;
function getPasswordsCached() {
  if (_passwordsCache === null) _passwordsCache = loadLocalPasswords();
  return _passwordsCache;
}
function validateSiteCredentials(s) {
  if (s._validated) return s;
  for (const k of REQUIRED_BY_PLATFORM[s.platform]) {
    if (!s[k] || (typeof s[k] === 'string' && s[k].startsWith('REPLACE'))) {
      const err = new Error(`${FILE}: site "${s.id}" (${s.platform}) is missing or has a placeholder for "${k}"`);
      err.code = 'SITE_CONFIG_INCOMPLETE';
      err.siteId = s.id;
      err.platform = s.platform;
      err.field = k;
      err.publicMessage = `Site "${s.id}" (${s.platform}) is not fully configured on this server — contact admin.`;
      throw err;
    }
  }
  if (!s.password) {
    const passwords = getPasswordsCached();
    if (passwords[s.username]) s.password = passwords[s.username];
  }
  if (!s.password) {
    const err = new Error(
      `Missing password for site "${s.id}" (username="${s.username}").\n` +
      `  Set passwords["${s.username}"] in ${LOCAL_FILE},\n` +
      `  or add a "password" field on the site in ${FILE}.`,
    );
    err.code = 'SITE_CONFIG_INCOMPLETE';
    err.siteId = s.id;
    err.platform = s.platform;
    err.field = 'password';
    err.publicMessage = `Site "${s.id}" (${s.platform}) has no password configured on this server — contact admin.`;
    throw err;
  }
  s._validated = true;
  return s;
}

export function loadConfig() {
  if (!_cached) _cached = readRaw();
  return _cached;
}

export function listSites() {
  // R16: preserve pre-R16 all-or-throw semantics — estate-wide bin/ scripts
  // (banner-health-check, sync-promo-codes, sync-bo-status, patch-blacklist-*,
  // deactivate-test-promos, etc.) rely on this: a broken site should fail loud,
  // not silently drop from the iteration. R17 later can add a
  // listSitesWithSkipped() variant if we want partial-listing UX.
  return Object.values(loadConfig().sites).map(validateSiteCredentials);
}

export function getDefaultSiteId() {
  return loadConfig().defaultSite;
}

// Accepts a site id, prefix-match, or undefined (→ default site).
// Returns the site object. Throws with a list of valid ids on miss.
// R16: validates credentials lazily on first call so ONE broken site can't
// poison callers that ask for OTHER sites (fixes prod incident where an
// ibc22 placeholder was killing QC for QPRO1/QPRO5/WS1_MY too).
export function getSite(idOrNull) {
  const cfg = loadConfig();
  const id = idOrNull || cfg.defaultSite;
  const site = cfg.sites[id];
  if (site) return validateSiteCredentials(site);
  // Try prefix or label match for friendlier UX.
  const wanted = id.toLowerCase();
  const matches = Object.values(cfg.sites).filter(
    (s) => s.id.toLowerCase().startsWith(wanted) || (s.label || '').toLowerCase().includes(wanted),
  );
  if (matches.length === 1) return validateSiteCredentials(matches[0]);
  throw new Error(
    `Unknown site "${id}". Known: ${Object.keys(cfg.sites).join(', ')}`,
  );
}

// Mask creds for logging.
export function describeSite(site) {
  return `${site.id} (${site.label}) ${site.baseUrl} user=${site.username}`;
}
