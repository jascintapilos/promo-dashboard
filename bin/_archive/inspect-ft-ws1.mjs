// Read-only FT WS1 inspection — passwordless flow via magic code.
//   set FT_EMAIL=... & node inspect-ft-ws1.mjs
// The script submits the email, then polls captures/ft-ws1/.otp.txt for the 6-digit code.
import { chromium } from 'playwright';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('captures/ft-ws1');
const OTP_FILE = path.join(OUT, '.otp.txt');
const FT_URL = 'https://mb8.ft-crm.com/';
const EMAIL = process.env.FT_EMAIL;

if (!EMAIL) { console.error('Need FT_EMAIL'); process.exit(2); }

async function snap(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`📸 ${file}`);
}

async function waitForOtp(timeoutMs = 5 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(OTP_FILE)) {
      const raw = (await readFile(OTP_FILE, 'utf8')).trim();
      const m = raw.match(/(\d{6})/);
      if (m) {
        await unlink(OTP_FILE).catch(() => {});
        return m[1];
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('OTP timeout');
}

async function main() {
  await mkdir(OUT, { recursive: true });
  if (existsSync(OTP_FILE)) await unlink(OTP_FILE);  // stale

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    locale: 'en-GB',
    timezoneId: 'Asia/Kuala_Lumpur',
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-GB', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });
  const page = await ctx.newPage();

  console.log(`→ ${FT_URL}`);
  await page.goto(FT_URL, { waitUntil: 'domcontentloaded' });

  const popupPromise = ctx.waitForEvent('page', { timeout: 15000 });
  await page.locator('button:has-text("Login")').first().click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  console.log(`popup → ${popup.url()}`);

  await popup.locator('input[type="email"]').first().fill(EMAIL);
  await popup.locator('button[type="submit"]').first().click();
  await popup.waitForURL(/magic-code/, { timeout: 30000 });
  console.log(`email submitted; OTP requested at ${new Date().toISOString()}`);
  console.log(`WAITING FOR OTP — drop 6-digit code into ${OTP_FILE}`);
  await snap(popup, '00-otp-page');

  const otp = await waitForOtp();
  console.log(`got OTP: ${otp}`);

  // Type the 6 digits into the 6 separate boxes. Try first by filling the first box and typing —
  // many of these UIs auto-advance on input.
  const otpInputs = popup.locator('input').filter({ hasNot: popup.locator('[type=hidden]') });
  const count = await otpInputs.count();
  console.log(`OTP inputs visible: ${count}`);
  if (count >= 6) {
    for (let i = 0; i < 6; i++) {
      await otpInputs.nth(i).fill(otp[i]);
    }
  } else {
    // Fallback: focus first then keyboard-type
    await otpInputs.first().click();
    await popup.keyboard.type(otp, { delay: 50 });
  }
  await snap(popup, '01-otp-typed');

  // Most magic-code UIs auto-submit. If not, click submit.
  const submit = popup.locator('button[type="submit"]').first();
  if (await submit.count() > 0 && await submit.isVisible().catch(() => false)) {
    await submit.click().catch(() => {});
  }

  // Wait for either popup to close or main page to redirect
  try {
    await popup.waitForEvent('close', { timeout: 30000 });
    console.log('popup closed — auth completed');
  } catch {
    console.log(`popup still open at ${popup.url()}`);
  }
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  console.log(`main tab now at: ${page.url()}`);

  await snap(page, '02-dashboard');

  // Map navigation
  const navLinks = await page.evaluate(() => {
    const els = [...document.querySelectorAll('a, [role="link"], nav button, aside button, [role="menuitem"]')]
      .map((el) => ({
        text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
        href: el.getAttribute('href') || '',
      }))
      .filter((l) => l.text && l.text.length > 1);
    const seen = new Set();
    return els.filter((l) => { const k = l.text + '|' + l.href; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 100);
  });
  console.log('\n=== Nav links ===');
  for (const l of navLinks) console.log(`  ${l.text.padEnd(45)}  ${l.href}`);

  await ctx.storageState({ path: path.join(OUT, 'storage-state.json') });
  console.log(`\nsession saved → ${path.join(OUT, 'storage-state.json')}`);

  await ctx.close();
  await browser.close();
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
