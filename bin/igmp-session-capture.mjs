#!/usr/bin/env node
// Launches Chrome via Playwright, opens the iGMP kiosk login for a given
// site, waits for the user to log in interactively (or auto-fills if
// --user / --pass are supplied), then dumps the resulting cookies to
// `igmp-sessions.local.json` keyed by siteId.
//
//   node bin/igmp-session-capture.mjs --site=ws1-v3-my
//   node bin/igmp-session-capture.mjs --brand=MB8
//   node bin/igmp-session-capture.mjs --brand=MB8 --user=promo_testbot --pass=Promo111!
//
// Quits when login is detected (auto mode) or the user closes the browser
// (manual mode). The cookie file is gitignored.

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from './_args.js';
import { igmpBaseUrl, listIgmpSites } from '../src/igmp-client.js';
import { BRAND_TO_SITE } from '../src/ingest.js';

const COOKIE_FILE = path.resolve('igmp-sessions.local.json');

const { flags, positional } = parseArgs(process.argv.slice(2));
let siteId = flags.site;
if (!siteId && flags.brand) siteId = BRAND_TO_SITE[flags.brand]?.siteId;
if (!siteId) {
  console.error('usage: igmp-session-capture.mjs --site=<id> | --brand=<BRAND> [--user=<u> --pass=<p>]');
  console.error('  sites: ' + listIgmpSites().join(', '));
  process.exit(2);
}

let baseUrl;
try { baseUrl = igmpBaseUrl(siteId); }
catch (e) { console.error(e.message); process.exit(2); }

const loginUrl = `${baseUrl}/Login#PM`;
const username = flags.user || flags.username || null;
const password = flags.pass || flags.password || null;
const autoMode = !!(username && password);

console.error(`[session-capture] target: ${siteId} (${loginUrl})`);
if (autoMode) {
  console.error(`[session-capture] auto-login as: ${username}`);
} else {
  console.error(`[session-capture] launching Chrome — log in manually, then close the window.`);
}

const browser = await chromium.launch({ headless: false, channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto(loginUrl);

if (autoMode) {
  // Fill the login form. iGMP login page has standard username/password inputs.
  // Wait for the form to be ready before typing.
  await page.waitForSelector('input[type="text"], input[name*="user"], input[id*="user"], input[placeholder*="ser"]', { timeout: 10000 });

  // Username field — try multiple selectors in priority order.
  const userSel = 'input[name="txtUserID"], input[id="txtUserID"], input[placeholder*="Username"], input[placeholder*="username"], input[type="text"]';
  const passSel = 'input[name="txtPassword"], input[id="txtPassword"], input[placeholder*="Password"], input[placeholder*="password"], input[type="password"]';

  await page.fill(userSel, username);
  await page.fill(passSel, password);

  // Click the login/submit button.
  const btnSel = 'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign In"), a:has-text("Login")';
  await page.click(btnSel);

  // Wait until we're past the login page (URL changes away from /Login).
  console.error(`[session-capture] credentials submitted — waiting for redirect…`);
  await page.waitForURL((url) => !url.href.includes('/Login'), { timeout: 20000 });
  console.error(`[session-capture] login successful — current URL: ${page.url()}`);

  // Brief pause so any auth cookies finish being set.
  await page.waitForTimeout(1500);

} else {
  // Manual mode: wait for the browser to close.
  await new Promise((resolve) => {
    browser.on('disconnected', resolve);
  });
}

// Capture cookies.
let cookies = [];
try { cookies = await ctx.cookies(); } catch {}

if (!cookies.length) {
  console.error('[session-capture] no cookies captured — was login completed?');
  process.exit(3);
}

const store = existsSync(COOKIE_FILE)
  ? JSON.parse(readFileSync(COOKIE_FILE, 'utf8'))
  : { sessions: {} };

const cookieHeader = cookies
  .filter((c) => c.domain && c.name && c.value)
  .map((c) => `${c.name}=${c.value}`)
  .join('; ');

store.sessions = store.sessions || {};
store.sessions[siteId] = {
  capturedAt: new Date().toISOString(),
  cookieHeader,
  cookies,
};
writeFileSync(COOKIE_FILE, JSON.stringify(store, null, 2));
console.error(`[session-capture] saved ${cookies.length} cookies for ${siteId} → ${COOKIE_FILE}`);

await browser.close();
