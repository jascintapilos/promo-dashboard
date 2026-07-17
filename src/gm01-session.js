// GM01 (UNTUNG28) authenticated-session helper.
//
// Uses Playwright's saved authentication-state feature (storageState) so a
// human logs in + solves the CAPTCHA ONCE in a visible browser; later runs
// reuse that authorized state. Requests go through the browser context's own
// request API, so the framework applies the saved cookies automatically —
// cookie values are never read or copied by hand.
//
// SECURITY:
//   • The saved state lives only in gm01-storage-state.local.json on this VDI.
//   • `*.local.json` and `captures/` are already gitignored — never committed.
//   • This module never logs passwords, cookies, tokens, or session contents.
//   • The CAPTCHA is always solved manually by the user. Nothing here solves,
//     bypasses, suppresses, evades, or outsources it.

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const BASE = 'https://utn.bo5w.com';
export const STORAGE_STATE_FILE = path.join(ROOT, 'gm01-storage-state.local.json');
const CAPTURE_SCRIPT = path.join(ROOT, 'bin', 'gm01-session-capture.mjs');
const SHOT_DIR = path.join(ROOT, 'captures');

const DEFAULT_TIMEOUT = 20_000;

export function hasSavedState() {
  return existsSync(STORAGE_STATE_FILE);
}

/**
 * Launch a headless browser context pre-loaded with the saved auth state.
 * Caller is responsible for closing `browser`.
 */
export async function openAuthedContext({ headless = true } = {}) {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext(
    hasSavedState() ? { storageState: STORAGE_STATE_FILE } : {}
  );
  context.setDefaultTimeout(DEFAULT_TIMEOUT);
  return { browser, context };
}

/**
 * Verify the account is still authenticated. Hits a secured page through the
 * context request API (saved cookies applied by Playwright) and treats a
 * redirect to the login page as "expired". No cookie handling here.
 */
export async function isAuthenticated(context) {
  try {
    const res = await context.request.get(`${BASE}/secure/home.xhtml`, {
      maxRedirects: 0,
      timeout: DEFAULT_TIMEOUT,
    });
    return res.status() === 200;
  } catch {
    return false;
  }
}

/**
 * Run the interactive (visible) login so the user enters credentials and the
 * CAPTCHA themselves. Returns true when the capture script saved fresh state.
 * This function never touches the CAPTCHA — it only opens the window and waits.
 */
export function captureInteractively({ user, pass } = {}) {
  const args = [CAPTURE_SCRIPT];
  if (user) args.push(`--user=${user}`);
  if (pass) args.push(`--pass=${pass}`);
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: ROOT });
  return r.status === 0;
}

/**
 * Ensure a live, authenticated context is available.
 *   • Loads saved state and verifies it.
 *   • If missing/expired: closes, PAUSES for manual login (visible browser),
 *     then reopens with the refreshed state and re-verifies.
 * Returns { browser, context }; caller closes `browser`.
 */
export async function ensureAuthenticated({ headless = true, user, pass } = {}) {
  let { browser, context } = await openAuthedContext({ headless });

  if (hasSavedState() && (await isAuthenticated(context))) {
    return { browser, context };
  }

  // Missing or expired — never proceed silently. Prompt manual authentication.
  await browser.close();
  console.log('\n[gm01-session] No valid saved session — manual login required.');
  console.log('[gm01-session] A browser window will open. Enter your credentials and');
  console.log('[gm01-session] complete the CAPTCHA yourself, then click Login.\n');

  const ok = captureInteractively({ user, pass });
  if (!ok) throw new Error('Interactive login was cancelled or timed out.');

  ({ browser, context } = await openAuthedContext({ headless }));
  if (!(await isAuthenticated(context))) {
    await failScreenshot(context, 'auth-verify-failed');
    await browser.close();
    throw new Error('Session still not authenticated after manual login.');
  }
  console.log('[gm01-session] ✓ Authenticated with refreshed session.\n');
  return { browser, context };
}

/**
 * Save a full-page screenshot to captures/ (gitignored) for debugging.
 * Best-effort; never throws and never writes secrets.
 */
export async function failScreenshot(context, label = 'failure') {
  try {
    mkdirSync(SHOT_DIR, { recursive: true });
    const page = context.pages()[0] || (await context.newPage());
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(SHOT_DIR, `gm01-${label}-${stamp}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.error(`[gm01-session] Saved failure screenshot → captures/${path.basename(file)}`);
  } catch {
    /* screenshots are best-effort */
  }
}
