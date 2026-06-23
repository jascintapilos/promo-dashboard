// Probe: after committing the Free Spin Games Provider, find where the
// Game (cascading) dropdown's trigger lives. The first probe found that
// `row.locator('.c-btn').nth(1)` doesn't exist — i.e. the Game trigger
// is NOT a sibling .c-btn in the same .row as the Provider trigger.
//
// This probe walks every visible .c-btn after Provider commits and
// dumps its nearest kt-font-bold label + a snippet of its parent row.
//
// Run: node src/browser/qpro-fs-game-trigger-locate.js
// Writes captures/qpro11-fs-game-trigger-locate.json.

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
console.log('[login] ok');

await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2000);
await page.locator('button:has-text("Create")').first().click();
await page.waitForTimeout(2500);
console.log('[create-form] opened');

await page.locator('form:has(input[formcontrolname="code"]) select[formcontrolname="promo_type"]').last().selectOption({ label: 'Free Spin' });
await page.waitForTimeout(2500);
console.log('[promo-type] Free Spin picked');

// Snapshot all .c-btn locations BEFORE committing Provider
const before = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('.c-btn')).filter((b) => b.offsetParent !== null);
  return all.map((b, i) => ({
    idx: i,
    text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
    nearestKtBold: (() => {
      let p = b;
      for (let i = 0; i < 8 && p.parentElement; i++) {
        p = p.parentElement;
        const lbl = p.querySelector('span.kt-font-bold');
        if (lbl) return (lbl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      }
      return null;
    })(),
  }));
});
console.log('[before-commit] triggers:', JSON.stringify(before, null, 2));

// Commit Provider by opening + clicking first <li>
const formScope = page.locator('form:has(input[formcontrolname="code"])').last();
const rowXpath = `xpath=(.//span[contains(@class,'kt-font-bold') and contains(normalize-space(.), "Free Spin Games")])[1]/ancestor::div[contains(@class,'row')][1]`;
const row = formScope.locator(rowXpath).first();
const providerTrigger = row.locator('.c-btn').nth(0);
await providerTrigger.click({ timeout: 3000 });
await page.waitForTimeout(600);
// Click "PP - Pragmatic Play" specifically (more interesting than BNG)
await page.locator('.dropdown-list:visible li').filter({ hasText: /Pragmatic Play/i }).first().click({ timeout: 3000 });
await page.waitForTimeout(1500);
// Close panel
await providerTrigger.click({ timeout: 2000 }).catch(() => {});
await page.waitForTimeout(800);
const triggerText = (await providerTrigger.textContent()).replace(/\s+/g, ' ').trim();
console.log(`[provider] committed; trigger text: "${triggerText}"`);

// Now snapshot all .c-btn locations AFTER committing Provider
const after = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('.c-btn')).filter((b) => b.offsetParent !== null);
  return all.map((b, i) => ({
    idx: i,
    text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
    nearestKtBold: (() => {
      let p = b;
      for (let i = 0; i < 8 && p.parentElement; i++) {
        p = p.parentElement;
        const lbl = p.querySelector('span.kt-font-bold');
        if (lbl) return (lbl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      }
      return null;
    })(),
    // Path from this .c-btn back to nearest .row ancestor
    rowOuterHTMLSnippet: (() => {
      let p = b;
      for (let i = 0; i < 8 && p.parentElement; i++) {
        p = p.parentElement;
        if (p.classList && p.classList.contains('row')) {
          return p.outerHTML.slice(0, 1500);
        }
      }
      return '';
    })(),
  }));
});
console.log('[after-commit] triggers:');
for (const t of after) {
  console.log(`  idx=${t.idx} text="${t.text}" nearestLabel="${t.nearestKtBold}"`);
}

// Also find the row that contains "Please Select" trigger right after Provider
// — that's the Game dropdown.
const gameSuspect = after.find((t) => /please\s*select/i.test(t.text) && /game/i.test(String(t.nearestKtBold || '')));

await writeFile(path.join(OUT, 'qpro11-fs-game-trigger-locate.json'), JSON.stringify({ before, after, providerCommitted: triggerText, gameSuspect }, null, 2));
console.log('\n=== Wrote captures/qpro11-fs-game-trigger-locate.json ===');

await ctx.close();
await browser.close();
