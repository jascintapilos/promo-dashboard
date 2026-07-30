// Site config loader. One JSON file, multiple sites, one default.
// `bo-sites.json` lives at repo root (gitignored, mode 0600).
// Passwords live in a separate gitignored `bo-sites.local.json`, keyed by
// username, so multiple sites that share a service account share a lookup.

import { readFileSync, statSync, existsSync } from 'node:fs';
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

function loadLocalPasswords() {
  if (!existsSync(LOCAL_FILE)) return {};
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
  return parsed.passwords;
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
