// Probe: open one of the V13–V14 TEST promotions (which the dropdown
// claims has its dialog popup associated) and dump the GET response's
// dialog_popup_list shape. Use this to figure out what shape the PUT
// body needs for QPRO11.
//
//   node src/browser/promotion-dialog-link-probe.js qpro11 TEST_VIP_30FC_5X_MB13

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSite } from '../sites.js';

const siteId = process.argv[2] || 'qpro11';
const promoCode = process.argv[3] || 'TEST_VIP_30FC_5X_MB13';
const site = getSite(siteId);
const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 30, args: ['--start-maximized'] });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();

// Capture every API response
const apiCalls = [];
page.on('response', async (resp) => {
  const req = resp.request();
  const url = resp.url();
  if (!/\/api\/bo\//i.test(url)) return;
  try {
    const text = await resp.text();
    apiCalls.push({
      method: req.method(),
      url,
      status: resp.status(),
      body: text.slice(0, 5000),
    });
  } catch {}
});

await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
await page.locator('button:has-text("Login")').click();
await page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
console.log(`[login ok] ${siteId}`);

await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2500);

await page.locator('input[formcontrolname="promotion"]').first().fill(promoCode);
await page.waitForTimeout(800);
await page.locator('button:has-text("Search")').first().click();
await page.waitForTimeout(2500);

// Click the row's first action button to open Edit (mirrors the canary)
const row = page.locator(`tr:has-text("${promoCode}")`).first();
await row.waitFor({ timeout: 10000 });
const rowAction = row.locator('a, button').first();
await rowAction.click();
await page.waitForTimeout(3000);

// Dump GET response for the promotion detail
const getCall = apiCalls.findLast((c) => c.method === 'GET' && /\/api\/bo\/promotion\/\d/.test(c.url));
if (getCall) {
  try {
    const json = JSON.parse(getCall.body);
    console.log('\n=== GET /api/bo/promotion/<id> response ===');
    console.log('keys:', Object.keys(json?.data?.rows || json?.data || {}));
    const dpl = (json?.data?.rows || json?.data)?.dialog_popup_list;
    console.log('dialog_popup_list:', JSON.stringify(dpl, null, 2));
    await writeFile(path.join(OUT, `promotion-dialog-link-probe-${siteId}-${promoCode}.json`), JSON.stringify(json, null, 2));
  } catch (e) {
    console.log('Could not parse GET body:', e.message);
    console.log('body slice:', getCall.body.slice(0, 1000));
  }
} else {
  console.log('No GET /api/bo/promotion/<id> response captured');
  console.log('API calls seen:');
  apiCalls.forEach((c) => console.log(`  ${c.method} ${c.status} ${c.url.replace(/\?.*$/, '')}`));
}

await page.waitForTimeout(2500);
await ctx.close();
await browser.close();
