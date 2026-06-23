// Verify a promo has its dialog popup linked by reading the Dialog Popup
// kt-dropdown's trigger text on the Edit modal. If linked, trigger reads
// "<code> (<truncated_label>)"; if not, "Please Select".
//
//   node src/browser/verify-dialog-link.js qpro11 TEST_VIP_30FC_5X_MB20

import { chromium } from 'playwright';
import { getSite } from '../sites.js';

const siteId = process.argv[2] || 'qpro11';
const promoCode = process.argv[3] || 'TEST_VIP_30FC_5X_MB20';
const site = getSite(siteId);

const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 30, args: ['--start-maximized'] });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();

await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
await page.locator('button:has-text("Login")').click();
await page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });

await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2500);

// Search input differs by platform: QPRO uses formcontrolname="promotion",
// QP2 uses formcontrolname="name". Try both.
const searchInput = page.locator('input[formcontrolname="promotion"], input[formcontrolname="name"]').first();
await searchInput.waitFor({ timeout: 10000 });
await searchInput.fill(promoCode);
await page.waitForTimeout(800);
await page.locator('button:has-text("Search")').first().click();
await page.waitForTimeout(2500);
await page.locator(`tr:has-text("${promoCode}")`).first().locator('a, button').first().click();
await page.waitForTimeout(3500);

const result = await page.evaluate(() => {
  const triggers = Array.from(document.querySelectorAll('kt-dropdown-wo-lazyload .c-btn, kt-dropdown .c-btn'))
    .filter((b) => b.offsetParent !== null);
  for (const b of triggers) {
    let p = b;
    for (let i = 0; i < 14 && p.parentElement; i++) {
      p = p.parentElement;
      const lbl = p.querySelector('span.kt-font-bold, label');
      if (lbl && /Dialog\s*Popup/i.test((lbl.textContent || '').trim())) {
        return { triggerText: (b.textContent || '').replace(/\s+/g, ' ').trim() };
      }
    }
  }
  return { triggerText: null };
});
console.log(`\n=== ${promoCode} Dialog Popup trigger: "${result.triggerText}" ===`);
console.log(result.triggerText && result.triggerText !== 'Please Select' ? '✅ DIALOG IS LINKED' : '❌ NOT LINKED');

await page.waitForTimeout(2000);
await ctx.close();
await browser.close();
