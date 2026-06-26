#!/usr/bin/env node
/**
 * Captures a fresh Smartico BO session token — fully headless, no manual login.
 *
 * Reads credentials from smartico-creds.local.json (set up via setup-smartico-creds.mjs).
 * Supports TOTP 2FA automatically when totpSecret is stored in the creds file.
 *
 * Usage:
 *   node bin/capture-smartico-session.mjs            # headless auto-login
 *   node bin/capture-smartico-session.mjs --manual   # headed browser (manual fallback)
 *
 * First-time setup:
 *   node bin/setup-smartico-creds.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const MANUAL = flags.manual === true;

const CREDS_FILE   = path.resolve('smartico-creds.local.json');
const SESSION_FILE = path.resolve('smartico-session.local.json');
const LOGIN_URL    = 'https://drive-6.smartico.ai/24016#/login';
const TIMEOUT_MS   = MANUAL ? 5 * 60 * 1000 : 60 * 1000;

// ── TOTP (RFC 6238, SHA-1, 30s window, 6 digits) ─────────────────────────────
function totpAt(secret, counterOffset = 0) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const s = secret.replace(/=+$/, '').toUpperCase();
  let bits = 0, val = 0;
  const bytes = [];
  for (const ch of s) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) { bytes.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  const key     = Buffer.from(bytes);
  const counter = Math.floor(Date.now() / 1000 / 30) + counterOffset;
  const buf     = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac   = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[19] & 0x0f;
  const code   = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(code % 1_000_000).padStart(6, '0');
}
function totpNow(secret) { return totpAt(secret, 0); }

// ── Load credentials ──────────────────────────────────────────────────────────
let creds = {};
if (!MANUAL) {
  if (!existsSync(CREDS_FILE)) {
    console.error('No credentials found. Run first: node bin/setup-smartico-creds.mjs');
    process.exit(1);
  }
  creds = JSON.parse(readFileSync(CREDS_FILE, 'utf8'));
  if (!creds.username || !creds.password) {
    console.error('smartico-creds.local.json missing username/password. Re-run: node bin/setup-smartico-creds.mjs');
    process.exit(1);
  }
}

console.log(`\nSmartico session capture — ${MANUAL ? 'MANUAL (headed browser)' : 'AUTO (headless)'}`);

const browser = await chromium.launch({ headless: !MANUAL, channel: 'chrome', slowMo: MANUAL ? 80 : 0 });
const ctx  = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

let token = null;

if (MANUAL) {
  console.log('Browser open. Complete login manually — window closes on token detection.\n');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  const deadline = Date.now() + TIMEOUT_MS;
  while (!token && Date.now() < deadline) {
    await page.waitForTimeout(1500);
    token = await extractToken(page);
    process.stdout.write(token ? '\n' : '.');
  }
} else {
  try {
    token = await autoLogin(page, creds);
  } catch (e) {
    console.error(`\nAuto-login failed: ${e.message}`);
    console.error('Re-run with --manual to complete login interactively.');
    await browser.close().catch(() => {});
    process.exit(1);
  }
}

await browser.close().catch(() => {});

if (!token) {
  console.error('\nNo session token found within timeout.');
  process.exit(1);
}

writeFileSync(SESSION_FILE, JSON.stringify({ token, capturedAt: new Date().toISOString() }, null, 2));
console.log(`\nSession saved → ${SESSION_FILE}  (token: ${token.slice(0, 8)}…)`);

// ── Auto-login flow ───────────────────────────────────────────────────────────

async function autoLogin(page, { username, password, totpSecret }) {
  console.log('Navigating to Smartico login…');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Already logged in from a stored cookie?
  const existing = await extractToken(page);
  if (existing) { console.log('Existing session active — skipping login.'); return existing; }

  // Fill username
  console.log(`Entering username: ${username}`);
  const userEl = await page.waitForSelector('input[name="username"]', { timeout: 15000 });
  await userEl.click();
  await userEl.fill(username);

  // Fill password
  const passEl = await page.waitForSelector('input[name="password"]', { timeout: 5000 });
  await passEl.click();
  await passEl.fill(password);

  // Submit
  console.log('Submitting…');
  const submitBtn = await page.$('button[type="submit"]');
  if (submitBtn) await submitBtn.click();
  else await page.keyboard.press('Enter');

  await page.waitForTimeout(3500);

  // Detect 2FA prompt
  const bodyText = await page.evaluate(() => document.body.innerText || '').catch(() => '');
  const is2FA = /authenticat|two.factor|2\s*fa|totp|verif|enter.*code|one.time/i.test(bodyText);

  if (is2FA) {
    if (!totpSecret) {
      throw new Error('2FA screen appeared but no TOTP secret in smartico-creds.local.json. Re-run: node bin/setup-smartico-creds.mjs');
    }
    console.log(`  2FA page text: "${bodyText.slice(0, 120).replace(/\s+/g, ' ')}"`);

    // Try current TOTP window, then ±1 to handle up to 30s clock drift
    for (const offset of [0, -1, 1]) {
      const code = totpAt(totpSecret, offset);
      console.log(`2FA attempt (window ${offset >= 0 ? '+' : ''}${offset}): ${code}`);

      const digitLoc = page.locator('input[maxlength="1"]');
      const digitCount = await digitLoc.count().catch(() => 0);
      const visibleIdxs = [];
      for (let i = 0; i < digitCount; i++) {
        if (await digitLoc.nth(i).isVisible().catch(() => false)) visibleIdxs.push(i);
      }

      if (visibleIdxs.length >= 6) {
        // Clear boxes then fill
        for (let i = 0; i < visibleIdxs.length; i++) {
          await digitLoc.nth(visibleIdxs[i]).click();
          await page.keyboard.press('Delete');
        }
        for (let i = 0; i < Math.min(code.length, visibleIdxs.length); i++) {
          await digitLoc.nth(visibleIdxs[i]).click();
          await digitLoc.nth(visibleIdxs[i]).pressSequentially(code[i], { delay: 60 });
          await page.waitForTimeout(60);
        }
        // Explicitly click submit (Smartico may not auto-submit)
        await page.waitForTimeout(600);
        const submitBtns = await page.$$('button[type="submit"], button:has-text("Verify"), button:has-text("Submit"), button:has-text("Confirm"), button:has-text("Log in")');
        for (const btn of submitBtns) {
          if (await btn.isVisible().catch(() => false)) { await btn.click(); break; }
        }
      } else {
        const otpEl = await findOtpInput(page);
        if (otpEl) {
          await otpEl.fill(code);
          const otpSubmit = await page.$('button[type="submit"]');
          if (otpSubmit) await otpSubmit.click();
        }
      }
      await page.waitForTimeout(2500);

      // Success if token appears or 2FA prompt gone
      const t = await extractToken(page);
      if (t) { console.log('2FA accepted.'); return t; }
      const afterText = await page.evaluate(() => document.body.innerText || '').catch(() => '');
      if (!/enter.*2fa|2fa code|authenticat/i.test(afterText)) break;
    }
  }

  // Wait up to 30 s for token to appear in localStorage
  console.log('Waiting for session token…');
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const t = await extractToken(page);
    if (t) { console.log('Login successful.'); return t; }
    await page.waitForTimeout(1500);
    process.stdout.write('.');
  }
  process.stdout.write('\n');
  throw new Error(`Token not detected after login. Final URL: ${page.url()}`);
}

async function findOtpInput(page) {
  const selectors = [
    'input[name="otp"]',
    'input[name="code"]',
    'input[name="token"]',
    'input[name="totp"]',
    'input[autocomplete="one-time-code"]',
    'input[maxlength="6"]',
    'input[type="number"]',
  ];
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) return el;
    } catch (_) {}
  }
  return null;
}

async function extractToken(page) {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('userInfo');
      if (!raw) return null;
      return JSON.parse(raw)?.token || null;
    } catch { return null; }
  }).catch(() => null);
}
