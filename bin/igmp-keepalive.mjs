#!/usr/bin/env node
// igmp-keepalive.mjs — session keep-alive + Playwright auto-relogin.
//
// Two-tier approach:
//   1. PING  — lightweight fetch to /PM/GetPromotionsList (no browser)
//              If success:true → session is alive, nothing to do.
//   2. LOGIN — Playwright headed browser login (API-only POST doesn't
//              fully init the PM module's server-side session).
//              Navigates to /Login#PM → fills form → waits for /Home →
//              captures cookies → verifies PM API → saves to session file.
//
// Credentials: igmp-creds.local.json  (gitignored via *.local.json)
//   { "default": { "username": "...", "password": "..." },
//     "overrides": { "ws1-v3-my": { "password": "..." } } }
//
// Usage:
//   node bin/igmp-keepalive.mjs              # ping all → relogin stale
//   node bin/igmp-keepalive.mjs ws1-v3-sg    # single site
//   node bin/igmp-keepalive.mjs --force      # skip ping, relogin all
//   node bin/igmp-keepalive.mjs --ping-only  # health check, no relogin
//   node bin/igmp-keepalive.mjs --headless   # use headless browser (may fail on some sites)
//
// Recommended schedule: every 30 min (server session timeout ~1-2h).
// The ping is a near-zero-cost keep-alive that resets the server timeout.
// Only when the session is truly dead does the ~5s Playwright login fire.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { igmpBaseUrl, listIgmpSites } from '../src/igmp-client.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const SESSION_FILE = path.join(ROOT, 'igmp-sessions.local.json');
const CREDS_FILE   = path.join(ROOT, 'igmp-creds.local.json');

// ── Credential resolver ──────────────────────────────────────────────
function loadCreds(siteId) {
  if (!existsSync(CREDS_FILE)) {
    throw new Error(
      `Missing ${CREDS_FILE}.\nCreate it with:\n` +
      `  { "default": { "username": "<username>", "password": "<password>" },\n` +
      `    "overrides": { "ws1-v3-my": { "password": "<override-password>" } } }`,
    );
  }
  const cfg = JSON.parse(readFileSync(CREDS_FILE, 'utf8'));
  const d = cfg.default || {};
  const o = cfg.overrides?.[siteId] || {};
  const username = o.username || d.username;
  const password = o.password || d.password;
  if (!username || !password) {
    throw new Error(`${CREDS_FILE}: no username/password resolved for site "${siteId}" (check "default" and "overrides").`);
  }
  return { username, password };
}

// ── Session store ────────────────────────────────────────────────────
function loadStore() {
  if (!existsSync(SESSION_FILE)) return { sessions: {} };
  return JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
}

function saveStore(store) {
  writeFileSync(SESSION_FILE, JSON.stringify(store, null, 2));
}

// ── Ping: lightweight session liveness check ─────────────────────────
// Returns 'alive' | 'stale' | 'error:<msg>'
async function ping(siteId, cookie) {
  if (!cookie) return 'stale';
  try {
    const base = igmpBaseUrl(siteId);
    // First check: does /Home redirect to /Login? (session expired)
    const rHome = await fetch(`${base}/Home`, {
      headers: { Cookie: cookie },
      redirect: 'manual',
    });
    if (rHome.status === 302 && /\/Login/i.test(rHome.headers.get('location') || '')) {
      return 'stale';
    }

    // Second check: does PM API respond with success?
    const rPM = await fetch(`${base}/PM/GetPromotionsList`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: '{}',
      redirect: 'manual',
    });
    if (rPM.status === 500) return 'stale';
    if (rPM.status !== 200) return `error:HTTP ${rPM.status}`;
    const txt = await rPM.text();
    if (!txt || txt.length < 5) return 'stale';
    try {
      const j = JSON.parse(txt);
      if (j.success === true) return 'alive';
      // success:false but not a redirect — PM module issue (not auth)
      return `error:PM ${(j.message || '').substring(0, 60)}`;
    } catch { return 'stale'; }
  } catch (e) { return `error:${e.message.substring(0, 60)}`; }
}

// ── Login via Playwright (browser-based, full session init) ──────────
let _browser = null;
async function getBrowser(headless) {
  if (_browser) return _browser;
  const { chromium } = await import('playwright');
  _browser = await chromium.launch({ headless, channel: 'chrome' });
  return _browser;
}

async function loginPlaywright(siteId, { headless = false } = {}) {
  const base = igmpBaseUrl(siteId);
  const { username, password } = loadCreds(siteId);

  const browser = await getBrowser(headless);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  try {
    await page.goto(`${base}/Login#PM`, { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Fill and submit login form
    await page.waitForSelector('input#Username, input[name="Username"]', { timeout: 10000 });
    await page.fill('input#Username, input[name="Username"]', username);
    await page.fill('input#Password, input[name="Password"]', password);
    await page.click('button[type="submit"], button:has-text("Login")');

    // Wait for navigation away from /Login
    await page.waitForURL(u => !/\/Login(?:\?|$)/i.test(u.href), { timeout: 20000 });

    // Check for error (redirect back to login with error param)
    if (/\/Login/i.test(page.url())) {
      const errParam = new URL(page.url()).searchParams.get('ErrorMessage');
      return { ok: false, error: errParam || 'Login redirect failed' };
    }

    // Wait for session to fully initialize (JS routing, PM module load)
    await page.waitForTimeout(2000);

    // Capture cookies
    const cookies = await ctx.cookies();
    const cookieHeader = cookies
      .filter(c => c.name && c.value)
      .map(c => `${c.name}=${c.value}`)
      .join('; ');

    if (!cookieHeader) return { ok: false, error: 'No cookies captured' };

    return { ok: true, cookieHeader, cookies };
  } catch (e) {
    // Check if we're on the login page with an error
    try {
      const url = page.url();
      if (/Login/i.test(url)) {
        const errParam = new URL(url).searchParams.get('ErrorMessage');
        if (errParam) return { ok: false, error: decodeURIComponent(errParam) };
      }
    } catch { /* ignore */ }
    return { ok: false, error: e.message.substring(0, 120) };
  } finally {
    await ctx.close();
  }
}

async function closeBrowser() {
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}

// ── Main ─────────────────────────────────────────────────────────────
const args      = process.argv.slice(2);
const force     = args.includes('--force');
const pingOnly  = args.includes('--ping-only');
const headless  = args.includes('--headless');
const sites     = args.filter(a => !a.startsWith('--'));
const target    = sites.length ? sites : listIgmpSites();

const store = loadStore();
store.sessions = store.sessions || {};

const results = { alive: 0, refreshed: 0, failed: 0, skipped: 0 };
const report = [];

for (const siteId of target) {
  const existing = store.sessions[siteId]?.cookieHeader;
  const capturedAt = store.sessions[siteId]?.capturedAt;
  const ageMin = capturedAt
    ? Math.round((Date.now() - new Date(capturedAt).getTime()) / 60000)
    : null;
  process.stdout.write(`${siteId} … `);

  // ── Step 1: Ping ──────────────────────────────────────────────
  if (!force) {
    const status = await ping(siteId, existing);
    if (status === 'alive') {
      console.log(`alive (${ageMin}m old)`);
      report.push({ site: siteId, status: 'alive', age: ageMin });
      results.alive++;
      continue;
    }
    if (status.startsWith('error:')) {
      // Session is authenticated but PM has issues — don't clobber cookie
      const detail = status.substring(6);
      console.log(`PM error (session OK, ${ageMin}m old): ${detail}`);
      report.push({ site: siteId, status: 'pm-error', detail, age: ageMin });
      results.alive++;  // count as alive since auth is valid
      continue;
    }
    process.stdout.write('stale → ');
  }

  // ── Step 2: Relogin (skip if --ping-only) ─────────────────────
  if (pingOnly) {
    console.log('stale (ping-only mode, skipping relogin)');
    report.push({ site: siteId, status: 'stale-skipped', age: ageMin });
    results.skipped++;
    continue;
  }

  const result = await loginPlaywright(siteId, { headless });
  if (!result.ok) {
    console.log(`FAIL: ${result.error}`);
    report.push({ site: siteId, status: 'fail', error: result.error });
    results.failed++;
    continue;
  }

  // Verify the fresh cookie works
  const verify = await ping(siteId, result.cookieHeader);
  if (verify === 'alive') {
    store.sessions[siteId] = {
      capturedAt: new Date().toISOString(),
      cookieHeader: result.cookieHeader,
      cookies: result.cookies,
    };
    saveStore(store);
    console.log('refreshed ✓');
    report.push({ site: siteId, status: 'refreshed' });
    results.refreshed++;
  } else if (verify.startsWith('error:')) {
    // Login OK, PM has issues — save cookie anyway (auth is valid)
    store.sessions[siteId] = {
      capturedAt: new Date().toISOString(),
      cookieHeader: result.cookieHeader,
      cookies: result.cookies,
    };
    saveStore(store);
    const detail = verify.substring(6);
    console.log(`refreshed (PM issue: ${detail})`);
    report.push({ site: siteId, status: 'refreshed-pm-error', detail });
    results.refreshed++;
  } else {
    console.log('FAIL: login OK but session did not verify');
    report.push({ site: siteId, status: 'fail', error: 'verify failed after login' });
    results.failed++;
  }
}

await closeBrowser();

// ── Summary ──────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Done: ${results.alive} alive, ${results.refreshed} refreshed, ${results.failed} failed, ${results.skipped} skipped`);
if (results.failed > 0) process.exit(1);
