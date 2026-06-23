// Probe: replicate the FS canary fill up to (but NOT including) Submit,
// then enumerate every ng-invalid element on the outer Create Promotion
// Code form. The goal is to identify which fields the canary leaves
// invalid that block Submit.
//
// Run: node src/browser/qpro-fs-outer-invalid-probe.js
// Writes captures/qpro11-fs-outer-invalid-probe.json.

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

// Pick Free Spin
await page.locator('form:has(input[formcontrolname="code"]) select[formcontrolname="promo_type"]').last().selectOption({ label: 'Free Spin' });
await page.waitForTimeout(2500);
console.log('[setup] FS picked, waiting for the form to fully render');

// Dump every ng-invalid element on the OUTER form. We do this BEFORE
// filling anything — that way we see the form's baseline required fields
// for FS. Anything that's ng-invalid here is required.
const dump = await page.evaluate(() => {
  const form = document.querySelector('form');  // outermost form
  if (!form) return { error: 'no form' };
  const invalids = Array.from(form.querySelectorAll('.ng-invalid')).filter((el) => el.offsetParent !== null);
  return {
    invalidElements: invalids.map((el) => ({
      tag: el.tagName.toLowerCase(),
      formcontrolname: el.getAttribute('formcontrolname'),
      formgroupname: el.getAttribute('formgroupname'),
      formarrayname: el.getAttribute('formarrayname'),
      type: el.type || null,
      cls: (el.className || '').slice(0, 200),
      nearbyLabel: (() => {
        let p = el;
        for (let i = 0; i < 6 && p.parentElement; i++) {
          p = p.parentElement;
          const lbl = p.querySelector('span.kt-font-bold, label, .form-label');
          if (lbl && lbl !== el) return (lbl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        }
        return null;
      })(),
      // For custom kt-dropdown, look for the trigger text inside the host
      ktDropdownText: el.tagName === 'KT-DROPDOWN-WO-LAZYLOAD' || el.tagName === 'KT-DROPDOWN'
        ? (el.querySelector('.c-btn')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)
        : null,
    })),
    // Form-level state
    formClasses: form.className,
    formNgValid: form.classList.contains('ng-valid'),
    formNgInvalid: form.classList.contains('ng-invalid'),
  };
});

await writeFile(path.join(OUT, 'qpro11-fs-outer-invalid-probe.json'), JSON.stringify(dump, null, 2));
console.log('=== Wrote captures/qpro11-fs-outer-invalid-probe.json ===');
console.log(`Form is ng-${dump.formNgValid ? 'valid' : 'INVALID'}`);
console.log(`\nInvalid elements (${dump.invalidElements.length}):`);
for (const f of dump.invalidElements) {
  console.log(`  <${f.tag} formcontrolname="${f.formcontrolname}"> label="${f.nearbyLabel}" ${f.ktDropdownText ? `[kt-dropdown: "${f.ktDropdownText}"]` : ''}`);
}

await ctx.close();
await browser.close();
