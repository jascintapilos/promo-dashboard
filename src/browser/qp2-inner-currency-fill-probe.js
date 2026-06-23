// Probe: replicate the canary's fill on the QP2 inner Create Promotion
// Currency form, then dump every ng-invalid field remaining. Tells us
// exactly which required field is missing (likely the dynamic field that
// appears after bonus_type=Percentage is set).
//
// Run: node src/browser/qp2-inner-currency-fill-probe.js
// Writes captures/qp2-inner-currency-fill-probe.json.

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
console.log('[login] ok');

await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2000);
await page.locator('button:has-text("Create")').first().click();
await page.waitForTimeout(2500);
await page.locator('form:has(input[formcontrolname="code"]) select[formcontrolname="promo_type"]').last().selectOption({ label: 'Deposit' });
await page.waitForTimeout(2500);
console.log('[setup] Deposit picked');

// Open Currency popup + Add
await page.locator('button:has-text("Promotion Currency")').first().click();
await page.waitForTimeout(2000);
const addBtn = page.locator('button:visible').filter({ hasText: /^\s*\+?\s*Add\s*$/i }).last();
await addBtn.click({ timeout: 5000 });
await page.waitForTimeout(2500);
console.log('[inner-form] opened');

// Dump #1: initial state of inner form
const dump1 = await dumpInnerForm(page, 'BEFORE FILL');

// Fill the inner form like the canary does, in selects-first order:
//   1. currency_id = MYR
//   2. bonus_type = Percentage (may reveal dynamic field)
//   3. max_withdraw_type = Fixed Amount (may reveal dynamic field)
//   4. min_deposit = 50
//   5. status = Active
//   6. (anything else the dynamic fields need)
const innerLocator = (sel) => page.locator(`.modal-content:has(:text("Create Promotion Currency")) ${sel}`).last();

await innerLocator('select[formcontrolname="currency_id"]').selectOption({ label: 'MYR' });
await page.waitForTimeout(800);
console.log('[fill] currency_id=MYR');

await innerLocator('select[formcontrolname="bonus_type"]').selectOption({ label: 'Percentage' });
await page.waitForTimeout(1500);  // let dynamic fields render
console.log('[fill] bonus_type=Percentage');

const dump2 = await dumpInnerForm(page, 'AFTER bonus_type=Percentage');

await innerLocator('select[formcontrolname="max_withdraw_type"]').selectOption({ label: 'Fixed Amount' });
await page.waitForTimeout(1500);
console.log('[fill] max_withdraw_type=Fixed Amount');

const dump3 = await dumpInnerForm(page, 'AFTER max_withdraw_type=Fixed Amount');

await innerLocator('input[formcontrolname="min_deposit"]').fill('50');
await page.waitForTimeout(500);
console.log('[fill] min_deposit=50');

// Mirror the qp2 mapper's row exactly (selects-first order, then inputs):
const candidatesToFill = [
  ['min_deposit', '50'],
  ['max_bonus', '100'],
  ['bonus_rate', '50'],
  ['max_withdraw', '100'],
];
for (const [fc, val] of candidatesToFill) {
  try {
    const loc = innerLocator(`input[formcontrolname="${fc}"]`);
    if (await loc.count() > 0 && await loc.isVisible().catch(() => false)) {
      await loc.fill(val);
      console.log(`[fill] ${fc}=${val} ✓`);
    }
  } catch (e) {
    // ignore
  }
}
await page.waitForTimeout(800);

const dumpFinal = await dumpInnerForm(page, 'FINAL — after all attempted fills');

await writeFile(path.join(OUT, 'qp2-inner-currency-fill-probe.json'), JSON.stringify({ dump1, dump2, dump3, dumpFinal }, null, 2));
console.log('\n=== Wrote captures/qp2-inner-currency-fill-probe.json ===');

await ctx.close();
await browser.close();

async function dumpInnerForm(page, label) {
  const dump = await page.evaluate((label) => {
    const dialogs = Array.from(document.querySelectorAll('.modal-content')).filter((d) => d.offsetParent !== null);
    const innerDialog = dialogs.find((d) => {
      const h = d.querySelector('.modal-header, .modal-title, h4, h5')?.textContent || '';
      return /create\s+promotion\s+currency/i.test(h);
    });
    if (!innerDialog) return { label, error: 'no inner dialog' };
    const submitBtn = Array.from(innerDialog.querySelectorAll('button')).find((b) => /^\s*Submit\s*$/i.test((b.textContent || '').trim()));

    // ALL .ng-invalid descendants (visible OR hidden) — to catch a hidden
    // required field that's blocking Submit.
    const allInvalids = Array.from(innerDialog.querySelectorAll('.ng-invalid')).map((el) => ({
      tag: el.tagName.toLowerCase(),
      fc: el.getAttribute('formcontrolname'),
      type: el.type || null,
      value: el.value || null,
      visible: el.offsetParent !== null,
      cls: (el.className || '').slice(0, 150),
    }));
    // ALL inputs/selects whether visible or not
    const allInputs = Array.from(innerDialog.querySelectorAll('input')).map((el) => ({
      fc: el.getAttribute('formcontrolname'),
      type: el.type,
      value: el.value,
      checked: el.checked,
      visible: el.offsetParent !== null,
      ngInvalid: el.classList.contains('ng-invalid'),
      required: el.required || el.hasAttribute('required'),
      nearbyLabel: (() => {
        let p = el;
        for (let i = 0; i < 5 && p.parentElement; i++) {
          p = p.parentElement;
          const lbl = p.querySelector('label, span.kt-font-bold, .form-label');
          if (lbl && lbl !== el) return (lbl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        }
        return null;
      })(),
    }));
    const allSelects = Array.from(innerDialog.querySelectorAll('select')).map((el) => ({
      fc: el.getAttribute('formcontrolname'),
      valueLabel: el.options[el.selectedIndex]?.textContent?.trim() || null,
      visible: el.offsetParent !== null,
      ngInvalid: el.classList.contains('ng-invalid'),
      required: el.required,
    }));

    return {
      label,
      submitDisabled: submitBtn?.disabled,
      submitClasses: submitBtn?.className,
      formClasses: innerDialog.querySelector('form')?.className || null,
      formIsValid: innerDialog.querySelector('form')?.classList.contains('ng-valid'),
      allInvalids,
      inputs: allInputs.filter((el) => el.visible),
      hiddenInputs: allInputs.filter((el) => !el.visible),
      selects: allSelects.filter((el) => el.visible),
      hiddenSelects: allSelects.filter((el) => !el.visible),
    };
  }, label);

  console.log(`\n=== ${dump.label} ===  Submit disabled: ${dump.submitDisabled} | Form valid: ${dump.formIsValid}`);
  if (dump.allInvalids?.length) {
    console.log('ALL .ng-invalid descendants (incl. hidden):');
    for (const i of dump.allInvalids) {
      console.log(`  <${i.tag} fc="${i.fc}" type=${i.type}> val="${i.value}" visible=${i.visible} cls="${i.cls.slice(0, 60)}"`);
    }
  }
  console.log('Visible Inputs:');
  for (const i of dump.inputs) {
    console.log(`  fc="${i.fc}" type=${i.type} val="${i.value}" ${i.checked != null ? `checked=${i.checked}` : ''} label="${i.nearbyLabel}" ${i.required ? '[REQ]' : ''} ${i.ngInvalid ? '[INVALID]' : ''}`);
  }
  if (dump.hiddenInputs?.length) {
    console.log('HIDDEN Inputs:');
    for (const i of dump.hiddenInputs) {
      console.log(`  fc="${i.fc}" type=${i.type} val="${i.value}" ${i.required ? '[REQ]' : ''} ${i.ngInvalid ? '[INVALID]' : ''}`);
    }
  }
  console.log('Selects:');
  for (const s of dump.selects) {
    console.log(`  fc="${s.fc}" val="${s.valueLabel}" ${s.ngInvalid ? '[INVALID]' : ''}`);
  }
  if (dump.hiddenSelects?.length) {
    console.log('HIDDEN Selects:');
    for (const s of dump.hiddenSelects) {
      console.log(`  fc="${s.fc}" val="${s.valueLabel}" ${s.ngInvalid ? '[INVALID]' : ''}`);
    }
  }
  return dump;
}
