// Fetch QP2A's main Angular bundle and grep for "dialog_popup_list" to
// find how the frontend SERIALIZES the field. The mat-select / kt-dropdown
// emits an object that flows into the form's reactive form value. Grep
// for nearby code that constructs the dialog_popup_list value.

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import { getSite } from '../sites.js';

const site = getSite('ibc22');

const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 30 });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();

await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
await page.locator('button:has-text("Login")').click();
await page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

// Navigate to the admin SPA route — this is where the Angular bundle loads.
await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(3000);

// Find any non-trivial JS bundle (Angular emits chunks like main-xyz.js,
// runtime-xyz.js, polyfills-xyz.js — we want main).
const bundleUrls = await page.evaluate(() => {
  const scripts = Array.from(document.querySelectorAll('script[src]'));
  return scripts.map((s) => s.src);
});
console.log('all <script src>:');
bundleUrls.forEach((u) => console.log('  ', u));
// Fetch every .js script. Concatenate. Grep for dialog_popup_list.
const jsUrls = bundleUrls.filter((u) => /\.js(\?|$)/.test(u));
console.log(`fetching ${jsUrls.length} JS scripts…`);
let allText = '';
for (const url of jsUrls) {
  try {
    const r = await page.evaluate(async (u) => {
      const res = await fetch(u);
      return await res.text();
    }, url);
    allText += `\n\n// ===== ${url} =====\n${r}`;
  } catch (e) {
    console.log(`  fail ${url}: ${e.message.split('\n')[0]}`);
  }
}
console.log(`total: ${allText.length} bytes`);
await fs.writeFile('captures/qp2-spa-bundles.js', allText);

const re = /[\s,{(]dialog_popup_list[\s\S]{0,400}/g;
const matches = [...allText.matchAll(re)].slice(0, 8);
console.log(`\n${matches.length} mentions of "dialog_popup_list":`);
matches.forEach((m, i) => {
  console.log(`\n--- match ${i} ---`);
  console.log(m[0].replace(/\s+/g, ' ').slice(0, 500));
});

await ctx.close();
await browser.close();
