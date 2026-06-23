// Probe the QPRO11 Blacklist Templates popup. Opens the Create form just
// enough to enable Blacklist, force-clicks Blacklist (the previous click
// was intercepted by overlays), clicks Create inside the popup, then dumps
// the popup's DOM structure so we can author tick selectors.
//
//   node src/browser/qpro-blacklist-probe.js --site=qpro11

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../../bin/_args.js';
import { getSite } from '../sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const site = getSite(flags.site || 'qpro11');
const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 30, args: ['--start-maximized'] });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();

await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
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

// Fill minimum required fields so the Blacklist popup is meaningful
const form = page.locator('form:has(input[formcontrolname="code"])');
await form.locator('input[formcontrolname="code"]').fill('PROBE_BL_001');
await form.locator('input[formcontrolname="name"]').fill('Probe Blacklist');
await form.locator('select[formcontrolname="promo_type"]').selectOption({ label: 'Deposit' });
await page.waitForTimeout(2500);
await form.locator('select[formcontrolname="promo_sub_type"]').selectOption({ index: 1 }); // first non-placeholder
await page.waitForTimeout(500);
await form.locator('input[formcontrolname="bonus_rate"]').fill('50');
await form.locator('input[formcontrolname="validity"]').fill('1');
await form.locator('input[formcontrolname="reward_validity"]').fill('1');
await form.locator('input[formcontrolname="multiplier"]').first().fill('3');

// Open Promotion Currency popup, add MYR, close — this is what unlocks
// the Blacklist Templates button on QPRO11.
console.error('[probe] opening Promotion Currency popup');
await page.locator('button:has-text("Promotion Currency")').first().click({ force: true });
await page.waitForTimeout(2000);
const addBtn = page.locator('[role="dialog"]:visible button:has-text("Add"), .modal-content:visible button:has-text("Add")').last();
await addBtn.click({ timeout: 5000 });
await page.waitForTimeout(1500);
const currencySelect = page.locator('select[formcontrolname="currency_id"]').last();
const rawLabels = await currencySelect.locator('option').allTextContents();
const idx = rawLabels.map((s) => s.trim()).indexOf('MYR');
await currencySelect.selectOption({ label: rawLabels[idx].trim() });
await page.locator('input[formcontrolname="max_total_applications"]').last().fill('0');
await page.locator('input[formcontrolname="max_total_bonus"]').last().fill('0');
await page.locator('input[formcontrolname="min_transfer"]').last().fill('100');
await page.locator('input[formcontrolname="max_bonus"]').last().fill('30');
await page.locator('input[formcontrolname="max_transfer_out"]').last().fill('0');
await page.locator('select[formcontrolname="status"]').last().selectOption({ label: 'Active' });
await page.locator('[role="dialog"]:visible button:has-text("Submit")').last().click({ timeout: 5000 });
await page.waitForTimeout(2000);
await page.locator('[role="dialog"]:visible button:has-text("Close")').last().click({ timeout: 3000 });
await page.waitForTimeout(1500);
console.error('[probe] Currency added + closed');

// Open Blacklist popup (force click; lingering overlays often intercept)
const openBtn = page.locator('button:has-text("Blacklist")').first();
await openBtn.waitFor({ timeout: 5000 });
await openBtn.click({ force: true, timeout: 5000 });
await page.waitForTimeout(2000);

// First: snapshot of the popup BEFORE clicking Create
await page.screenshot({ path: path.join(OUT, `${site.id}-blacklist-popup-1-listview.png`), fullPage: true });
const stage1 = await page.evaluate(() => {
  // Find every visible [role="dialog"] AND every .modal-content, dump info
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], .modal-content, .modal-dialog'))
    .filter((d) => d.offsetParent !== null)
    .map((d, idx) => ({
      idx,
      tag: d.tagName.toLowerCase(),
      cls: d.className.slice(0, 100),
      title: d.querySelector('.modal-title, h4, h5, .kt-portlet__head-label')?.textContent?.trim()?.slice(0, 80) || '',
      buttons: Array.from(d.querySelectorAll('button, a[role="button"]')).slice(0, 20).map((b) => ({
        text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50),
        cls: (b.className || '').slice(0, 60),
        visible: !!(b.offsetWidth || b.offsetHeight),
        disabled: b.disabled,
      })),
      // Headings/tabs near top
      headings: Array.from(d.querySelectorAll('h1, h2, h3, h4, h5, h6, .kt-portlet__head-label, .modal-title')).slice(0, 5).map((h) => h.textContent.trim().slice(0, 60)),
    }));
  return { dialogs };
});

// Try clicking Create inside the popup — multiple variants
const createCandidates = [
  '[role="dialog"]:visible button:has-text("Create")',
  '[role="dialog"]:visible button:has-text("+ Create")',
  '[role="dialog"]:visible a:has-text("Create")',
  '.modal-content:visible button:has-text("Create")',
  // Maybe Create is a button at the top of the popup with specific class
  '[role="dialog"]:visible .btn:has-text("Create")',
  '[role="dialog"]:visible [class*="create"]',
];
let createdClicked = '';
for (const sel of createCandidates) {
  try {
    const loc = page.locator(sel).last();
    await loc.waitFor({ timeout: 1500 });
    await loc.click({ force: true, timeout: 1500 });
    createdClicked = sel;
    break;
  } catch {}
}
await page.waitForTimeout(2000);

// Second: snapshot AFTER clicking Create
await page.screenshot({ path: path.join(OUT, `${site.id}-blacklist-popup-2-createform.png`), fullPage: true });
const stage2 = await page.evaluate(() => {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], .modal-content, .modal-dialog'))
    .filter((d) => d.offsetParent !== null)
    .map((d, idx) => ({
      idx,
      tag: d.tagName.toLowerCase(),
      cls: d.className.slice(0, 100),
      title: d.querySelector('.modal-title, h4, h5, .kt-portlet__head-label')?.textContent?.trim()?.slice(0, 80) || '',
      // Form structure: any tables (grid of providers × sub-types)?
      tables: Array.from(d.querySelectorAll('table')).slice(0, 3).map((t) => ({
        rowCount: t.querySelectorAll('tr').length,
        headerCells: Array.from(t.querySelectorAll('thead th, thead td, tr:first-child th, tr:first-child td')).slice(0, 20).map((th) => th.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)),
        firstDataRow: Array.from(t.querySelectorAll('tbody tr:first-child td, tr:nth-child(2) td')).slice(0, 12).map((td) => td.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)),
        checkboxes: t.querySelectorAll('input[type="checkbox"]').length,
      })),
      buttons: Array.from(d.querySelectorAll('button, a[role="button"]')).slice(0, 20).map((b) => ({
        text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50),
        cls: (b.className || '').slice(0, 60),
        visible: !!(b.offsetWidth || b.offsetHeight),
        disabled: b.disabled,
      })),
      // Sections / accordion / tabs
      sections: Array.from(d.querySelectorAll('.kt-portlet__head-label, .accordion-header, [role="tab"], h3, h4, h5')).slice(0, 8).map((s) => s.textContent.trim().slice(0, 60)),
      // Total visible inputs/checkboxes
      checkboxCount: d.querySelectorAll('input[type="checkbox"]:not([disabled])').length,
    }));
  return { dialogs };
});

await writeFile(path.join(OUT, `${site.id}-blacklist-popup-info.json`), JSON.stringify({ stage1_listview: stage1, stage2_createform: stage2, createdClicked }, null, 2));

console.log('Stage 1 — opened popup (before Create):');
stage1.dialogs.forEach((d) => {
  console.log(`  dialog [${d.idx}] ${d.tag}.${JSON.stringify(d.cls)} title=${JSON.stringify(d.title)}`);
  d.buttons.forEach((b) => console.log(`    button "${b.text}" vis=${b.visible} dis=${b.disabled}`));
});
console.log(`\nCreate click attempt → ${createdClicked || 'NONE OF THE SELECTORS MATCHED'}\n`);
console.log('Stage 2 — after Create click attempt:');
stage2.dialogs.forEach((d) => {
  console.log(`  dialog [${d.idx}] title=${JSON.stringify(d.title)} checkboxes=${d.checkboxCount}`);
  d.tables.forEach((t, ti) => {
    console.log(`    table[${ti}] rows=${t.rowCount} checkboxes=${t.checkboxes}`);
    console.log(`      headers: ${JSON.stringify(t.headerCells)}`);
    console.log(`      firstDataRow: ${JSON.stringify(t.firstDataRow)}`);
  });
  if (d.sections.length) console.log(`    sections: ${JSON.stringify(d.sections)}`);
  d.buttons.slice(0, 8).forEach((b) => console.log(`    button "${b.text}" vis=${b.visible} dis=${b.disabled}`));
});

await ctx.close();
await browser.close();
