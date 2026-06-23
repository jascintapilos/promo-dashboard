// Probe: open the Game Providers multi-select on QPRO11's Create form
// (after picking Free Spin) and dump every option label so we know what
// to pass to the multiselect handler for FS.
//
// Run: node src/browser/qpro-fs-gp-options-probe.js
// Writes captures/qpro11-fs-gp-options-probe.json.

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSite } from '../sites.js';

const site = getSite('qpro11');
const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 30, args: ['--start-maximized'] });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();

await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
await page.locator('button:has-text("Login")').click();
await page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2000);
await page.locator('button:has-text("Create")').first().click();
await page.waitForTimeout(2500);
await page.locator('form:has(input[formcontrolname="code"]) select[formcontrolname="promo_type"]').last().selectOption({ label: 'Free Spin' });
await page.waitForTimeout(2500);
console.log('[setup] FS picked');

// Open the Game Providers dropdown — scroll into view first, then force-click.
const formScope = page.locator('form:has(input[formcontrolname="code"])').last();
const gpTrigger = formScope.locator(`xpath=.//span[contains(@class,'kt-font-bold') and normalize-space(.)="Game Providers"]/ancestor::div[contains(@class,'row')][1]//*[self::kt-dropdown-wo-lazyload or self::kt-dropdown]//*[contains(@class,'c-btn')]`).first();
await gpTrigger.waitFor({ timeout: 5000 });
await gpTrigger.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
await page.waitForTimeout(500);
await gpTrigger.click({ force: true, timeout: 3000 });
await page.waitForTimeout(1500);

// Also open the Categories dropdown (for the Slot check)
const dump = await page.evaluate(() => {
  const panels = Array.from(document.querySelectorAll('.dropdown-list')).filter((p) => p.offsetParent !== null);
  return panels.map((panel) => {
    const items = Array.from(panel.querySelectorAll('li.pure-checkbox label')).map((lbl) => (lbl.textContent || '').trim()).filter((t) => t && !/select all|unselect all/i.test(t));
    return { itemCount: items.length, items: items.slice(0, 100) };
  });
});

await writeFile(path.join(OUT, 'qpro11-fs-gp-options-probe.json'), JSON.stringify(dump, null, 2));
console.log('=== Game Providers options (visible panel) ===');
for (const p of dump) {
  console.log(`Panel with ${p.itemCount} items:`);
  for (const item of p.items) console.log(`  "${item}"`);
}

// Also dump PP-matching candidates
const ppCandidates = dump.flatMap((p) => p.items.filter((it) => /pp|pragmatic/i.test(it)));
console.log('\nMatching /pp|pragmatic/i:');
for (const c of ppCandidates) console.log(`  "${c}"`);

await ctx.close();
await browser.close();
