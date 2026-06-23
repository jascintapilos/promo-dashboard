// Find every visible Blacklist-related button/link anywhere on the page
// after the form is loaded + currency added.
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

// Fill minimum then add MYR currency so the Blacklist UI is enabled if it's gated.
const form = page.locator('form:has(input[formcontrolname="code"])');
await form.locator('input[formcontrolname="code"]').fill('PROBE_BL_002');
await form.locator('input[formcontrolname="name"]').fill('Probe Blacklist');
await form.locator('select[formcontrolname="promo_type"]').selectOption({ label: 'Deposit' });
await page.waitForTimeout(2500);
await form.locator('select[formcontrolname="promo_sub_type"]').selectOption({ index: 1 });
await page.waitForTimeout(500);
await form.locator('input[formcontrolname="bonus_rate"]').fill('50');
await form.locator('input[formcontrolname="validity"]').fill('1');
await form.locator('input[formcontrolname="reward_validity"]').fill('1');
await form.locator('input[formcontrolname="multiplier"]').first().fill('3');

// Open + Select-All on Categories and Game Providers — Blacklist button
// only appears AFTER both are configured (operator-confirmed).
async function openMultiAndSelectAll(labelHook) {
  const xpath = `xpath=.//span[contains(@class,'kt-font-bold') and normalize-space(.)='${labelHook}']/ancestor::div[contains(@class,'row')][1]//*[self::kt-dropdown-wo-lazyload or self::kt-dropdown]//*[contains(@class,'c-btn')]`;
  const trigger = form.locator(xpath).first();
  await trigger.click({ timeout: 3000 });
  await page.waitForTimeout(900);
  const panel = page.locator('div.dropdown-list:visible, .dropdown-list.animated:visible').last();
  try {
    const selAll = panel.locator('label:has(span:text-is("Select All")):has(span:text-is("UnSelect All"))').first();
    await selAll.waitFor({ timeout: 2000 });
    await selAll.click();
    await page.waitForTimeout(500);
  } catch (e) {
    console.error(`[probe] Select All failed for ${labelHook}: ${e.message.split('\n')[0]}`);
  }
  await trigger.click({ timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(400);
}
console.error('[probe] selecting Categories (Select All)');
await openMultiAndSelectAll('Categories');
console.error('[probe] selecting Game Providers (Select All)');
await openMultiAndSelectAll('Game Providers');

await page.locator('button:has-text("Promotion Currency")').first().click({ force: true });
await page.waitForTimeout(2000);
await page.locator('[role="dialog"]:visible button:has-text("Add")').last().click({ timeout: 5000 });
await page.waitForTimeout(1500);
const rawLabels = await page.locator('select[formcontrolname="currency_id"]').last().locator('option').allTextContents();
const idx = rawLabels.map((s) => s.trim()).indexOf('MYR');
await page.locator('select[formcontrolname="currency_id"]').last().selectOption({ label: rawLabels[idx].trim() });
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

// Find every BUTTON or anchor whose text contains "blacklist" (case-insensitive).
// Don't filter to leaves — the button has an icon child, so leaf-only filtering
// drops it. Use directly-on-button text + descendant-text checks.
const blacklistRefs = await page.evaluate(() => {
  const matches = [];
  document.querySelectorAll('button, a[role="button"], a').forEach((el) => {
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 60) return;
    if (!/black\s*list/i.test(text)) return;
    const r = el.getBoundingClientRect();
    const visible = r.width > 0 && r.height > 0;
    matches.push({
      tag: el.tagName.toLowerCase(),
      text,
      cls: (el.className || '').toString().slice(0, 80),
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      visible,
      disabled: el.disabled,
    });
  });
  return matches;
});
console.log('\n=== Blacklist-like buttons ===');
blacklistRefs.forEach((b, i) => {
  console.log(`  [${i}] <${b.tag}> "${b.text}" at (${b.x},${b.y}) ${b.w}x${b.h} vis=${b.visible} dis=${b.disabled} cls="${b.cls.slice(0, 50)}"`);
});

// CLICK the modal's BlackList button (capital L, class `ml-2`) — NOT the
// list-page filter `Blacklist` (lowercase L, class `mr-2`) which sits behind
// the modal.
const target = blacklistRefs.find((b) => b.visible && !b.disabled && b.text === 'BlackList');
if (target) {
  console.log(`\nClicking modal "${target.text}" at (${target.x}, ${target.y})…`);
  await page.locator(`button:text-is("BlackList")`).first().click({ force: true, timeout: 5000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, `${site.id}-after-blacklist-click.png`), fullPage: true });
  // Dump all visible dialogs / modal-content elements
  const popupInfo = await page.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], .modal-content, .modal-dialog, .mat-dialog-container, .cdk-overlay-pane'))
      .filter((d) => d.offsetParent !== null);
    return dialogs.map((d, idx) => {
      const title = d.querySelector('.modal-title, h4, h5, .kt-portlet__head-label')?.textContent?.trim()?.slice(0, 80) || '';
      const buttons = Array.from(d.querySelectorAll('button, a[role="button"]')).slice(0, 30).map((b) => ({
        text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50),
        cls: (b.className || '').slice(0, 60),
        visible: !!(b.offsetWidth || b.offsetHeight),
        disabled: b.disabled,
      }));
      const tables = Array.from(d.querySelectorAll('table')).slice(0, 3).map((t) => ({
        rows: t.querySelectorAll('tr').length,
        headerCells: Array.from(t.querySelectorAll('thead th, thead td, tr:first-child th, tr:first-child td')).slice(0, 25).map((th) => th.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)),
        firstDataRow: Array.from(t.querySelectorAll('tbody tr:first-child td, tr:nth-child(2) td')).slice(0, 25).map((td) => td.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)),
        checkboxes: t.querySelectorAll('input[type="checkbox"]').length,
      }));
      const headings = Array.from(d.querySelectorAll('h1, h2, h3, h4, h5, h6, .modal-title')).slice(0, 5).map((h) => h.textContent.trim().slice(0, 60));
      return {
        idx,
        tag: d.tagName.toLowerCase(),
        cls: d.className.slice(0, 100),
        title,
        headings,
        buttons,
        tables,
        checkboxCount: d.querySelectorAll('input[type="checkbox"]:not([disabled])').length,
      };
    });
  });
  await writeFile(path.join(OUT, `${site.id}-blacklist-after-click.json`), JSON.stringify(popupInfo, null, 2));
  console.log('\n=== Dialogs visible AFTER clicking Blacklist ===');
  popupInfo.forEach((d) => {
    console.log(`\n  dialog [${d.idx}] <${d.tag}> title=${JSON.stringify(d.title)} headings=${JSON.stringify(d.headings)} cls="${d.cls.slice(0, 60)}"`);
    console.log(`    checkboxes=${d.checkboxCount}`);
    d.buttons.slice(0, 12).forEach((b) => console.log(`    button "${b.text}" vis=${b.visible} dis=${b.disabled}`));
    d.tables.forEach((t, ti) => {
      console.log(`    table[${ti}] rows=${t.rows} checkboxes=${t.checkboxes}`);
      console.log(`      headers: ${JSON.stringify(t.headerCells)}`);
      console.log(`      row1: ${JSON.stringify(t.firstDataRow)}`);
    });
  });
}

await ctx.close();
await browser.close();
