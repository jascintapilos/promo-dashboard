// Probe: open the QP2A IBC22 Create Promotion Code form (Deposit type)
// and dump:
//   1. Merchant dropdown options
//   2. Member Group dropdown options
//   3. Frequency dropdown options
//   4. The Currency popup inner form's fields (after clicking + Add)
//   5. All ng-invalid descendants of the form
//
// Run: node src/browser/qp2-form-probe.js
// Writes captures/qp2-form-probe.json.

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

const result = { merchant: null, memberGroup: null, frequency: null, ngInvalid: null, innerCurrencyForm: null };

// 1. Open Merchant kt-dropdown and dump options
result.merchant = await openKtAndDump(page, 'Merchant');
// 2. Member Group
result.memberGroup = await openKtAndDump(page, 'Member Group');
// 3. Frequency — it's a native <select>, dump directly
result.frequency = await page.evaluate(() => {
  const sel = document.querySelector('select[formcontrolname="frequency_type"]');
  return sel ? Array.from(sel.options).map((o) => ({ value: o.value, label: o.textContent.trim() })) : null;
});
console.log('[frequency]', result.frequency);

// 4. Pre-fill the bare minimum so we can open the Currency popup
// (the popup might be gated on certain fields being filled).
// For QP2 Deposit, the popup is usually enabled regardless.
await page.locator('input[formcontrolname="code"]').last().fill('TEST_PROBE_DELETEME');
await page.locator('input[formcontrolname="name"]').last().fill('Test probe — delete me');
await page.waitForTimeout(500);

// Try to open "+ Promotion Currency"
try {
  await page.locator('button:has-text("Promotion Currency")').first().click({ timeout: 5000 });
  await page.waitForTimeout(2000);
  console.log('[currency-popup] opened');

  // Click + Add
  const addBtn = page.locator('button:visible').filter({ hasText: /^\s*\+?\s*Add\s*$/i }).last();
  await addBtn.click({ timeout: 5000 });
  await page.waitForTimeout(2500);
  console.log('[currency-add] inner Create form opened');

  // Dump inner form fields
  result.innerCurrencyForm = await page.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll('.modal-content')).filter((d) => d.offsetParent !== null);
    const innerDialog = dialogs.find((d) => {
      const h = d.querySelector('.modal-header, .modal-title, h4, h5')?.textContent || '';
      return /create\s+promotion\s+currency/i.test(h);
    });
    if (!innerDialog) return { error: 'no inner dialog with header "Create Promotion Currency"' };

    return {
      inputs: Array.from(innerDialog.querySelectorAll('input')).filter((el) => el.offsetParent !== null).map((el) => ({
        formcontrolname: el.getAttribute('formcontrolname'),
        type: el.type,
        value: el.value,
        required: el.required || el.getAttribute('required') !== null,
        ngInvalid: el.classList.contains('ng-invalid'),
        nearbyLabel: (() => {
          let p = el;
          for (let i = 0; i < 5 && p.parentElement; i++) {
            p = p.parentElement;
            const lbl = p.querySelector('label, span.kt-font-bold, .form-label');
            if (lbl && lbl !== el) return (lbl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
          }
          return null;
        })(),
      })),
      selects: Array.from(innerDialog.querySelectorAll('select')).filter((el) => el.offsetParent !== null).map((el) => ({
        formcontrolname: el.getAttribute('formcontrolname'),
        valueLabel: el.options[el.selectedIndex]?.textContent?.trim() || null,
        options: Array.from(el.options).map((o) => o.textContent.trim()).slice(0, 20),
        ngInvalid: el.classList.contains('ng-invalid'),
        required: el.required,
      })),
      submitState: (() => {
        const submit = Array.from(innerDialog.querySelectorAll('button')).find((b) => /^\s*Submit\s*$/i.test((b.textContent || '').trim()));
        return submit ? { disabled: submit.disabled, cls: submit.className } : null;
      })(),
    };
  });
  console.log('[inner-currency-form] dumped');
} catch (e) {
  result.innerCurrencyForm = { error: e.message.split('\n')[0] };
  console.log(`[currency-popup-err] ${e.message.split('\n')[0]}`);
}

// 5. Dump all ng-invalid descendants on the OUTER form
result.ngInvalid = await page.evaluate(() => {
  const form = document.querySelector('form:has(input[formcontrolname="code"])');
  if (!form) return null;
  const invalids = Array.from(form.querySelectorAll('.ng-invalid')).filter((el) => el.offsetParent !== null);
  return invalids.map((el) => ({
    tag: el.tagName.toLowerCase(),
    formcontrolname: el.getAttribute('formcontrolname'),
    formgroupname: el.getAttribute('formgroupname'),
    cls: (el.className || '').slice(0, 200),
    nearbyLabel: (() => {
      let p = el;
      for (let i = 0; i < 5 && p.parentElement; i++) {
        p = p.parentElement;
        const lbl = p.querySelector('span.kt-font-bold, label, .form-label');
        if (lbl && lbl !== el) return (lbl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      }
      return null;
    })(),
  }));
});

await writeFile(path.join(OUT, 'qp2-form-probe.json'), JSON.stringify(result, null, 2));
console.log('\n=== Wrote captures/qp2-form-probe.json ===');
console.log('Merchant options:', JSON.stringify(result.merchant, null, 2));
console.log('Member Group options:', JSON.stringify(result.memberGroup, null, 2));
console.log('Frequency options:', JSON.stringify(result.frequency, null, 2));
if (result.innerCurrencyForm && result.innerCurrencyForm.inputs) {
  console.log('Inner Currency form fields:');
  for (const f of result.innerCurrencyForm.inputs) {
    console.log(`  input  fc="${f.formcontrolname}" label="${f.nearbyLabel}" ${f.required ? '[REQ]' : ''} ${f.ngInvalid ? '[INVALID]' : ''}`);
  }
  for (const s of result.innerCurrencyForm.selects) {
    console.log(`  select fc="${s.formcontrolname}" options=${JSON.stringify(s.options)} ${s.required ? '[REQ]' : ''} ${s.ngInvalid ? '[INVALID]' : ''}`);
  }
  console.log('Submit state:', result.innerCurrencyForm.submitState);
}
console.log('Outer form INVALID fields:');
if (result.ngInvalid) for (const i of result.ngInvalid) console.log(`  <${i.tag} fc="${i.formcontrolname}"> label="${i.nearbyLabel}"`);

await ctx.close();
await browser.close();

// Helper to open a kt-dropdown and dump its options
async function openKtAndDump(page, label) {
  try {
    const formScope = page.locator('form:has(input[formcontrolname="code"])').last();
    const triggerXpath = `xpath=.//span[contains(@class,'kt-font-bold') and starts-with(normalize-space(.), ${JSON.stringify(label)})]/following::*[contains(@class,'c-btn')][1]`;
    const trigger = formScope.locator(triggerXpath).first();
    await trigger.waitFor({ timeout: 5000 });
    await trigger.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    await trigger.click({ force: true, timeout: 3000 });
    await page.waitForTimeout(1000);
    const items = await page.evaluate(() => {
      const panels = Array.from(document.querySelectorAll('.dropdown-list')).filter((p) => p.offsetParent !== null);
      const panel = panels[panels.length - 1];
      if (!panel) return [];
      return Array.from(panel.querySelectorAll('li')).map((li) => (li.textContent || '').replace(/\s+/g, ' ').trim()).filter((t) => t && !/select all|unselect all|please select/i.test(t)).slice(0, 50);
    });
    console.log(`[${label}] options:`, items);
    // Close panel
    await trigger.click({ force: true, timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(500);
    return items;
  } catch (e) {
    console.log(`[${label}] err: ${e.message.split('\n')[0]}`);
    return null;
  }
}
