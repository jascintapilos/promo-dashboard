// Playwright spy on QPRO 14.2 Create Banner form — captures the EXACT
// POST body the SPA sends. Run once; captured body updates createBanner
// in src/api-client.js.
//
//   node src/browser/qpro-14-2-submit-spy.js --site=qpro4
//
// User types the password once; the script fills everything else and
// intercepts the POST to /api/bo/banner.

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs';
import path from 'node:path';
import { parseArgs } from '../../bin/_args.js';
import { getSite } from '../sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const site = getSite(flags.site || 'qpro4');
const OUT = path.resolve('captures');
await new Promise((r) => mkdir(OUT, { recursive: true }, r));

const browser = await chromium.launch({ headless: false, channel: 'chrome', args: ['--start-maximized'] });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();

let capturedRequest = null;
page.on('request', async (req) => {
  if (req.url().includes('/api/bo/banner') && req.method() === 'POST') {
    capturedRequest = {
      url: req.url(),
      method: req.method(),
      headers: req.headers(),
      postData: req.postData(),
      postDataBuffer: req.postDataBuffer()?.toString('utf8').slice(0, 8000),
    };
    console.error(`[spy] CAPTURED POST /api/bo/banner`);
    console.error(`[spy] Content-Type: ${req.headers()['content-type']}`);
    console.error(`[spy] body size: ${req.postDataBuffer()?.length} bytes`);
  }
});

await page.goto(site.baseUrl);
await page.waitForLoadState('domcontentloaded');

try {
  await page.locator('input[formcontrolname="merchant_code"]').waitFor({ timeout: 10000 });
  await page.locator('input[formcontrolname="merchant_code"]').fill(site.loginMerchantCode);
  await page.locator('input[formcontrolname="username"]').fill(site.username);
  console.error(`\n>>> Login form pre-filled. Type the password and click Login. <<<\n`);
} catch {
  console.error(`[spy] already logged in.`);
}

await page.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: 180000 });
console.error(`[spy] logged in. url=${page.url()}`);

await page.goto(`${site.baseUrl}/settings/banners`);
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1000);

// Click "Create New Content" toolbar button
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b =>
    /create/i.test((b.textContent || '').trim()) && b.offsetParent
  );
  btn?.click();
});
await page.waitForTimeout(1000);

const stamp = Date.now().toString().slice(-6);
const label = `BANNER_SPY_${stamp}`;

// Fill form fields via setNativeValue (Angular reactive form)
await page.evaluate((label) => {
  const setNativeValue = (el, value) => {
    if (!el) return;
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc?.set) {
      desc.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  };

  // Label
  const labelInput = document.querySelector('input[formcontrolname="label"]');
  if (labelInput) setNativeValue(labelInput, label);

  // Link
  const linkInput = document.querySelector('input[formcontrolname="link"]');
  if (linkInput) setNativeValue(linkInput, '/promotion?code=TEST_SPY');

  // Dates
  const startInput = document.querySelector('input[formcontrolname="start_datetime"]');
  if (startInput) setNativeValue(startInput, '2026-04-21 00:00:00');
  const endInput = document.querySelector('input[formcontrolname="end_datetime"]');
  if (endInput) setNativeValue(endInput, '2026-05-03 23:59:00');

  // Position
  const posInput = document.querySelector('input[formcontrolname="position"]');
  if (posInput) setNativeValue(posInput, '99');

  // Status → Inactive (0)
  const statusEl = document.querySelector('select[formcontrolname="status"]');
  if (statusEl) setNativeValue(statusEl, '0');

  // Session — pick first non-null option
  const sessionEl = document.querySelector('select[formcontrolname="session"]');
  if (sessionEl) {
    const opt = Array.from(sessionEl.options).find(o => o.value && o.value !== 'null' && o.value !== '');
    if (opt) setNativeValue(sessionEl, opt.value);
    console.log('[spy-eval] session options:', Array.from(sessionEl.options).map(o => `${o.value}=${o.text}`).join(', '));
  }

  // Platform Type → User Portal (try 1 first)
  const platformEl = document.querySelector('select[formcontrolname="platform_type_id"]')
    || document.querySelector('select[formcontrolname="platform_type"]');
  if (platformEl) {
    const opt = Array.from(platformEl.options).find(o => /user\s*portal/i.test(o.text));
    if (opt) setNativeValue(platformEl, opt.value);
    console.log('[spy-eval] platform options:', Array.from(platformEl.options).map(o => `${o.value}=${o.text}`).join(', '));
  }

  console.log('[spy-eval] form fields filled');
}, label);

await page.waitForTimeout(500);

// Upload desktop image to first locale tab (MY_EN)
const desktopImg = 'C:\\Users\\vdiuser\\Downloads\\promo-automation\\Banner\\ye55-min\\ye55-up-microgaming-playboy-ultimate-extravaganza-1920x400px-my-en.jpg';
const mobileImg  = 'C:\\Users\\vdiuser\\Downloads\\promo-automation\\Banner\\ye55-min\\ye55-mup-microgaming-playboy-ultimate-extravaganza-960x400px-my-en.jpg';

// Find all file inputs and assign desktop to first, mobile to second
const fileInputs = page.locator('input[type=file]');
const count = await fileInputs.count();
console.error(`[spy] found ${count} file inputs`);
if (count >= 1) await fileInputs.nth(0).setInputFiles(desktopImg);
await page.waitForTimeout(600);
if (count >= 2) await fileInputs.nth(1).setInputFiles(mobileImg);
await page.waitForTimeout(1000);

// Log the dropdown console output from page
const pageConsole = [];
page.on('console', (msg) => {
  if (msg.text().includes('[spy-eval]')) pageConsole.push(msg.text());
});
await page.waitForTimeout(200);
for (const m of pageConsole) console.error(m);

// Click the Create / Submit button
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b =>
    /^(create|submit)$/i.test((b.textContent || '').trim()) && b.offsetParent
  );
  if (btn) { btn.click(); console.log('[spy-eval] clicked:', btn.textContent.trim()); }
  else console.log('[spy-eval] no create/submit button found');
});

// Wait for capture
const start = Date.now();
while (!capturedRequest && Date.now() - start < 15000) {
  await page.waitForTimeout(200);
}

if (capturedRequest) {
  const outFile = path.join(OUT, 'qpro-14-2-submit-spy.json');
  await new Promise((r) => writeFile(outFile, JSON.stringify(capturedRequest, null, 2), r));
  console.log(`\n========== BANNER SPY CAPTURE ==========`);
  console.log(`URL: ${capturedRequest.url}`);
  console.log(`Method: ${capturedRequest.method}`);
  console.log(`Content-Type: ${capturedRequest.headers['content-type']}`);
  console.log(`Body:\n${capturedRequest.postData || capturedRequest.postDataBuffer || '(empty)'}`);
  console.log(`\nSaved to: captures/qpro-14-2-submit-spy.json`);
} else {
  console.log(`\n[spy] No /api/bo/banner POST captured within 15s.`);
  console.log(`[spy] Check if the form submit button was found or if a 422 blocked submit.`);
  // Print page body for debug
  const text = await page.evaluate(() => document.body.innerText.slice(0, 3000));
  console.log(`[spy] page text:\n${text}`);
}

await ctx.close();
await browser.close();
process.exit(0);
