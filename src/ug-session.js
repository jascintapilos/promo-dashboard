// Session persistence for the UG BO (3MPLAY-NS3 — SBO28/UG01, MENANG7/UG02).
//
// Replaces the AdsPower/CDP dependency: launches our own local Chromium.
//   - No saved session file  -> opens a HEADED browser, waits for a human to
//     log in (password + CAPTCHA), then saves cookies + localStorage
//     (via Playwright's storageState) + sessionStorage (custom, since
//     storageState does not capture it) to <brand>-session.local.json.
//   - Saved session file present -> restores it into a fresh context and
//     skips the login screen. If the saved session turns out to be expired,
//     automatically falls back to the interactive headed flow and re-saves.
//
// Session files match the project's existing `*.local.json` gitignore rule —
// never commit them (see CLAUDE.md "Protected files").

import { chromium } from 'playwright';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export const BO_BASE = 'https://3m-ns3-admin.com';
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000; // 10 min to complete manual login + CAPTCHA

export function sessionFilePath(brand) {
  return path.join(ROOT, `${brand.toLowerCase()}-session.local.json`);
}

function isLoggedInUrl(url) {
  return /3m-ns3-admin\.com\/(dashboard|Website|Member|Transaction)/i.test(url) && !/login/i.test(url);
}

async function isOnDashboard(page) {
  if (isLoggedInUrl(page.url())) return true;
  return page.locator('text=/Welcome Agent/i').first().isVisible().catch(() => false);
}

async function waitForManualLogin(page) {
  console.log('\n─────────────────────────────────────────────────────────');
  console.log(' A browser window has opened on your desktop.');
  console.log(' Please log in manually: username, password, and the');
  console.log(' "Validation" CAPTCHA image, then click LOG IN.');
  console.log(' This script detects the dashboard and continues automatically.');
  console.log(`  (waiting up to ${LOGIN_TIMEOUT_MS / 60000} minutes)`);
  console.log('─────────────────────────────────────────────────────────\n');

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isOnDashboard(page)) return true;
    await page.waitForTimeout(2000);
  }
  return false;
}

async function captureSessionStorage(page) {
  return page.evaluate(() => {
    const out = {};
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      out[k] = sessionStorage.getItem(k);
    }
    return out;
  });
}

async function saveSession(context, page, file) {
  const state = await context.storageState(); // cookies + localStorage per origin
  state.sessionStorage = await captureSessionStorage(page); // custom extension
  writeFileSync(file, JSON.stringify(state, null, 2));
}

function loadSavedState(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

async function validateSession(context) {
  const page = await context.newPage();
  await page.goto(`${BO_BASE}/Website/BannerSetting`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return { ok: isLoggedInUrl(page.url()), page };
}

/**
 * Returns { browser, context, page } authenticated against the UG BO.
 * Caller owns the browser and should call browser.close() when fully done.
 */
export async function getUgPage({ brand = 'UG01', headless = true, headed = false } = {}) {
  const file = sessionFilePath(brand);
  const wantHeaded = headed && !headless; // explicit --headed override, handled by caller

  if (existsSync(file)) {
    console.log(`✓ found saved session: ${path.basename(file)}`);
    const state = loadSavedState(file);
    const browser = await chromium.launch({ headless: wantHeaded ? false : headless });
    const context = await browser.newContext({ storageState: state });
    if (state.sessionStorage && Object.keys(state.sessionStorage).length) {
      await context.addInitScript((entries) => {
        for (const [k, v] of Object.entries(entries)) {
          try { window.sessionStorage.setItem(k, v); } catch {}
        }
      }, state.sessionStorage);
    }
    const { ok, page } = await validateSession(context);
    if (ok) {
      console.log('✓ saved session is still valid — skipped login');
      return { browser, context, page };
    }
    console.log('⚠ saved session expired — falling back to manual login');
    await page.close();
    await context.close();
    await browser.close();
  }

  // Interactive path: always headed so a human can see + solve the CAPTCHA
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BO_BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const loggedIn = await waitForManualLogin(page);
  if (!loggedIn) {
    await browser.close();
    throw new Error(`Timed out waiting for manual login (${LOGIN_TIMEOUT_MS / 60000} min). Re-run when ready.`);
  }

  await saveSession(context, page, file);
  console.log(`✓ logged in — session saved to ${path.basename(file)}`);
  return { browser, context, page };
}
