#!/usr/bin/env node
// Captures a GM01 (CMM ACE / UNTUNG28) BO session via Playwright.
// Pre-fills username + password; the CAPTCHA must be entered manually in the browser window.
// Saves cookies to `gm01-session.local.json` (gitignored).
//
//   node bin/gm01-session-capture.mjs
//   node bin/gm01-session-capture.mjs --user=***REMOVED*** --pass=***REMOVED***

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const SESSION_FILE = path.resolve('gm01-session.local.json');
const BASE_URL = 'https://utn.bo5w.com';
const LOGIN_URL = `${BASE_URL}/`;
const WAIT_MS = 10 * 60 * 1000; // 10 min

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] ?? true;
}

const username = args.user || args.username || null;
const password = args.pass || args.password || null;

console.log('[gm01-session] Launching Chrome → GM01 BO login');

const browser = await chromium.launch({ headless: false, channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

// Pre-fill credentials if provided
if (username && password) {
  await page.waitForSelector('input[name="j_username"]', { timeout: 10000 });
  await page.fill('input[name="j_username"]', username);
  await page.fill('input[name="j_password"]', password);
  console.log(`[gm01-session] Filled credentials for: ${username}`);
  console.log('[gm01-session] ─────────────────────────────────────────────────────────');
  console.log('[gm01-session]  Browser window is open. Enter the CAPTCHA code and click Login.');
  console.log('[gm01-session]  (waiting up to 10 minutes)');
  console.log('[gm01-session] ─────────────────────────────────────────────────────────');
} else {
  console.log('[gm01-session] No credentials supplied — log in manually in the browser window.');
}

function isLoggedIn(url) {
  return url.startsWith(BASE_URL) && !/\/j_spring_security_check/.test(url) && !url.endsWith('/') && !url.endsWith('/login');
}

// Wait for navigation away from login
const deadline = Date.now() + WAIT_MS;
let loggedIn = false;
while (Date.now() < deadline) {
  const currentUrl = page.url();
  if (isLoggedIn(currentUrl)) { loggedIn = true; break; }
  await page.waitForTimeout(1500);
}

if (!loggedIn) {
  console.error('[gm01-session] ✗ Timed out waiting for login. Re-run when ready.');
  await browser.close();
  process.exit(1);
}

console.log(`[gm01-session] ✓ Logged in — landed on ${page.url()}`);

const cookies = await ctx.cookies();
const storage = { cookies, capturedAt: new Date().toISOString(), baseUrl: BASE_URL };
writeFileSync(SESSION_FILE, JSON.stringify(storage, null, 2));
console.log(`[gm01-session] ✓ Session saved → ${SESSION_FILE}`);

await browser.close();
process.exit(0);
