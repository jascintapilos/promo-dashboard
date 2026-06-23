#!/usr/bin/env node
/**
 * Launches Chrome, opens Smartico login, waits for the user to complete
 * login + 2FA, then saves the session token to smartico-session.local.json.
 *
 * The token lives in localStorage.userInfo.token (36-char UUID).
 * It is passed as Authorization: <token> on every API request.
 *
 * Usage:
 *   node bin/capture-smartico-session.mjs
 *
 * The browser window stays open until a token is detected, then closes
 * automatically. If you close the window first, the script exits with an error.
 */
import { chromium } from 'playwright';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SESSION_FILE = path.resolve('smartico-session.local.json');
const LOGIN_URL = 'https://drive-6.smartico.ai/24016#/login';
const POLL_MS = 2000;
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

console.log('Opening Chrome → Smartico login page.');
console.log('Please log in (username + password + 2FA code).');
console.log('The window will close automatically once your session is detected.\n');

const browser = await chromium.launch({ headless: false, channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

let token = null;
const deadline = Date.now() + TIMEOUT_MS;

while (!token && Date.now() < deadline) {
  await page.waitForTimeout(POLL_MS);
  try {
    token = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('userInfo');
        if (!raw) return null;
        const obj = JSON.parse(raw);
        return obj?.token || null;
      } catch { return null; }
    });
  } catch {
    // browser closed or page navigated — exit loop
    break;
  }
  if (token) {
    console.log(`Session token detected (${token.slice(0, 8)}…). Saving.`);
  } else {
    process.stdout.write('.');
  }
}

await browser.close().catch(() => {});

if (!token) {
  console.error('\nNo token found — was login completed within 5 minutes?');
  process.exit(1);
}

const store = existsSync(SESSION_FILE)
  ? JSON.parse(readFileSync(SESSION_FILE, 'utf8'))
  : {};

store.token = token;
store.capturedAt = new Date().toISOString();

writeFileSync(SESSION_FILE, JSON.stringify(store, null, 2));
console.log(`\nSaved → ${SESSION_FILE}`);
console.log('Run probe-smartico-campaigns.mjs to verify the token works.');
