// Playwright spy on QPRO 3.3 Create form submit — captures the EXACT
// multipart POST body the SPA sends. Once captured we mirror that in
// src/api-client.js::createPromotionContent for API-direct.
//
//   node src/browser/qpro-3-3-submit-spy.js --site=qpro4
//
// User does the password login once; the script drives everything else,
// captures the request body, prints it, and exits.

import { chromium } from 'playwright';
import { mkdir, writeFile, readFileSync as _r } from 'node:fs';
import { readFileSync } from 'node:fs';
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
  if (req.url().includes('/api/bo/promotioncontent') && req.method() === 'POST') {
    capturedRequest = {
      url: req.url(),
      method: req.method(),
      headers: req.headers(),
      postData: req.postData(),
      postDataBuffer: req.postDataBuffer()?.toString('utf8').slice(0, 8000),
    };
    console.error(`[spy] CAPTURED POST /api/bo/promotioncontent`);
    console.error(`[spy] Content-Type: ${req.headers()['content-type']}`);
    console.error(`[spy] body size: ${req.postDataBuffer()?.length} bytes`);
  }
});

await page.goto(site.baseUrl);
await page.waitForLoadState('domcontentloaded');

// Auto-fill non-password login fields
try {
  await page.locator('input[formcontrolname="merchant_code"]').waitFor({ timeout: 10000 });
  await page.locator('input[formcontrolname="merchant_code"]').fill(site.loginMerchantCode);
  await page.locator('input[formcontrolname="username"]').fill(site.username);
  console.error(`\n>>> Login form pre-filled. Type the password (Promo111!) and click Login. <<<\n`);
} catch {
  console.error(`[spy] already logged in.`);
}

// Wait for dashboard (any URL other than /login) — up to 3 min for manual password entry
await page.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: 180000 });
console.error(`[spy] logged in. url=${page.url()}`);

// Navigate to 3.3
await page.goto(`${site.baseUrl}/general/promotion-contents`);
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

// Click toolbar Create button
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').trim() === 'Create' && b.offsetParent);
  btn?.click();
});
await page.waitForTimeout(800);

// Fill form fields
const stamp = Date.now().toString().slice(-6);
const code = `TEST_SPY_${stamp}`.slice(0, 15);
await page.evaluate((code) => {
  const setNativeValue = (el, value) => {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  };
  const modal = Array.from(document.querySelectorAll('.modal, [role=dialog]')).filter(m => m.offsetParent && m.getBoundingClientRect().width > 400).pop();
  setNativeValue(modal.querySelector('input[formcontrolname="code"]'), code);
  setNativeValue(modal.querySelector('select[formcontrolname="status"]'), '0');
  setNativeValue(modal.querySelector('input[formcontrolname="position"]'), '99');
  // Desktop + Mobile checkboxes
  const cbs = Array.from(modal.querySelectorAll('input[type=checkbox]'));
  const d = cbs.find(c => /desktop/i.test(c.closest('label')?.textContent || ''));
  const m = cbs.find(c => /^mobile$/i.test((c.closest('label')?.textContent || '').trim()));
  if (d && !d.checked) d.click();
  if (m && !m.checked) m.click();
  // Per-locale tab MY_EN — title, description, dates
  setNativeValue(modal.querySelector('input[formcontrolname="title"]'), 'API Spy Test');
  setNativeValue(modal.querySelector('input[formcontrolname="description"]'), 'Capturing the multipart body');
  setNativeValue(modal.querySelector('input[formcontrolname="start"]'), '2026-04-21 00:00:00');
  setNativeValue(modal.querySelector('input[formcontrolname="end"]'), '2026-05-03 23:59:00');
  setNativeValue(modal.querySelector('input[formcontrolname="publish_at"]'), '2026-04-21 00:00:00');
  setNativeValue(modal.querySelector('input[formcontrolname="expire_at"]'), '2026-05-03 23:59:00');
  // CKEditor content
  const ed = modal.querySelector('.ck-editor__editable');
  if (ed?.ckeditorInstance) ed.ckeditorInstance.setData('<p>API spy test content.</p>');
  // Click Categories "Please Select" trigger to expand
  const trigger = Array.from(modal.querySelectorAll('*')).find(e => (e.textContent||'').trim() === 'Please Select' && e.offsetParent && e.children.length === 0);
  trigger?.closest('.c-btn, [role=combobox]')?.click();
}, code);
await page.waitForTimeout(500);
// Click Select All
await page.evaluate(() => {
  const sel = Array.from(document.querySelectorAll('span, a, button, label')).find(e => /^select\s*all$/i.test((e.textContent||'').trim()) && e.offsetParent);
  sel?.click();
});
// Upload image
const fileInput = page.locator('input[type=file]').first();
await fileInput.setInputFiles('C:\\Users\\vdiuser\\Downloads\\promo-automation\\Banner\\ye55-min\\ye55-mup-microgaming-playboy-ultimate-extravaganza-960x400px-my-en.jpg');
await page.waitForTimeout(600);
// Click Submit
await page.evaluate(() => {
  const modal = Array.from(document.querySelectorAll('.modal, [role=dialog]')).filter(m => m.offsetParent && m.getBoundingClientRect().width > 400).pop();
  const submit = Array.from(modal.querySelectorAll('button')).find(b => /^submit$/i.test((b.textContent||'').trim()) && b.offsetParent);
  submit?.click();
});

// Wait for the capture or 10s timeout
const start = Date.now();
while (!capturedRequest && Date.now() - start < 15000) {
  await page.waitForTimeout(200);
}

if (capturedRequest) {
  await new Promise((r) => writeFile(path.join(OUT, 'qpro-3-3-submit-spy.json'), JSON.stringify(capturedRequest, null, 2), r));
  console.log(`\n========== SPY CAPTURE ==========`);
  console.log(`URL: ${capturedRequest.url}`);
  console.log(`Method: ${capturedRequest.method}`);
  console.log(`Content-Type: ${capturedRequest.headers['content-type']}`);
  console.log(`Body (first 8KB):\n${capturedRequest.postDataBuffer || capturedRequest.postData || '(empty)'}`);
  console.log(`\nSaved to: captures/qpro-3-3-submit-spy.json`);
} else {
  console.log(`\n[spy] ❌ No /api/bo/promotioncontent POST captured within 15s. Try again.`);
}

await ctx.close();
await browser.close();
process.exit(0);
