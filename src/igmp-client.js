// iGMP (best-in-asia) HTTP client — cookie-session based.
//
// iGMP uses cookie auth (server-side session set by the standard browser
// login form), not the AES-encrypted login flow the QPRO/QP2 client uses.
//
// Cookie resolution order:
//   1. explicit `{ cookie }` arg to igmpPost
//   2. IGMP_COOKIE env var
//   3. igmp-sessions.local.json (written by bin/igmp-session-capture.mjs),
//      keyed by siteId
//
// No CSRF / anti-forgery header observed during the 2026-05-19 capture
// (live save succeeded with raw JSON POST + cookie only).

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const SESSION_FILE = path.resolve(process.env.IGMP_SESSION_FILE || 'igmp-sessions.local.json');

let _sessionStoreCache = null;
function loadSessionStore() {
  if (_sessionStoreCache) return _sessionStoreCache;
  if (!existsSync(SESSION_FILE)) return null;
  try {
    _sessionStoreCache = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
    return _sessionStoreCache;
  } catch (e) {
    console.warn(`igmp-client: failed to read ${SESSION_FILE}: ${e.message}`);
    return null;
  }
}

function cookieFromStore(siteId) {
  const store = loadSessionStore();
  return store?.sessions?.[siteId]?.cookieHeader || null;
}

const IGMP_BASE_URLS = {
  // Promo-code BOs in scope per project_igmp_platform.md
  'ws1-v3-my': 'https://kioskmy.best-in-asia.com',
  'ws1-v3-sg': 'https://kiosksg.best-in-asia.com',
  'ws1-v3-id': 'https://kioskid.best-in-asia.com',
  'ws1-v3-th': 'https://kioskth.best-in-asia.com',
  'ws1-v3-kh': 'https://kioskkh.best-in-asia.com',
  'ws2':       'https://ws2-kioskmy.best-in-asia.com',
};

export function igmpBaseUrl(siteId) {
  const url = IGMP_BASE_URLS[siteId];
  if (!url) {
    throw new Error(
      `igmpBaseUrl: unknown site "${siteId}". Known: ${Object.keys(IGMP_BASE_URLS).join(', ')}`,
    );
  }
  return url;
}

export function listIgmpSites() {
  return Object.keys(IGMP_BASE_URLS);
}

export async function igmpPost(siteId, endpoint, body, { cookie } = {}) {
  const url = igmpBaseUrl(siteId) + endpoint;
  const sessionCookie = cookie || process.env.IGMP_COOKIE || cookieFromStore(siteId);
  if (!sessionCookie) {
    throw new Error(
      `igmpPost: no cookie for site "${siteId}". Three ways to provide one:\n` +
      `  1. Pass {cookie} arg explicitly\n` +
      `  2. Set IGMP_COOKIE="name=value; other=value" env var\n` +
      `  3. Run: node bin/igmp-session-capture.mjs --site=${siteId}\n` +
      `     (launches Chrome, you log in manually, cookies saved to ${SESSION_FILE})`,
    );
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Accept': 'application/json, text/plain, */*',
      'Cookie': sessionCookie,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url}\n  ${typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300)}`);
  }
  if (data && data.success === false) {
    throw new Error(`iGMP error ${url}\n  ${JSON.stringify(data.message || data)}`);
  }
  return data;
}
