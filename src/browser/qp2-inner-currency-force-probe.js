// Deep probe: fill inner Create Promotion Currency form, then try
// several ways to fire Submit AND introspect Angular's FormGroup state
// to find the actual block.
//
// Run: node src/browser/qp2-inner-currency-force-probe.js

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSite } from '../sites.js';

const site = getSite('ibc22');
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
await page.locator('form:has(input[formcontrolname="code"]) select[formcontrolname="promo_type"]').last().selectOption({ label: 'Deposit' });
await page.waitForTimeout(2500);

// Open Currency popup + Add
await page.locator('button:has-text("Promotion Currency")').first().click();
await page.waitForTimeout(2000);
const addBtn = page.locator('button:visible').filter({ hasText: /^\s*\+?\s*Add\s*$/i }).last();
await addBtn.click({ timeout: 5000 });
await page.waitForTimeout(2500);

// Fill the inner form like the canary does — selects first, then inputs
const innerLocator = (sel) => page.locator(`.modal-content:has(:text("Create Promotion Currency")) ${sel}`).last();

await innerLocator('select[formcontrolname="currency_id"]').selectOption({ label: 'MYR' });
await page.waitForTimeout(500);
await innerLocator('select[formcontrolname="bonus_type"]').selectOption({ label: 'Percentage' });
await page.waitForTimeout(800);
await innerLocator('select[formcontrolname="max_withdraw_type"]').selectOption({ label: 'Fixed Amount' });
await page.waitForTimeout(800);
await innerLocator('input[formcontrolname="min_deposit"]').fill('50');
await page.waitForTimeout(300);
await innerLocator('input[formcontrolname="max_bonus"]').fill('100');
await page.waitForTimeout(300);
await innerLocator('input[formcontrolname="bonus_rate"]').fill('50');
await page.waitForTimeout(300);
await innerLocator('input[formcontrolname="max_withdraw"]').fill('100');
await page.waitForTimeout(500);
console.log('[fill] all fields filled');

// Dig into Angular's state via __ngContext__
const angularState = await page.evaluate(() => {
  const dialogs = Array.from(document.querySelectorAll('.modal-content')).filter((d) => d.offsetParent !== null);
  const innerDialog = dialogs.find((d) => /create\s+promotion\s+currency/i.test(d.querySelector('.modal-header, .modal-title, h4, h5')?.textContent || ''));
  if (!innerDialog) return { error: 'no inner dialog' };

  const submitBtn = Array.from(innerDialog.querySelectorAll('button')).find((b) => /^\s*Submit\s*$/i.test((b.textContent || '').trim()));
  if (!submitBtn) return { error: 'no submit button' };

  // Inspect the button's exact state
  const btnState = {
    disabledAttr: submitBtn.hasAttribute('disabled'),
    disabledAttrValue: submitBtn.getAttribute('disabled'),
    disabledProp: submitBtn.disabled,
    classList: Array.from(submitBtn.classList),
    outerHTMLSnippet: submitBtn.outerHTML.slice(0, 400),
  };

  // Try to find Angular's component instance and form
  // Modern Angular Ivy: __ngContext__ on the LView node
  // Older: __ng* properties
  // Walk up from the button to find the component host
  let host = submitBtn;
  let ngContext = null;
  let depth = 0;
  while (host && depth < 20 && !ngContext) {
    const keys = Object.keys(host).filter((k) => k.startsWith('__ng') || k.startsWith('ng-reflect'));
    if (keys.length > 0) {
      ngContext = { tag: host.tagName.toLowerCase(), depth, keys: keys.slice(0, 20) };
      break;
    }
    host = host.parentElement;
    depth++;
  }

  // Try to read the Angular form via ng (global) or window['ng'].getComponent
  let ngComp = null;
  try {
    if (window.ng && window.ng.getComponent) {
      const c = window.ng.getComponent(host);
      ngComp = c ? { ctor: c.constructor.name, hasForm: 'form' in c, formProps: c.form ? { valid: c.form.valid, invalid: c.form.invalid, status: c.form.status, errors: c.form.errors, pristine: c.form.pristine, dirty: c.form.dirty } : null } : null;
    }
  } catch (e) {
    ngComp = { error: e.message };
  }

  // Also: list FormControls with their states
  let formStates = null;
  try {
    if (window.ng && window.ng.getOwningComponent) {
      const c = window.ng.getComponent(host);
      if (c && c.form && c.form.controls) {
        formStates = {};
        for (const k of Object.keys(c.form.controls)) {
          const ctrl = c.form.controls[k];
          formStates[k] = { value: ctrl.value, valid: ctrl.valid, errors: ctrl.errors, status: ctrl.status };
        }
      }
    }
  } catch (e) {
    formStates = { error: e.message };
  }

  return { btnState, ngContext, ngComp, formStates };
});

console.log('\n=== Submit button state ===');
console.log(JSON.stringify(angularState.btnState, null, 2));
console.log('\n=== Angular component context ===');
console.log(JSON.stringify(angularState.ngContext, null, 2));
console.log('\n=== Angular form state ===');
console.log(JSON.stringify(angularState.ngComp, null, 2));
console.log('\n=== Per-control states ===');
console.log(JSON.stringify(angularState.formStates, null, 2));

// Try force-click via JS native click (ignores disabled attribute on most elements)
const beforeURL = page.url();
const beforeRowCount = await page.locator('.modal-content table tr, .modal-content [class*="row"]').count();
console.log(`\n[before-force-click] url=${beforeURL}, row count in modal=${beforeRowCount}`);

const clickResult = await page.evaluate(() => {
  const dialogs = Array.from(document.querySelectorAll('.modal-content')).filter((d) => d.offsetParent !== null);
  const innerDialog = dialogs.find((d) => /create\s+promotion\s+currency/i.test(d.querySelector('.modal-header, .modal-title, h4, h5')?.textContent || ''));
  const submit = Array.from(innerDialog?.querySelectorAll('button') || []).find((b) => /^\s*Submit\s*$/i.test(b.textContent?.trim() || ''));
  if (!submit) return { error: 'no submit btn' };
  // Try to remove disabled attribute and click
  submit.removeAttribute('disabled');
  submit.disabled = false;
  submit.click();
  return { clickedAfterEnable: true };
});
console.log('[force-click] result:', clickResult);
await page.waitForTimeout(3000);

const afterDialogs = await page.evaluate(() => {
  const dialogs = Array.from(document.querySelectorAll('.modal-content')).filter((d) => d.offsetParent !== null);
  return dialogs.map((d) => d.querySelector('.modal-header, .modal-title, h4, h5')?.textContent?.trim().slice(0, 60));
});
console.log('[after-force-click] visible dialogs:', afterDialogs);

await writeFile(path.join(OUT, 'qp2-inner-currency-force-probe.json'), JSON.stringify({ angularState, beforeURL, beforeRowCount, clickResult, afterDialogs }, null, 2));
console.log('\n=== Wrote captures/qp2-inner-currency-force-probe.json ===');

await page.waitForTimeout(2000);
await ctx.close();
await browser.close();
