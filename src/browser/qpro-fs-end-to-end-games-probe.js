// Probe: pick BOTH Free Spin Games dropdowns via the new label-following
// locator strategy, then verify the "+ Promotion Currency" button has
// become enabled. This is the smoking-gun test for the hypothesis that
// the FS Currency popup is gated on Games commit (Jascinta, 2026-05-13).
//
// Does NOT click "+ Promotion Currency" itself — purely a state check.
// Does NOT Submit. Safe to run.
//
// Run: node src/browser/qpro-fs-end-to-end-games-probe.js
// Writes captures/qpro11-fs-end-to-end-games-probe.json.

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSite } from '../sites.js';

const site = getSite('qpro11');
const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 40, args: ['--start-maximized'] });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();

const result = { steps: [], errors: [] };
const step = (name, data) => { result.steps.push({ name, data }); console.log(`[${name}]`, data ?? ''); };

await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
await page.locator('button:has-text("Login")').click();
await page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
step('login', 'ok');

await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2000);
await page.locator('button:has-text("Create")').first().click();
await page.waitForTimeout(2500);
step('create-form', 'opened');

await page.locator('form:has(input[formcontrolname="code"]) select[formcontrolname="promo_type"]').last().selectOption({ label: 'Free Spin' });
await page.waitForTimeout(2500);
step('promo-type', 'Free Spin picked');

// Helper: pick a kt-dropdown option using the label-following locator
// (same as the new kt_dropdown_pick handler).
async function pickKtDropdown(rowLabel, triggerNth, optionTextRegex) {
  const formScope = page.locator('form:has(input[formcontrolname="code"])').last();
  const triggerXpath = `xpath=(.//span[contains(@class,'kt-font-bold') and contains(normalize-space(.), ${JSON.stringify(rowLabel)})])[1]/following::*[contains(@class,'c-btn')]`;
  const trigger = formScope.locator(triggerXpath).nth(triggerNth);
  await trigger.waitFor({ timeout: 5000 });
  const before = (await trigger.textContent()).replace(/\s+/g, ' ').trim();
  await trigger.click({ timeout: 3000 });
  await page.waitForTimeout(600);
  await page.locator('.dropdown-list:visible li').filter({ hasText: optionTextRegex }).first().click({ timeout: 3000 });
  await page.waitForTimeout(600);
  await trigger.click({ timeout: 2000 }).catch(() => {});  // close panel
  await page.waitForTimeout(800);
  const after = (await trigger.textContent()).replace(/\s+/g, ' ').trim();
  return { before, after, committed: before !== after && !/please\s*select/i.test(after) };
}

// Pick Provider (nth=0)
try {
  const prov = await pickKtDropdown('Free Spin Games', 0, /Pragmatic Play/i);
  step('provider-pick', prov);
} catch (e) {
  result.errors.push(`Provider pick: ${e.message}`);
  step('provider-pick-error', e.message);
}

await page.waitForTimeout(1500);  // Game options populate

// Pick Game (nth=1) — pick the FIRST game option
try {
  const game = await pickKtDropdown('Free Spin Games', 1, /./);
  step('game-pick', game);
} catch (e) {
  result.errors.push(`Game pick: ${e.message}`);
  step('game-pick-error', e.message);
}

await page.waitForTimeout(1500);

// Check whether "+ Promotion Currency" button now exists + is enabled.
const currencyState = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('button')).filter((b) =>
    b.offsetParent !== null && /Promotion Currency/i.test((b.textContent || '').trim())
  );
  return buttons.map((b) => ({
    text: (b.textContent || '').trim().slice(0, 60),
    disabled: b.disabled,
    cls: b.className,
    ariaDisabled: b.getAttribute('aria-disabled'),
  }));
});
step('currency-button-state', currencyState);

await writeFile(path.join(OUT, 'qpro11-fs-end-to-end-games-probe.json'), JSON.stringify(result, null, 2));
console.log('\n=== Wrote captures/qpro11-fs-end-to-end-games-probe.json ===');
console.log('Errors:', result.errors);

await ctx.close();
await browser.close();
