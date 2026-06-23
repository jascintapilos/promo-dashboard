// Probe: open the FS Currency popup on QPRO11 and dump every visible
// button (text, classes, disabled state, parent dialog/panel). The
// canary's popup_fill_currency handler uses `/^\s*\+?\s*Add\s*$/i` to
// find the "+ Add" button — if FS uses different button text (e.g.
// "Add Currency"), the regex misses and the handler times out.
//
// Run: node src/browser/qpro-fs-currency-add-probe.js
// Writes captures/qpro11-fs-currency-add-probe.json.

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
console.log('[login] ok');

await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2000);
await page.locator('button:has-text("Create")').first().click();
await page.waitForTimeout(2500);
console.log('[create-form] opened');

// Pick Free Spin
await page.locator('form:has(input[formcontrolname="code"]) select[formcontrolname="promo_type"]').last().selectOption({ label: 'Free Spin' });
await page.waitForTimeout(2500);
console.log('[promo-type] Free Spin');

// Pick Provider + Game so "+ Promotion Currency" becomes enabled
const formScope = page.locator('form:has(input[formcontrolname="code"])').last();
async function pickKtDropdown(rowLabel, triggerNth, regex) {
  const triggerXpath = `xpath=(.//span[contains(@class,'kt-font-bold') and contains(normalize-space(.), ${JSON.stringify(rowLabel)})])[1]/following::*[contains(@class,'c-btn')]`;
  const trigger = formScope.locator(triggerXpath).nth(triggerNth);
  await trigger.waitFor({ timeout: 5000 });
  await trigger.click({ timeout: 3000 });
  await page.waitForTimeout(700);
  await page.locator('.dropdown-list:visible li').filter({ hasText: regex }).first().click({ timeout: 3000 });
  await page.waitForTimeout(500);
  if (await page.locator('.dropdown-list:visible').count() > 0) {
    await trigger.click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(300);
  }
}
await pickKtDropdown('Free Spin Games', 0, /PP2 - Pragmatic Play/i);
await page.waitForTimeout(1500);
await pickKtDropdown('Free Spin Games', 1, /Gates of Olympus Super Scatter/i);
await page.waitForTimeout(800);
console.log('[fs-games] both picked');

// Open "+ Promotion Currency" popup
await page.locator('button:has-text("Promotion Currency")').first().click();
await page.waitForTimeout(2000);
console.log('[currency-popup] opened');

// Click the Add button (regex match on /^\s*\+?\s*Add\s*$/i — same as canary)
const addBtn = page.locator('button:visible').filter({ hasText: /^\s*\+?\s*Add\s*$/i }).last();
await addBtn.waitFor({ state: 'visible', timeout: 5000 });
await addBtn.click({ timeout: 3000 });
await page.waitForTimeout(2500);
console.log('[currency-popup-add] inner Create form opened');

// Dump every visible button + every visible dialog/modal-content
// PLUS every field in the innermost "Create Promotion Currency" form
// so we can identify which required formcontrolnames the mapper isn't filling.
const dump = await page.evaluate(() => {
  const visible = (el) => el.offsetParent !== null;
  const all = Array.from(document.querySelectorAll('button')).filter(visible);

  // Find the innermost dialog (header = "Create Promotion Currency")
  const dialogs = Array.from(document.querySelectorAll('.modal-content')).filter(visible);
  const innerDialog = dialogs.find((d) => {
    const h = d.querySelector('.modal-header, .modal-title, h4, h5')?.textContent || '';
    return /create\s+promotion\s+currency/i.test(h);
  });

  // Walk the inner form fields
  const fieldDump = innerDialog ? {
    inputs: Array.from(innerDialog.querySelectorAll('input')).filter(visible).map((el) => ({
      formcontrolname: el.getAttribute('formcontrolname'),
      type: el.type,
      placeholder: el.placeholder,
      name: el.name,
      value: el.value,
      required: el.required || el.getAttribute('required') !== null,
      ngInvalid: el.classList.contains('ng-invalid'),
      ngDirty: el.classList.contains('ng-dirty'),
      ngTouched: el.classList.contains('ng-touched'),
      disabled: el.disabled,
      nearbyLabel: (() => {
        let p = el;
        for (let i = 0; i < 4 && p.parentElement; i++) {
          p = p.parentElement;
          const lbl = p.querySelector('label, span.kt-font-bold, th, .form-label');
          if (lbl && lbl !== el) return (lbl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        }
        return null;
      })(),
    })),
    selects: Array.from(innerDialog.querySelectorAll('select')).filter(visible).map((el) => ({
      formcontrolname: el.getAttribute('formcontrolname'),
      name: el.name,
      ngInvalid: el.classList.contains('ng-invalid'),
      required: el.required,
      options: Array.from(el.options).map((o) => o.textContent.trim()).slice(0, 20),
      valueLabel: el.options[el.selectedIndex]?.textContent?.trim() || null,
    })),
    submitState: (() => {
      const submit = Array.from(innerDialog.querySelectorAll('button')).find((b) => /^\s*Submit\s*$/i.test((b.textContent || '').trim()));
      return submit ? { disabled: submit.disabled, ngClass: submit.className } : null;
    })(),
  } : null;

  return {
    allButtons: all.map((b, i) => ({
      idx: i,
      text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      cls: (b.className || '').slice(0, 200),
      disabled: b.disabled,
      type: b.type,
      parentContext: (() => {
        let p = b;
        for (let i = 0; i < 10 && p.parentElement; i++) {
          p = p.parentElement;
          if (p.tagName === 'KT-MODAL' ||
              p.classList?.contains('modal-content') ||
              p.classList?.contains('modal-dialog') ||
              p.classList?.contains('cdk-overlay-pane') ||
              p.getAttribute?.('role') === 'dialog') {
            return p.tagName.toLowerCase() + (p.className ? '.' + p.className.split(' ').join('.') : '');
          }
        }
        return null;
      })(),
    })),
    dialogs: Array.from(document.querySelectorAll('kt-modal, .modal-content, .modal-dialog, .cdk-overlay-pane, [role="dialog"]')).filter(visible).map((d) => ({
      tag: d.tagName.toLowerCase(),
      cls: d.className || '',
      headerText: (d.querySelector('.modal-header, .modal-title, h4, h5, kt-portlet-head')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      buttonTexts: Array.from(d.querySelectorAll('button')).filter((b) => b.offsetParent !== null).map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)),
    })),
    innerForm: fieldDump,
  };
});

await writeFile(path.join(OUT, 'qpro11-fs-currency-add-probe.json'), JSON.stringify(dump, null, 2));
console.log('=== Wrote captures/qpro11-fs-currency-add-probe.json ===');
console.log('Button candidates matching /Add/i:');
for (const b of dump.allButtons) {
  if (/Add/i.test(b.text)) {
    console.log(`  text="${b.text}" disabled=${b.disabled} parent=${b.parentContext}`);
  }
}
console.log('Visible dialogs:');
for (const d of dump.dialogs) {
  console.log(`  ${d.tag}${d.cls ? `.${d.cls.split(' ').join('.')}` : ''}  header="${d.headerText}"  buttons=[${d.buttonTexts.join(', ')}]`);
}
if (dump.innerForm) {
  console.log('\n=== INNER Create Promotion Currency form fields ===');
  console.log('Submit state:', dump.innerForm.submitState);
  console.log('\nINPUTS:');
  for (const f of dump.innerForm.inputs) {
    const flags = [
      f.required ? 'required' : '',
      f.ngInvalid ? 'INVALID' : '',
      f.disabled ? 'disabled' : '',
    ].filter(Boolean).join(',');
    console.log(`  formcontrolname="${f.formcontrolname}" type=${f.type} value="${f.value}" label="${f.nearbyLabel}" ${flags ? '[' + flags + ']' : ''}`);
  }
  console.log('\nSELECTS:');
  for (const s of dump.innerForm.selects) {
    const flags = [
      s.required ? 'required' : '',
      s.ngInvalid ? 'INVALID' : '',
    ].filter(Boolean).join(',');
    console.log(`  formcontrolname="${s.formcontrolname}" value="${s.valueLabel}" options=${JSON.stringify(s.options)} ${flags ? '[' + flags + ']' : ''}`);
  }
}

await ctx.close();
await browser.close();
