#!/usr/bin/env node
// Captures a GM01 (CMM ACE / UNTUNG28) BO session via Playwright and saves it
// using Playwright's authentication-state feature (storageState).
//
// A visible browser opens with the username + password pre-filled; YOU enter
// the CAPTCHA and click Login. The script never solves, bypasses, or outsources
// the CAPTCHA. On success it saves the authorized browser state to
// gm01-storage-state.local.json (gitignored, VDI-only) for reuse by later runs.
//
//   node bin/gm01-session-capture.mjs
//   node bin/gm01-session-capture.mjs --user=<user> --pass=<pass>
//
// Secrets: the password is read from --pass and typed into the field only; it
// is never printed. Cookies/tokens/session contents are never logged.

import { chromium } from 'playwright';
import { mkdirSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT               = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORAGE_STATE_FILE = path.join(ROOT, 'gm01-storage-state.local.json');
const DEAD_FLAG          = path.join(ROOT, 'gm01-session-dead.local.json');
const CREDS_FILE         = path.join(ROOT, 'gm01-credentials.local.json');
const SHOT_DIR = path.join(ROOT, 'captures');
const BASE_URL = 'https://utn.bo5w.com';
const LOGIN_URL = `${BASE_URL}/`;
const WAIT_MS = 10 * 60 * 1000; // 10 min for the user to complete login

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] ?? true;
}

// Credentials: CLI args first, then gm01-credentials.local.json (gitignored).
// Pre-filling only saves typing — you still solve the CAPTCHA manually.
function loadCredsFile() {
  if (existsSync(CREDS_FILE)) {
    try { return JSON.parse(readFileSync(CREDS_FILE, 'utf8')); } catch { /* fall through */ }
  }
  return {};
}
const savedCreds = loadCredsFile();
const username = args.user || args.username || savedCreds.user || null;
const password = args.pass || args.password || savedCreds.pass || null;

function isLoggedIn(url) {
  return url.startsWith(BASE_URL)
    && !/\/j_spring_security_check/.test(url)
    && !url.endsWith('/')
    && !url.endsWith('/login');
}

async function screenshot(page, label) {
  try {
    mkdirSync(SHOT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(SHOT_DIR, `gm01-${label}-${stamp}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.error(`[gm01-session] Saved screenshot → captures/${path.basename(file)}`);
  } catch { /* best-effort */ }
}

console.log('[gm01-session] Launching Chrome → GM01 BO login');

const browser = await chromium.launch({ headless: false, channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

try {
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  if (username && password) {
    await page.waitForSelector('input[name="j_username"]', { timeout: 10_000 });
    await page.fill('input[name="j_username"]', username);
    await page.fill('input[name="j_password"]', password); // typed only, never logged
    console.log(`[gm01-session] Credentials pre-filled for: ${username}`);
  } else {
    console.log('[gm01-session] No credentials supplied — log in manually in the window.');
  }

  console.log('[gm01-session] ─────────────────────────────────────────────────────────');
  console.log('[gm01-session]  Enter the CAPTCHA code and click Login.');
  console.log(`[gm01-session]  (waiting up to ${WAIT_MS / 60000} minutes)`);
  console.log('[gm01-session] ─────────────────────────────────────────────────────────');

  const deadline = Date.now() + WAIT_MS;
  let loggedIn = false;
  while (Date.now() < deadline) {
    if (isLoggedIn(page.url())) { loggedIn = true; break; }
    await page.waitForTimeout(1500);
  }

  if (!loggedIn) {
    await screenshot(page, 'login-timeout');
    console.error('[gm01-session] ✗ Timed out waiting for login. Re-run when ready.');
    await browser.close();
    process.exit(1);
  }

  console.log(`[gm01-session] ✓ Logged in — landed on ${page.url()}`);

  // Save the authorized state via Playwright's storageState feature.
  await ctx.storageState({ path: STORAGE_STATE_FILE });
  console.log('[gm01-session] ✓ Authorized session saved (gm01-storage-state.local.json)');
  // Clear the session-dead flag so subsequent runs don't block.
  try { if (existsSync(DEAD_FLAG)) unlinkSync(DEAD_FLAG); } catch { /* best-effort */ }

  await browser.close();
  process.exit(0);
} catch (err) {
  await screenshot(page, 'capture-error');
  console.error(`[gm01-session] ✗ Capture failed: ${err.message}`);
  await browser.close().catch(() => {});
  process.exit(1);
}
