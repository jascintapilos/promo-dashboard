// Open each named multiselect in the Create form (KYC Status, Game Providers,
// Categories, Member Group) using the span.kt-font-bold-based trigger, and
// dump its panel items + Select All toggle so we can finalize the mapper.
//
//   node src/browser/qpro-panels-probe.js --site=qpro11

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../../bin/_args.js';
import { getSite } from '../sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const site = getSite(flags.site || 'qpro11');
const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 20 });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.locator('input[formcontrolname="merchant_code"]').waitFor({ timeout: 20000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
const loginResp = page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
await page.locator('button:has-text("Login")').click();
await loginResp;
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2500);
await page.locator('button:has-text("Create")').last().click({ timeout: 3000 });
await page.waitForTimeout(3000);

// Pick Deposit, wait LONG for sub-types to populate.
await page.locator('select[formcontrolname="promo_type"]:visible').first().selectOption({ label: 'Deposit' });
// Poll for sub-type options.
let subTypeOptions = [];
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(500);
  const opts = await page.locator('select[formcontrolname="promo_sub_type"]:visible').first().locator('option').allTextContents();
  if (opts.length > 1) { subTypeOptions = opts; break; }
}
console.error(`[probe] sub-type options after Deposit: ${JSON.stringify(subTypeOptions)}`);

// Pick KYC Type = "KYC Status" so the tier multiselect appears.
try {
  await page.locator('select[formcontrolname="kyc_type"]:visible').first().selectOption({ label: 'KYC Status' });
  await page.waitForTimeout(1500);
} catch (e) { console.error('[probe] couldn\'t pick KYC Type:', e.message.split('\n')[0]); }

// Probe each named multiselect using span.kt-font-bold based selectors.
const results = { subTypeOptions };
const targets = ['KYC Status', 'Game Providers', 'Categories', 'Member Group'];
for (const labelHook of targets) {
  console.error(`[probe] opening: ${labelHook}`);
  const trigger = page.locator(`.row:has(span.kt-font-bold:has-text("${labelHook}")) kt-dropdown-wo-lazyload .c-btn`).first();
  try {
    await trigger.waitFor({ state: 'visible', timeout: 4000 });
    await trigger.click({ timeout: 3000 });
    await page.waitForTimeout(900);
    const info = await page.evaluate(() => {
      const panels = Array.from(document.querySelectorAll('.dropdown-list, [class*="dropdown-list"]')).filter((p) => p.offsetParent !== null);
      const panel = panels[panels.length - 1];
      if (!panel) return { error: 'no visible panel' };
      const labelHTMLs = Array.from(panel.querySelectorAll('label')).map((lbl) => ({
        cls: lbl.className,
        text: lbl.textContent.trim().slice(0, 80),
        spans: Array.from(lbl.querySelectorAll('span')).map((s) => ({ text: s.textContent.trim(), hidden: s.hidden })),
        innerHTML: lbl.innerHTML.slice(0, 250),
      })).slice(0, 5);
      const items = Array.from(panel.querySelectorAll('li.pure-checkbox, li')).slice(0, 50).map((li, idx) => ({
        idx,
        cls: li.className,
        text: li.textContent.trim().slice(0, 100),
      }));
      return {
        panelClass: panel.className,
        itemCount: panel.querySelectorAll('li').length,
        labelHTMLs,
        items,
      };
    });
    results[labelHook] = info;
    // close
    await trigger.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(500);
  } catch (e) {
    results[labelHook] = { error: e.message.split('\n')[0].slice(0, 200) };
  }
}

await writeFile(path.join(OUT, `${site.id}-panels.json`), JSON.stringify(results, null, 2));
console.error(`[probe] wrote captures/${site.id}-panels.json`);

await ctx.close();
await browser.close();
