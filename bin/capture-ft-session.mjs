#!/usr/bin/env node
/**
 * Captures a FastTrack CRM session token for one of three instances.
 *
 * Default: fully headless — navigates to FT login, enters email, reads the
 * OTP from Gmail automatically (no human interaction required).
 * Requires gmail.readonly OAuth scope (run `node bin/sheets-oauth.mjs` once
 * to re-consent if you haven't already, then enable Gmail API in GCP).
 *
 * Fallback: --manual — opens a visible browser window, waits for you to
 * complete the OTP login yourself. Use if Gmail auto-OTP fails.
 *
 * Instances:
 *   ws1    → https://mb8.ft-crm.com              (WS1 & WS2)
 *   qpro1  → https://alpha-iota-qp1.ft-crm.com   (QPRO1)
 *   qp2    → https://alpha-iota-qp2.ft-crm.com/v2 (QP2A–D)
 *
 * Usage:
 *   node bin/capture-ft-session.mjs --instance ws1
 *   node bin/capture-ft-session.mjs --instance ws1 --manual
 */
import { chromium } from 'playwright';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { parseArgs } from './_args.js';
import { waitForFtOtp } from '../src/gmail-otp.js';
import { hasTotpSecret, generateTotp } from '../src/totp.js';

const { flags } = parseArgs(process.argv.slice(2));
const INSTANCE = flags.instance || 'ws1';
const MANUAL   = flags.manual === true;

const INSTANCES = {
  ws1:   { url: 'https://mb8.ft-crm.com/',                    label: 'WS1/WS2' },
  qpro1: { url: 'https://alpha-iota-qp1.ft-crm.com/',         label: 'QPRO1' },
  qp2:   { url: 'https://alpha-iota-qp2.ft-crm.com/v2/',      label: 'QP2A–D' },
};

// Email used for FT login OTP (all three instances)
const FT_LOGIN_EMAIL = 'jascinta.pilos@thebrandingpeople.co';

if (!INSTANCES[INSTANCE]) {
  console.error(`Unknown instance "${INSTANCE}". Use: ws1 | qpro1 | qp2`);
  process.exit(1);
}

const { url: LOGIN_URL, label } = INSTANCES[INSTANCE];
const SESSION_FILE = path.resolve(`ft-session-${INSTANCE}.local.json`);
const PROFILE_FILE = path.resolve(`ft-profile-${INSTANCE}.local.json`);
const POLL_MS      = 2000;
const TIMEOUT_MS   = MANUAL ? 10 * 60 * 1000 : 3 * 60 * 1000;

console.log(`\nCapturing FastTrack CRM session — ${label} (${INSTANCE})`);
console.log(`Mode: ${MANUAL ? 'MANUAL (headed browser)' : 'AUTO (headless + Gmail OTP)'}\n`);

// Load existing profile if available (helps silent SSO chain)
const existingProfile = existsSync(PROFILE_FILE)
  ? JSON.parse(readFileSync(PROFILE_FILE, 'utf8'))
  : null;

const browser = await chromium.launch({
  headless: !MANUAL,
  channel: 'chrome',
  // In manual mode slow things down so actions are visible
  slowMo: MANUAL ? 100 : 0,
});

const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  // In manual mode start fresh (no stored cookies) so login page is obvious
  ...(!MANUAL && existingProfile?.storageState ? { storageState: existingProfile.storageState } : {}),
});
const page = await ctx.newPage();

let captured = null;

if (MANUAL) {
  // ── Manual mode: show browser, wait for user ──────────────────────────────
  console.log('A browser window is open. Complete the full login:');
  console.log('  1. Click Login on the FT page');
  console.log('  2. Enter email + click Continue');
  console.log('  3. Enter the email OTP code');
  console.log('  4. Enter your Google Authenticator code');
  console.log('The window will close automatically once portaltoken is detected.\n');

  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

  const host     = new URL(LOGIN_URL).hostname;
  const deadline = Date.now() + TIMEOUT_MS;
  let dotCount   = 0;
  while (!captured && Date.now() < deadline) {
    await page.waitForTimeout(POLL_MS);
    try {
      dotCount++;
      if (dotCount % 15 === 0) process.stdout.write(`\n  [${page.url().slice(0, 80)}]`);
      else process.stdout.write('.');

      // Detect by portaltoken cookie — reliable regardless of URL path
      const cookies = await ctx.cookies();
      const portal  = cookies.find(c => c.name === 'portaltoken' && c.domain.includes(host));
      if (portal?.value) {
        process.stdout.write('\n');
        console.log(`portaltoken detected!`);
        captured = await extractSession(page, ctx, LOGIN_URL);
      }
    } catch (_) { process.stdout.write('?'); }
  }

} else {
  // ── Auto mode: headless + Gmail OTP ──────────────────────────────────────
  try {
    captured = await autoLogin(page, ctx, LOGIN_URL);
  } catch (e) {
    console.error(`\nAuto-login failed: ${e.message}`);
    console.error('Re-run with --manual to complete login interactively.');
    await browser.close().catch(() => {});
    process.exit(1);
  }
}

await browser.close().catch(() => {});

if (!captured) {
  console.error('\nNo session token found within timeout.');
  process.exit(1);
}

// ── Save session + profile ────────────────────────────────────────────────

const store = {
  instance:     INSTANCE,
  label,
  loginUrl:     LOGIN_URL,
  tokenKey:     captured.key,
  token:        captured.value,
  localStorage: captured.all,
  cookies:      captured.cookies || [],
  capturedAt:   new Date().toISOString(),
};

writeFileSync(SESSION_FILE, JSON.stringify(store, null, 2));
console.log(`Session saved → ${SESSION_FILE}`);

if (captured.storageState) {
  writeFileSync(PROFILE_FILE, JSON.stringify({
    instance:     INSTANCE,
    label,
    loginUrl:     LOGIN_URL,
    storageState: captured.storageState,
    capturedAt:   new Date().toISOString(),
  }, null, 2));
  console.log(`Profile saved  → ${PROFILE_FILE}`);
}

console.log('\nDone.');

// ── Helpers ───────────────────────────────────────────────────────────────

async function autoLogin(page, ctx, loginUrl) {
  const host = new URL(loginUrl).hostname;

  console.log('Navigating to FT login page…');
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // If we land directly on the dashboard, check whether the API token still works.
  // The browser UI can stay alive on session cookies while the portaltoken is
  // revoked server-side (FT CRM rotates it on each login; ~8h server TTL).
  if (await isLoggedIn(page, loginUrl)) {
    const host = new URL(loginUrl).hostname;
    const cookies = await ctx.cookies();
    const portalCookie = cookies.find(c => c.name === 'portaltoken' && c.domain.includes(host));
    if (portalCookie?.value && await isPortalTokenValid(loginUrl, portalCookie.value)) {
      console.log('Stored session still valid — no login needed.');
      return extractSession(page, ctx, loginUrl);
    }
    // Token expired server-side — strip it so isLoggedIn returns false and we
    // fall through to the normal login flow below.
    console.log('Stored session detected but API token expired — forcing fresh login…');
    await ctx.clearCookies();
    await ctx.addCookies(cookies.filter(c => c.name !== 'portaltoken'));
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  // The FT React app may load the shell first and async-check auth (taking 2-15s).
  // Wait for one of three states to resolve before trying to interact:
  //   1. portaltoken appears → already authenticated (silent SSO success)
  //   2. Login button appears on the FT app page → click it to reach signin.ft-crm.com
  //   3. Redirect to signin.ft-crm.com → WorkOS is asking for credentials
  console.log('Waiting for auth state to resolve…');
  const authState = await waitForAuthState(page, ctx, loginUrl, 15000);
  console.log(`  → auth state: ${authState}`);

  if (authState === 'logged-in') {
    console.log('Silently authenticated — no OTP needed.');
    return extractSession(page, ctx, loginUrl);
  }

  // Now we must be on signin.ft-crm.com or the FT login page with a Login button.
  // If a Login button is visible on the FT app page, click it first.
  // Use waitForSelector (up to 8s) so React has time to render before we give up.
  const loginBtn = await page.waitForSelector(
    'button:has-text("Login"), a:has-text("Login"), button:has-text("Sign in")',
    { timeout: 8000 }
  ).catch(() => null);
  if (loginBtn) {
    // Expired WorkOS session cookies cause the redirect chain to loop back to the FT
    // login page instead of landing on the email form. Clear them first so WorkOS
    // treats this as a fresh auth request.
    const allCookies = await ctx.cookies();
    const staleCount = allCookies.filter(c =>
      c.domain.includes('signin.ft-crm') || c.domain.includes('authapi.ft-crm')
    ).length;
    if (staleCount) {
      await ctx.clearCookies();
      await ctx.addCookies(allCookies.filter(c =>
        !c.domain.includes('signin.ft-crm') && !c.domain.includes('authapi.ft-crm')
      ));
      console.log(`  Cleared ${staleCount} stale WorkOS auth cookies.`);
    }

    console.log('Clicking Login button…');
    await loginBtn.click();
    // Wait for the redirect chain (FT → WorkOS → authapi → signin.ft-crm.com) to settle
    // instead of a fixed sleep — the chain can take 6–12s with a fresh cookie slate.
    await page.waitForURL('**/signin.ft-crm.com/**', { timeout: 15000 }).catch(() => {});
  }

  // Fill email field (now on signin.ft-crm.com or similar WorkOS page)
  console.log(`Entering email: ${FT_LOGIN_EMAIL}`);
  const emailInput = await findInput(page, [
    'input[type="email"]',
    'input[name="email"]',
    'input[placeholder*="email" i]',
  ]);
  if (!emailInput) throw new Error(`Could not find email input. Current URL: ${page.url()}`);
  await emailInput.fill(FT_LOGIN_EMAIL);

  // Record time before clicking Send so Gmail search is tight
  const otpRequestedAt = Date.now();

  // Click Continue (email OTP — NOT "Continue with Google")
  console.log('Clicking Continue (email OTP)…');
  const submitBtn = await findClickable(page, [
    'button[type="submit"]:not(:has-text("Google"))',
    'button:has-text("Continue"):not(:has-text("Google"))',
    'button:has-text("Send")',
    'button:has-text("Get code")',
    'button[type="submit"]',
  ]);
  if (!submitBtn) throw new Error('Could not find Continue button on login page.');
  await submitBtn.click();

  // Wait briefly for the OTP page to load
  await page.waitForTimeout(2000);

  // Check if we're already logged in (SSO completed silently)
  if (await isLoggedIn(page, loginUrl)) {
    console.log('SSO completed silently — no OTP needed.');
    return extractSession(page, ctx, loginUrl);
  }

  // Fetch OTP from Gmail
  console.log('Fetching OTP from Gmail…');
  const otp = await waitForFtOtp({ afterMs: otpRequestedAt });

  // Enter OTP — WorkOS uses either a single input or 6 individual digit boxes
  console.log(`Entering OTP: ${otp}`);
  await enterOtp(page, otp);

  // Wait briefly — WorkOS may now show the TOTP/authenticator screen
  await page.waitForTimeout(2500);

  // Handle TOTP (authenticator app) step if it appears
  if (await isTotpPrompt(page)) {
    const totpCode = hasTotpSecret(INSTANCE)
      ? generateTotp(INSTANCE)
      : await promptTotpCode(INSTANCE);
    console.log(`Entering TOTP code: ${totpCode}`);
    await enterOtp(page, totpCode);
    await page.waitForTimeout(2000);
  }

  // Wait for redirect back to FT app — allow extra time for /v3/login/ chained redirect
  console.log('Waiting for login to complete…');
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    const cur = page.url();
    console.log(`  url: ${cur.slice(0, 90)}`);
    if (await isLoggedIn(page, loginUrl)) break;
    // Still on signin domain? Try handling another TOTP/OTP prompt that might have appeared
    if (cur.includes('signin.ft-crm.com') && await isTotpPrompt(page)) {
      const totpCode = hasTotpSecret(INSTANCE)
        ? generateTotp(INSTANCE)
        : await promptTotpCode(INSTANCE);
      console.log('Late TOTP prompt — entering code…');
      await enterOtp(page, totpCode);
      await page.waitForTimeout(3000);
    }
  }

  if (!(await isLoggedIn(page, loginUrl))) {
    throw new Error(`Still on login page after OTP entry. Current URL: ${page.url()}`);
  }

  return extractSession(page, ctx, loginUrl);
}

async function enterOtp(page, otp) {
  // WorkOS magic-code page: 6 individual maxlength=1 inputs that auto-submit
  // when all digits are filled. Use Locator API (pressSequentially fires key events).
  const digitLoc = page.locator('input[maxlength="1"]');
  const digitCount = await digitLoc.count().catch(() => 0);
  if (digitCount >= otp.length) {
    for (let i = 0; i < Math.min(otp.length, digitCount); i++) {
      await digitLoc.nth(i).click();
      await digitLoc.nth(i).pressSequentially(otp[i], { delay: 60 });
      await page.waitForTimeout(80);
    }
    // Give WorkOS time to auto-submit
    await page.waitForTimeout(1500);
    return;
  }

  // Single one-time-code input
  const singleLoc = page.locator('input[autocomplete="one-time-code"], input[name="code"], input[id="code"]').first();
  if (await singleLoc.count().catch(() => 0) > 0) {
    await singleLoc.click();
    await singleLoc.pressSequentially(otp, { delay: 60 });
    await page.waitForTimeout(500);
    const btnLoc = page.locator('button[type="submit"]').first();
    if (await btnLoc.count().catch(() => 0) > 0) await btnLoc.click();
    return;
  }

  // Fallback: keyboard type into focused element
  await page.keyboard.type(otp, { delay: 60 });
  await page.waitForTimeout(500);
  const btnLoc2 = page.locator('button[type="submit"]').first();
  if (await btnLoc2.count().catch(() => 0) > 0) await btnLoc2.click();
}

// Wait until auth state resolves: 'logged-in' | 'needs-login'
// The FT React app does an async session check; don't interact until one of:
//   - portaltoken appears (logged in)
//   - Login button appears on the FT domain (must click to proceed)
//   - Page redirects to signin.ft-crm.com (must enter credentials)
async function waitForAuthState(page, ctx, loginUrl, maxMs = 15000) {
  const host     = new URL(loginUrl).hostname;
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1500);
    const url = page.url();
    // Redirected to signin page — needs login
    if (url.includes('signin.ft-crm.com') || url.includes('/login') || url.includes('/signin')) {
      return 'needs-login';
    }
    // Login button appeared on FT app — needs login
    try {
      const btn = await page.$('button:has-text("Login"), a:has-text("Login"), button:has-text("Sign in")');
      if (btn && await btn.isVisible()) return 'needs-login';
    } catch (_) {}
    // portaltoken appeared — silently authenticated
    try {
      const cookies = await ctx.cookies();
      if (cookies.find(c => c.name === 'portaltoken' && c.domain.includes(host) && c.value)) {
        return 'logged-in';
      }
    } catch (_) {}
  }
  // Timeout — still no login button or portaltoken; treat as needs-login (will show email input error if state is unclear)
  return 'needs-login';
}

async function isPortalTokenValid(loginUrl, token) {
  const base = new URL(loginUrl).origin;
  try {
    const res = await fetch(`${base}/crm-api/Authentication/AdminUsers`, {
      headers: { authtoken: token, Accept: 'application/json' },
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    // Success:false with "expired" error = token revoked; Success:true (even Data:[]) = valid
    return data?.Success !== false;
  } catch {
    return false;
  }
}

async function isLoggedIn(page, loginUrl) {
  const host = new URL(loginUrl).hostname;
  const url  = page.url();
  if (!url.includes(host)) return false;
  if (url.includes('/login') || url.includes('/signin') || url.includes('signin.ft-crm.com')) return false;
  try {
    const hasLoginBtn = await page.$('button:has-text("Login"), button:has-text("Sign in")');
    if (hasLoginBtn) return false;
  } catch (_) {}
  // Must also have a portaltoken cookie — without it the API won't work
  try {
    const ctx     = page.context();
    const cookies = await ctx.cookies();
    const portal  = cookies.find(c => c.name === 'portaltoken' && c.domain.includes(host));
    if (!portal?.value) return false;
  } catch (_) {}
  return true;
}

async function extractSession(page, ctx, loginUrl) {
  await page.waitForTimeout(2000);
  const host    = new URL(loginUrl).hostname;
  const cookies = await ctx.cookies();
  const lsAll   = await page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      out[k] = localStorage.getItem(k);
    }
    return out;
  }).catch(() => ({}));

  console.log(`\nLogged in! URL: ${page.url()}`);
  const storageState = await ctx.storageState().catch(() => null);
  const mainCookies  = cookies.filter(c => c.domain.includes(host) && c.value.length > 10);
  const bestCookie   = mainCookies[0];

  return {
    key:  bestCookie ? `cookie:${bestCookie.name}` : 'localStorage',
    value: bestCookie ? bestCookie.value : Object.values(lsAll)[0] || '',
    all:  lsAll,
    cookies,
    storageState,
  };
}

async function findInput(page, selectors) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) return el;
    } catch (_) {}
  }
  return null;
}

async function findClickable(page, selectors) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) return el;
    } catch (_) {}
  }
  return null;
}

// Detect if the current page is asking for an authenticator (TOTP) code,
// as opposed to the email OTP page (which we already handled).
// Ask for TOTP code interactively when running in a terminal.
// If stdin is not a TTY (e.g. scheduled task), exits with a clear error.
async function promptTotpCode(instance) {
  if (!process.stdin.isTTY) {
    throw new Error(
      `TOTP required for "${instance}" but running non-interactively.\n` +
      `Run manually in a terminal: node bin/capture-ft-session.mjs --instance=${instance}`
    );
  }
  console.log('\n──────────────────────────────────────────');
  console.log(` Authenticator code required for: ${instance}`);
  console.log(' Open your authenticator app and enter the');
  console.log(' 6-digit code for "Fast Track CRM".');
  console.log('──────────────────────────────────────────');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve, reject) => {
    rl.question('  Code: ', (answer) => {
      rl.close();
      const code = answer.trim().replace(/\s+/g, '');
      if (!/^\d{6,8}$/.test(code)) reject(new Error(`Invalid TOTP code: "${code}"`));
      else resolve(code);
    });
    setTimeout(() => { rl.close(); reject(new Error('TOTP prompt timed out (60s)')); }, 60_000);
  });
}

async function isTotpPrompt(page) {
  try {
    // WorkOS MFA verification URL is the most reliable signal
    if (page.url().includes('/mfa/')) return true;
    const text = await page.evaluate(() => document.body.innerText);
    return /authenticat|verify your identity|two.factor|2fa|totp/i.test(text)
      && !/enter.*code.*email|email.*code|we.?ve sent/i.test(text);
  } catch (_) {
    return false;
  }
}
