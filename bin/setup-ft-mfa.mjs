#!/usr/bin/env node
/**
 * One-time setup: extract the TOTP secret for a FastTrack CRM instance.
 *
 * NO interactive prompts — just follow the on-screen instructions in the terminal
 * while completing steps in the browser window.
 *
 * What it does:
 *   1. Opens a headed Chrome window — log in with email OTP + authenticator code.
 *   2. After login, polls until it finds MFA settings page.
 *   3. Waits for you to add a new authenticator and show the QR code.
 *   4. Auto-extracts the secret key from the QR code page.
 *   5. Saves to ft-totp-secrets.local.json (gitignored).
 *
 * Usage:
 *   node bin/setup-ft-mfa.mjs --instance=ws1
 *   node bin/setup-ft-mfa.mjs --instance=qpro1
 *   node bin/setup-ft-mfa.mjs --instance=qp2
 */
import { chromium } from 'playwright';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const INSTANCE = flags.instance || 'ws1';

const INSTANCES = {
  ws1:   { url: 'https://mb8.ft-crm.com/',                 label: 'WS1/WS2' },
  qpro1: { url: 'https://alpha-iota-qp1.ft-crm.com/',      label: 'QPRO1' },
  qp2:   { url: 'https://alpha-iota-qp2.ft-crm.com/v2/',   label: 'QP2A–D' },
};

if (!INSTANCES[INSTANCE]) {
  console.error(`Unknown instance: ${INSTANCE}. Use: ws1 | qpro1 | qp2`);
  process.exit(1);
}

const SECRETS_FILE = path.resolve('ft-totp-secrets.local.json');
const SESSION_FILE = path.resolve(`ft-session-${INSTANCE}.local.json`);
const PROFILE_FILE = path.resolve(`ft-profile-${INSTANCE}.local.json`);
const { url: LOGIN_URL, label } = INSTANCES[INSTANCE];
const host = new URL(LOGIN_URL).hostname;

console.log(`\n═══════════════════════════════════════════`);
console.log(` FT MFA Setup — ${label} (${INSTANCE})`);
console.log(`═══════════════════════════════════════════\n`);
console.log(`This runs ONCE to extract your TOTP secret.`);
console.log(`After this, logins are fully automatic.\n`);

// Load existing profile if available
const existingProfile = existsSync(PROFILE_FILE)
  ? JSON.parse(readFileSync(PROFILE_FILE, 'utf8'))
  : null;

const browser = await chromium.launch({ headless: false, channel: 'chrome' });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  ...(existingProfile?.storageState ? { storageState: existingProfile.storageState } : {}),
});
const page = await ctx.newPage();

// ── Step 1: Log in ────────────────────────────────────────────────────────────

console.log(`STEP 1: Log in to ${label}`);
console.log(`        Browser is opening — complete the login (email OTP + authenticator code).\n`);

await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

console.log(`Waiting for login to complete (up to 10 minutes)…`);
await waitUntilLoggedIn(page, LOGIN_URL, 10 * 60_000);
console.log(`✅ Logged in.\n`);

// Save session/profile so this login isn't wasted
const cookies      = await ctx.cookies();
const lsAll        = await page.evaluate(() => {
  const o = {};
  for (let i = 0; i < localStorage.length; i++) o[localStorage.key(i)] = localStorage.getItem(localStorage.key(i));
  return o;
}).catch(() => ({}));
const storageState = await ctx.storageState().catch(() => null);
const mainCookies  = cookies.filter(c => c.domain.includes(host) && c.value.length > 10);
const portalCookie = cookies.find(c => c.name === 'portaltoken' && c.domain.includes(host));

if (portalCookie?.value) {
  writeFileSync(SESSION_FILE, JSON.stringify({
    instance: INSTANCE, label, loginUrl: LOGIN_URL,
    tokenKey: 'cookie:portaltoken', token: portalCookie.value,
    localStorage: lsAll, cookies, capturedAt: new Date().toISOString(),
  }, null, 2));
  console.log(`Session saved (portaltoken found).\n`);
} else {
  writeFileSync(SESSION_FILE, JSON.stringify({
    instance: INSTANCE, label, loginUrl: LOGIN_URL,
    tokenKey: mainCookies[0] ? `cookie:${mainCookies[0].name}` : 'localStorage',
    token: mainCookies[0]?.value || '',
    localStorage: lsAll, cookies, capturedAt: new Date().toISOString(),
  }, null, 2));
  console.log(`Session saved (no portaltoken yet — will re-capture after MFA setup).\n`);
}

if (storageState) {
  writeFileSync(PROFILE_FILE, JSON.stringify({
    instance: INSTANCE, label, loginUrl: LOGIN_URL,
    storageState, capturedAt: new Date().toISOString(),
  }, null, 2));
}

// ── Step 2: Navigate to MFA / security settings ────────────────────────────────

console.log(`STEP 2: Go to MFA settings`);
console.log(`        In the browser, navigate to your Account → Security settings.`);
console.log(`        Look for "Two-factor authentication" or "Authenticator app".\n`);

// Poll until we see the MFA setup page (either existing factor or setup page)
console.log(`Watching for MFA settings page…`);
let foundMfaPage = false;
const mfaDeadline = Date.now() + 5 * 60_000;
while (Date.now() < mfaDeadline && !foundMfaPage) {
  await page.waitForTimeout(2000);
  const text = (await page.textContent('body').catch(() => '')).toLowerCase();
  const url  = page.url();
  if (/authenticat|two.factor|mfa|security.*factor|factor.*security/i.test(text)
      || url.includes('/security') || url.includes('/mfa') || url.includes('/account')) {
    foundMfaPage = true;
  }
  process.stdout.write('.');
}
process.stdout.write('\n');

if (!foundMfaPage) {
  console.log(`\n⚠  MFA settings page not detected yet — continuing anyway.`);
}

// ── Step 3: Watch for QR code page (secret extraction) ─────────────────────────

console.log(`\nSTEP 3: Add a new authenticator`);
console.log(`        In the browser:`);
console.log(`          1. Click "Add authenticator" or "Set up authenticator"`);
console.log(`          2. If asked, remove/disable the existing one first`);
console.log(`          3. A QR code or setup key will appear\n`);
console.log(`Watching for TOTP secret on the page (up to 10 minutes)…`);

let secret = null;
const secretDeadline = Date.now() + 10 * 60_000;
let dotCount = 0;
while (Date.now() < secretDeadline && !secret) {
  await page.waitForTimeout(2000);
  secret = await extractTotpSecret(page);
  dotCount++;
  if (dotCount % 10 === 0) {
    const url = page.url();
    process.stdout.write(`\n  [${url.slice(0, 70)}]`);
  } else {
    process.stdout.write('.');
  }
}
process.stdout.write('\n');

if (!secret) {
  console.log(`\n⚠  Could not auto-extract secret.`);
  console.log(`   On the setup page, click "Can't scan the code?" or "Enter key manually".`);
  console.log(`   Copy the secret key (looks like: JBSWY3DPEHPK3PXP) and paste it below.\n`);

  // Wait for user to paste via stdin if running in an interactive terminal
  process.stdout.write('Paste the secret key and press Enter: ');
  secret = await new Promise(r => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdin.on('data', chunk => {
      buf += chunk;
      if (buf.includes('\n')) {
        process.stdin.pause();
        r(buf.split('\n')[0].trim());
      }
    });
    // Timeout after 2 minutes
    setTimeout(() => r(''), 2 * 60_000);
  });

  if (!secret) {
    console.error('\nNo secret entered. Exiting.');
    await browser.close();
    process.exit(1);
  }
}

const cleaned = secret.trim().replace(/\s+/g, '').toUpperCase();
if (!/^[A-Z2-7]+=*$/.test(cleaned)) {
  console.warn(`\n⚠  "${cleaned}" doesn't look like a base32 TOTP secret. Saved anyway — verify it works.`);
}

saveSecret(INSTANCE, cleaned);
console.log(`\n✅  Secret saved: ${cleaned.slice(0, 4)}****`);
console.log(`    File: ${SECRETS_FILE}\n`);

// ── Step 4: Complete enrollment in browser then save final session ─────────────

console.log(`STEP 4: Complete enrollment`);
console.log(`        In the browser: scan the QR code with a TOTP app, enter the`);
console.log(`        verification code to confirm, then click Save/Done.\n`);
console.log(`Waiting for you to complete enrollment (up to 5 minutes)…`);

// Poll until back on main app page
const enrollDeadline = Date.now() + 5 * 60_000;
while (Date.now() < enrollDeadline) {
  await page.waitForTimeout(2000);
  const url = page.url();
  if (url.includes(host) && !url.includes('/login') && !url.includes('/account') && !url.includes('/security') && !url.includes('/mfa')) {
    break;
  }
  process.stdout.write('.');
}
process.stdout.write('\n');

// Save fresh session after enrollment
const cookiesAfter      = await ctx.cookies();
const portalAfter       = cookiesAfter.find(c => c.name === 'portaltoken' && c.domain.includes(host));
const storageStateAfter = await ctx.storageState().catch(() => null);

if (portalAfter?.value) {
  writeFileSync(SESSION_FILE, JSON.stringify({
    instance: INSTANCE, label, loginUrl: LOGIN_URL,
    tokenKey: 'cookie:portaltoken', token: portalAfter.value,
    localStorage: {}, cookies: cookiesAfter, capturedAt: new Date().toISOString(),
  }, null, 2));
  console.log(`\n✅ Fresh session saved (portaltoken: ${portalAfter.value.slice(0, 8)}…)`);
} else {
  console.log(`\n⚠  No portaltoken after enrollment — run: node bin/capture-ft-session.mjs --instance=${INSTANCE}`);
}

if (storageStateAfter) {
  writeFileSync(PROFILE_FILE, JSON.stringify({
    instance: INSTANCE, label, loginUrl: LOGIN_URL,
    storageState: storageStateAfter, capturedAt: new Date().toISOString(),
  }, null, 2));
}

await browser.close();
console.log(`\nDone! FT logins for ${INSTANCE} are now fully automated.`);
console.log(`Test it: node bin/capture-ft-session.mjs --instance=${INSTANCE}`);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function waitUntilLoggedIn(page, loginUrl, timeoutMs) {
  const h = new URL(loginUrl).hostname;
  const deadline = Date.now() + timeoutMs;
  let dots = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1500);
    const url = page.url();
    if (url.includes(h) && !url.includes('signin.ft-crm.com') && !url.includes('/login') && !url.includes('/signin')) {
      // Also verify portaltoken OR that we're on a real app page
      const cookies = await ctx.cookies().catch(() => []);
      const portal  = cookies.find(c => c.name === 'portaltoken' && c.domain.includes(h));
      if (portal?.value) { process.stdout.write('\n'); return; }
      // Accept if URL looks like a real app route (not the root)
      if (url !== loginUrl) { process.stdout.write('\n'); return; }
    }
    dots++;
    if (dots % 20 === 0) process.stdout.write(`\n  [${page.url().slice(0, 70)}]`);
    else process.stdout.write('.');
  }
  process.stdout.write('\n');
  throw new Error('Login timed out (10 min).');
}

async function extractTotpSecret(page) {
  const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');

  // 1. Look for plain-text base32 secret on page (16–64 chars of A-Z and 2-7)
  const b32Match = bodyText.match(/\b([A-Z2-7]{16,64})\b/);
  if (b32Match) return b32Match[1];

  // 2. Look for input fields containing the secret
  const inputs = await page.$$('input[readonly], input[type="text"]');
  for (const inp of inputs) {
    const val = await inp.inputValue().catch(() => '');
    if (/^[A-Z2-7]{16,64}$/.test(val.trim())) return val.trim();
  }

  // 3. Look for otpauth:// in img src
  const imgs = await page.$$('img');
  for (const img of imgs) {
    const src = await img.getAttribute('src').catch(() => '');
    if (!src) continue;
    const m = src.match(/secret=([A-Z2-7]+)/i);
    if (m) return m[1].toUpperCase();
  }

  // 4. Scan for data- attributes
  const el = await page.$('[data-secret], [data-totp], [data-otp-secret]');
  if (el) {
    for (const attr of ['data-secret', 'data-totp', 'data-otp-secret']) {
      const v = await el.getAttribute(attr).catch(() => '');
      if (v && /^[A-Z2-7]{16,64}$/i.test(v)) return v.toUpperCase();
    }
  }

  // 5. Look in all links for otpauth://
  const links = await page.$$('a[href*="otpauth"]');
  for (const a of links) {
    const href = await a.getAttribute('href').catch(() => '');
    const m = href?.match(/secret=([A-Z2-7]+)/i);
    if (m) return m[1].toUpperCase();
  }

  return null;
}

function saveSecret(instance, secret) {
  const existing = existsSync(SECRETS_FILE)
    ? JSON.parse(readFileSync(SECRETS_FILE, 'utf8'))
    : {};
  existing[instance] = secret;
  writeFileSync(SECRETS_FILE, JSON.stringify(existing, null, 2));
}
