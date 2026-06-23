// Probe: open QPRO11 Create form → pick Free Spin → open the
// "Free Spin Games" Provider dropdown → dump the OPEN panel's option
// markup so we know exactly what to click. Then close, open the Game
// dropdown (after picking a provider so it populates), dump that too.
//
// Run: node src/browser/qpro-fs-games-open-probe.js
//
// Writes captures/qpro11-fs-games-open-probe.json.
//
// This complements qpro-fs-games-probe.js (which only inspects the host
// kt-dropdown-wo-lazyload element). The kt_dropdown_pick handler was
// failing because clicks "registered visually" but didn't commit. With
// the option-level markup in hand, we can build a click strategy that
// targets the right element + verify via the trigger text readback.

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSite } from '../sites.js';

const site = getSite('qpro11');
const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 50, args: ['--start-maximized'] });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();

// Login.
await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
const loginResp = page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
await page.locator('button:has-text("Login")').click();
await loginResp;
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
console.log('[login] ok');

// Open Create form.
await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2000);
await page.locator('button:has-text("Create")').first().click();
await page.waitForTimeout(2500);
console.log('[create-form] opened');

// Pick Free Spin in Promo Type. (form-scoped — there's also a list-page
// Promo Type filter we must NOT touch.)
await page.locator('form:has(input[formcontrolname="code"]) select[formcontrolname="promo_type"]').last().selectOption({ label: 'Free Spin' });
await page.waitForTimeout(2500);
console.log('[promo-type] Free Spin picked');

const result = { provider: null, game: null, errors: [] };

// ── Step 1: open the "Free Spin Games" Provider dropdown.
// Use the same row anchor the canary handler uses.
const formScope = page.locator('form:has(input[formcontrolname="code"])').last();
const rowXpath = `xpath=(.//span[contains(@class,'kt-font-bold') and contains(normalize-space(.), "Free Spin Games")])[1]/ancestor::div[contains(@class,'row')][1]`;
const row = formScope.locator(rowXpath).first();

try {
  await row.waitFor({ timeout: 5000 });
  console.log('[row] Free Spin Games row located');
} catch (e) {
  result.errors.push(`Row not found: ${e.message}`);
}

const providerTrigger = row.locator('.c-btn').nth(0);
const gameTrigger = row.locator('.c-btn').nth(1);

async function dumpOpenPanel(label) {
  await page.waitForTimeout(700);
  return await page.evaluate(() => {
    // Find every visible dropdown-list panel anywhere on the page.
    const panels = Array.from(document.querySelectorAll('.dropdown-list')).filter((p) => p.offsetParent !== null);
    return panels.map((panel, panelIdx) => ({
      panelIdx,
      cls: panel.className,
      outerHTML: panel.outerHTML.slice(0, 6000),
      itemCount: panel.querySelectorAll('li').length,
      items: Array.from(panel.querySelectorAll('li')).slice(0, 12).map((li, liIdx) => ({
        liIdx,
        cls: li.className,
        text: (li.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        // Direct child structure
        childTags: Array.from(li.children).map((c) => `${c.tagName.toLowerCase()}.${c.className}`.slice(0, 60)),
        // Inspect first label child if present
        firstLabelHTML: li.querySelector('label')?.outerHTML?.slice(0, 400) || null,
        // Inspect first input child if present
        firstInputHTML: li.querySelector('input')?.outerHTML?.slice(0, 400) || null,
        // Click target candidates (what attaches @click in Angular)
        hasOnClickAttr: li.hasAttribute('ng-reflect-click') || li.outerHTML.includes('(click)'),
      })),
      // Toggle label (Select All / UnSelect All) — present on multi only
      selectAllOuterHTML: panel.querySelector('label:has(span)')?.outerHTML?.slice(0, 400) || null,
    }));
  });
}

try {
  await providerTrigger.waitFor({ timeout: 5000 });
  await providerTrigger.click({ timeout: 3000 });
  console.log('[provider] trigger clicked');
  result.provider = await dumpOpenPanel('provider');
  // Close by re-clicking the trigger.
  await providerTrigger.click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(500);
} catch (e) {
  result.errors.push(`Provider dropdown open failed: ${e.message}`);
}

// ── Step 2: also try clicking the FIRST option in the provider panel and
// observe whether the trigger text changes. If it doesn't, that's the
// commit failure we're chasing.
try {
  await providerTrigger.click({ timeout: 3000 });
  await page.waitForTimeout(600);
  const before = (await providerTrigger.textContent()).replace(/\s+/g, ' ').trim();
  console.log(`[provider] trigger text BEFORE click: "${before}"`);

  // Try strategy A: click first <li> inside the visible panel.
  const firstLi = page.locator('.dropdown-list:visible li').first();
  const liText = await firstLi.textContent().catch(() => '');
  console.log(`[provider] first <li> text: "${(liText || '').trim().slice(0, 60)}"`);

  await firstLi.click({ timeout: 2000 }).catch((e) => result.errors.push(`firstLi click: ${e.message}`));
  await page.waitForTimeout(800);

  const after = (await providerTrigger.textContent()).replace(/\s+/g, ' ').trim();
  console.log(`[provider] trigger text AFTER  click: "${after}"`);
  result.providerCommitTest = { beforeText: before, afterText: after, committed: before !== after };

  // Close panel cleanly if still open.
  await page.locator('body').click({ position: { x: 10, y: 10 } }).catch(() => {});
  await page.waitForTimeout(400);
} catch (e) {
  result.errors.push(`Provider commit test failed: ${e.message}`);
}

// ── Step 3: if commit succeeded, open the Game dropdown and dump that.
try {
  await page.waitForTimeout(1500);  // give Angular time to populate the Game dropdown
  await gameTrigger.waitFor({ timeout: 5000 });
  await gameTrigger.click({ timeout: 3000 });
  console.log('[game] trigger clicked');
  result.game = await dumpOpenPanel('game');
  await gameTrigger.click({ timeout: 2000 }).catch(() => {});
} catch (e) {
  result.errors.push(`Game dropdown open failed: ${e.message}`);
}

await writeFile(path.join(OUT, 'qpro11-fs-games-open-probe.json'), JSON.stringify(result, null, 2));
console.log('\n=== WROTE captures/qpro11-fs-games-open-probe.json ===');
console.log('Errors:', result.errors);

await ctx.close();
await browser.close();
