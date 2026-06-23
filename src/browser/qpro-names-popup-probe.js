// Spy the "+ Add" inner form inside the Promotion Names popup. The popup
// only exists on the Edit form, so the probe first opens an existing
// promo's edit modal, then clicks "+ Promotion Names" → "+ Add", and
// captures the inner form's DOM.
//
//   node src/browser/qpro-names-popup-probe.js --site=qpro11 --code=FT_WEL_SLOTS_120PCT

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../../bin/_args.js';
import { getSite } from '../sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const headless = !(flags.headless === 'false' || process.env.HEADLESS === 'false');
const site = getSite(flags.site || 'qpro11');
const targetCode = flags.code || 'FT_WEL_SLOTS_120PCT';

const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

// Login.
await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded' });
await page.locator('input[formcontrolname="merchant_code"]').waitFor({ timeout: 20000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
const r = page.waitForResponse((x) => x.url().includes('/api/bo/login') && x.status() === 200);
await page.locator('button:has-text("Login")').click();
await r;
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

// Search for the code, click into Edit.
await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);
await page.locator('input[formcontrolname="promotion"]').first().fill(targetCode);
const tableResp = page.waitForResponse((x) => x.url().includes('/api/bo/promotion?') && x.status() === 200, { timeout: 10000 }).catch(() => null);
await page.locator('button:has-text("Search")').first().click();
await tableResp;
await page.waitForTimeout(2500);

const row = page.locator(`tr:has-text("${targetCode}")`).first();
await row.waitFor({ timeout: 10000 });
await row.locator('a, button').first().click();
await page.waitForTimeout(2500);
console.error('[probe] Edit modal open for', targetCode);

// Click + Promotion Names
await page.locator('button:has-text("Promotion Names")').first().click();
await page.waitForTimeout(2000);
console.error('[probe] Promotion Names popup open');
await page.screenshot({ path: path.join(OUT, `${site.id}-names-popup-list.png`), fullPage: true }).catch(() => {});

// Click + Add inside the Names popup
const addBtn = page.locator(`[role="dialog"]:visible button:has-text("Add"), .modal-content:visible button:has-text("Add")`).last();
let addOpened = false;
try {
  await addBtn.click({ timeout: 5000 });
  await page.waitForTimeout(2000);
  addOpened = true;
  console.error('[probe] Add form opened');
} catch (e) {
  console.error('[probe] Add click failed:', e.message.split('\n')[0]);
}
await page.screenshot({ path: path.join(OUT, `${site.id}-names-add-form.png`), fullPage: true }).catch(() => {});

const out = {};
if (addOpened) {
  out.addForm = await page.evaluate(() => {
    const modals = Array.from(document.querySelectorAll('[role="dialog"], .modal-dialog, .modal-content, kt-modal, ngb-modal-window'));
    const vis = modals.filter((m) => m.offsetWidth || m.offsetHeight);
    const top = vis[vis.length - 1] || document.body;
    const visEl = (e) => !!(e.offsetWidth || e.offsetHeight);
    return {
      modalCount: vis.length,
      title: (top.querySelector('.modal-title, h4, h3, h2')?.textContent || '').trim(),
      inputs: Array.from(top.querySelectorAll('input, textarea')).filter(visEl).map((e) => ({
        tag: e.tagName.toLowerCase(), type: e.type || '', placeholder: e.placeholder || '',
        formcontrolname: e.getAttribute('formcontrolname') || '',
      })),
      selects: Array.from(top.querySelectorAll('select')).filter(visEl).map((e) => ({
        formcontrolname: e.getAttribute('formcontrolname') || '',
        options: Array.from(e.options).slice(0, 30).map((o) => o.textContent.trim()),
      })),
      buttons: Array.from(top.querySelectorAll('button, a[role="button"]')).filter(visEl)
        .map((e) => (e.textContent || '').trim().slice(0, 50))
        .filter((t) => t.length > 0 && t.length < 50),
      multiselects: Array.from(top.querySelectorAll('kt-dropdown-wo-lazyload, kt-dropdown')).filter(visEl)
        .map((e) => ({ text: (e.textContent || '').trim().slice(0, 120) })),
    };
  });
}

await writeFile(path.join(OUT, `${site.id}-names-add-form-probe.json`), JSON.stringify(out, null, 2));
console.log('\n=== NAMES + ADD FORM ===');
console.log(JSON.stringify(out, null, 2));

await ctx.close();
await browser.close();
