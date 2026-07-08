// AdsPower Local API session handling for UG (3MPLAY-NS3) brands.
//
// AdsPower owns the proxy + browser fingerprint per profile and persists the
// BO login (cookies/cache) itself — this module does no cookie handling of
// its own. It only: starts/reuses a profile via the Local API, hands back a
// Playwright browser connected over CDP, and stops the profile when the
// caller is done (which is what tells AdsPower to sync its cloud data).
//
// Flow (per AdsPower docs):
//   1. GET /api/v1/browser/start?user_id=<id>  -> { data: { ws: { puppeteer } } }
//   2. chromium.connectOverCDP(ws.puppeteer)
//   3. drive the existing/new page
//   4. GET /api/v1/browser/stop?user_id=<id>   -> closes + syncs cloud data

import { chromium } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const DEFAULT_API = 'http://127.0.0.1:50325';

// Known AdsPower profile IDs (serial numbers) per UG brand.
// Add more here, or drop an `adspower-profiles.local.json` (git-ignored,
// `{ "UG02": "xxxxxxxx" }`) at repo root to extend without editing source.
export const BRAND_PROFILES = {
  UG01: 'k1bt9w43', // "[AI] Gabrielle Tiffany" — SBO28 agent login (gaby)
};

function loadLocalOverrides() {
  const f = path.join(ROOT, 'adspower-profiles.local.json');
  if (!existsSync(f)) return {};
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return {}; }
}

export function resolveProfileId(brandOrId) {
  const map = { ...BRAND_PROFILES, ...loadLocalOverrides() };
  const key = String(brandOrId).toUpperCase();
  if (map[key]) return map[key];
  if (/^[a-z0-9]{6,}$/i.test(brandOrId)) return brandOrId; // already looks like a raw profile id
  throw new Error(
    `No AdsPower profile configured for "${brandOrId}".\n` +
    `  Pass --profile=<user_id> directly, or add it to BRAND_PROFILES in src/adspower-session.js,\n` +
    `  or create adspower-profiles.local.json: { "${key}": "<user_id>" }`
  );
}

async function adsGet(api, pathname) {
  const res = await fetch(`${api}${pathname}`).catch(() => null);
  if (!res) return null;
  return res.json().catch(() => null);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getActiveEndpoint(api, userId) {
  const active = await adsGet(api, `/api/v1/browser/active?user_id=${userId}`);
  if (active?.code === 0 && active.data?.status === 'Active' && active.data?.ws?.puppeteer) {
    return active.data.ws.puppeteer;
  }
  return null;
}

/**
 * Starts (or reuses) an AdsPower profile and returns a connected Playwright
 * browser + its first page. Retries through the transient failure modes
 * we've hit in practice: cold-API hiccups, "being used by" GUI lockouts,
 * and stale CDP endpoints left over from a crashed/closed browser.
 */
export async function startProfile(brandOrId, { api = DEFAULT_API, retries = 4 } = {}) {
  const userId = resolveProfileId(brandOrId);

  const status = await adsGet(api, '/status');
  if (!status || status.code !== 0) {
    throw new Error(
      `AdsPower Local API not reachable at ${api}.\n` +
      `  Open the AdsPower app, log into the AdsPower account, and make sure the Local API is enabled.`
    );
  }

  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    let wsEndpoint = await getActiveEndpoint(api, userId);

    if (!wsEndpoint) {
      const started = await adsGet(api, `/api/v1/browser/start?user_id=${userId}&open_tabs=1`);
      if (started?.code === 0 && started.data?.ws?.puppeteer) {
        wsEndpoint = started.data.ws.puppeteer;
      } else if (/is being used by/i.test(started?.msg || '')) {
        // Someone (usually the AdsPower GUI) already has it open — reuse it.
        await sleep(2000);
        wsEndpoint = await getActiveEndpoint(api, userId);
      } else {
        lastErr = started?.msg || 'no response from AdsPower';
        console.log(`⚠ AdsPower start attempt ${attempt}/${retries} failed: ${lastErr}`);
      }
    }

    if (wsEndpoint) {
      const cdpUrl = wsEndpoint.replace(/^ws:/, 'http:').replace(/\/devtools.*$/, '');
      try {
        const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 25000 });
        const ctx = browser.contexts()[0] || await browser.newContext();
        const page = ctx.pages()[0] || await ctx.newPage();
        await Promise.race([
          page.evaluate(() => 1 + 1),
          sleep(10000).then(() => { throw new Error('page.evaluate health check timed out'); }),
        ]);
        return { browser, page, userId };
      } catch (err) {
        lastErr = err.message;
        console.log(`⚠ CDP connect attempt ${attempt}/${retries} failed (${lastErr}) — cycling the profile`);
        await adsGet(api, `/api/v1/browser/stop?user_id=${userId}`).catch(() => {});
        await sleep(4000);
        continue;
      }
    }
    await sleep(4000);
  }

  throw new Error(
    `Could not obtain a working AdsPower browser for profile ${userId} after ${retries} attempts (${lastErr || 'unknown error'}).\n` +
    `  Open AdsPower and click "Open" on the profile manually, then retry.`
  );
}

/** Tells AdsPower to close the browser and sync its cloud data. */
export async function stopProfile(userId, { api = DEFAULT_API } = {}) {
  await adsGet(api, `/api/v1/browser/stop?user_id=${userId}`).catch(() => {});
}
