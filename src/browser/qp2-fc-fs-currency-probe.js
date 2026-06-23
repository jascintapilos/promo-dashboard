// Probe: dump the inner "Create Promotion Currency" form for Free Credit
// and Free Spin bonus types on QP2 (IBC22). Tells us:
//   - Which fields are present per bonus type
//   - Which are required (ng-invalid before fill, .required attr, has *)
//   - Which select options are visible (so the mapper picks valid values)
//   - Which dynamic fields appear after promo_type / bonus_type selection
//
// Output: captures/qp2-fc-fs-currency-probe.json
//
//   node src/browser/qp2-fc-fs-currency-probe.js

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSite } from '../sites.js';

const site = getSite('ibc22');
const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 35, args: ['--start-maximized'] });
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

const results = {};
for (const bonusLabel of ['Free Credit', 'Free Spin']) {
  console.log(`\n\n══════ Probing ${bonusLabel} ══════`);
  try {
    await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200);

    // Create form
    await page.locator('button:has-text("Create")').first().click();
    await page.waitForTimeout(2500);
    console.log('  [create] form opened');

    // Pick promo_type — scoped to the outer Create form to avoid the
    // Currency popup's promo_type select (if any).
    const promoTypeSelect = page.locator('form:has(input[formcontrolname="code"]) select[formcontrolname="promo_type"]').last();
    await promoTypeSelect.selectOption({ label: bonusLabel });
    await page.waitForTimeout(2500);
    console.log(`  [setup] promo_type="${bonusLabel}" picked`);

    // Some bonus types also need promo_sub_type set before the Currency
    // popup unlocks. Try Welcome first, fall back to anything available.
    try {
      const subTypeSelect = page.locator('form:has(input[formcontrolname="code"]) select[formcontrolname="promo_sub_type"]').last();
      const opts = await subTypeSelect.evaluate((el) =>
        Array.from(el.options).map((o) => o.textContent.trim()).filter((t) => t && !/please/i.test(t))
      );
      console.log(`  [setup] promo_sub_type options: ${JSON.stringify(opts)}`);
      const preferred = opts.find((o) => /welcome/i.test(o)) || opts.find((o) => /reload/i.test(o)) || opts[0];
      if (preferred) {
        await subTypeSelect.selectOption({ label: preferred });
        await page.waitForTimeout(1500);
        console.log(`  [setup] promo_sub_type="${preferred}"`);
      }
    } catch (e) {
      console.log(`  [setup] promo_sub_type skip: ${e.message.split('\n')[0]}`);
    }

    // Open Currency popup.
    await page.locator('button:has-text("Promotion Currency")').first().click();
    await page.waitForTimeout(2000);
    console.log('  [currency] popup opened');

    // Click + Add to open the inner form.
    const addBtn = page.locator('button:visible').filter({ hasText: /^\s*\+?\s*Add\s*$/i }).last();
    await addBtn.click({ timeout: 5000 });
    await page.waitForTimeout(2500);
    console.log('  [inner-form] opened');
    await page.screenshot({ path: path.join(OUT, `qp2-${bonusLabel.toLowerCase().replace(/\s+/g, '-')}-currency-inner.png`), fullPage: true }).catch(() => {});

    // Dump the inner form fields.
    const dump = await page.evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll('.modal-content')).filter((d) => d.offsetParent !== null);
      const inner = dialogs.find((d) => {
        const h = d.querySelector('.modal-header, .modal-title, h4, h5')?.textContent || '';
        return /create\s+promotion\s+currency/i.test(h);
      });
      if (!inner) return { error: 'no inner Create Promotion Currency dialog' };

      const getNearbyLabel = (el) => {
        let p = el;
        for (let i = 0; i < 6 && p.parentElement; i++) {
          p = p.parentElement;
          const lbl = p.querySelector('label, span.kt-font-bold, .form-label');
          if (lbl && lbl !== el) {
            const t = (lbl.textContent || '').replace(/\s+/g, ' ').trim();
            if (t && t.length < 80) return t;
          }
        }
        return null;
      };

      const allInputs = Array.from(inner.querySelectorAll('input')).map((el) => ({
        fc: el.getAttribute('formcontrolname'),
        type: el.type,
        value: el.value,
        checked: el.checked,
        visible: el.offsetParent !== null,
        ngInvalid: el.classList.contains('ng-invalid'),
        required: el.required || el.hasAttribute('required'),
        labelHasAsterisk: (() => {
          const l = getNearbyLabel(el);
          return l ? /\*/.test(l) : false;
        })(),
        nearbyLabel: getNearbyLabel(el),
      }));

      const allSelects = Array.from(inner.querySelectorAll('select')).map((el) => ({
        fc: el.getAttribute('formcontrolname'),
        valueLabel: el.options[el.selectedIndex]?.textContent?.trim() || null,
        visible: el.offsetParent !== null,
        ngInvalid: el.classList.contains('ng-invalid'),
        required: el.required,
        labelHasAsterisk: (() => {
          const l = getNearbyLabel(el);
          return l ? /\*/.test(l) : false;
        })(),
        nearbyLabel: getNearbyLabel(el),
        options: Array.from(el.options).map((o) => ({ value: o.value, label: o.textContent.trim() })).slice(0, 25),
      }));

      return {
        title: inner.querySelector('.modal-header, .modal-title, h4, h5')?.textContent?.replace(/\s+/g, ' ').trim() || '',
        inputs: allInputs,
        selects: allSelects,
      };
    });

    results[bonusLabel] = dump;
    if (dump.error) {
      console.log(`  ⚠ ${dump.error}`);
    } else {
      console.log(`  Title: "${dump.title}"`);
      console.log(`  --- Visible inputs ---`);
      for (const i of dump.inputs.filter((x) => x.visible)) {
        const tag = `${i.required || i.labelHasAsterisk ? '*' : ' '}${i.ngInvalid ? '!' : ' '}`;
        console.log(`   ${tag} fc="${i.fc}" type=${i.type} val="${i.value}" lbl="${i.nearbyLabel}"`);
      }
      console.log(`  --- Visible selects ---`);
      for (const s of dump.selects.filter((x) => x.visible)) {
        const tag = `${s.required || s.labelHasAsterisk ? '*' : ' '}${s.ngInvalid ? '!' : ' '}`;
        const opts = s.options.slice(0, 6).map((o) => o.label).join(', ');
        console.log(`   ${tag} fc="${s.fc}" lbl="${s.nearbyLabel}" val="${s.valueLabel}" opts=[${opts}${s.options.length > 6 ? '...' : ''}]`);
      }
      const hiddenInvalid = dump.inputs.filter((x) => !x.visible && x.ngInvalid);
      if (hiddenInvalid.length) {
        console.log(`  --- Hidden but ng-invalid (required-but-not-rendered?) ---`);
        for (const i of hiddenInvalid) {
          console.log(`     fc="${i.fc}" type=${i.type} val="${i.value}"`);
        }
      }
    }

    // Close the dialogs back out for the next iteration.
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(700);
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(700);
  } catch (e) {
    console.log(`  ⚠ ${bonusLabel} probe failed: ${e.message.split('\n')[0]}`);
    results[bonusLabel] = { error: e.message };
  }
}

await writeFile(path.join(OUT, 'qp2-fc-fs-currency-probe.json'), JSON.stringify(results, null, 2));
console.log('\nSaved: captures/qp2-fc-fs-currency-probe.json');

await page.waitForTimeout(1500);
await ctx.close();
await browser.close();
