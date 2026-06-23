// Probe: open the QP2A Message Template Create dialog and dump every form
// input/select. The canary's "The code has already been taken" 422 suggests
// the dialog has a Code field separate from Name that we're not filling
// (defaulting to something that collides).
//
// Run: node src/browser/qp2-msg-template-dialog-probe.js

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSite } from '../sites.js';

const site = getSite('ibc22');
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

await page.goto(`${site.baseUrl}/superuser/message-template`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2000);
await page.locator('button:has-text("Create")').first().click();
await page.waitForTimeout(2500);
console.log('[create-dialog] opened');

const dump = await page.evaluate(() => {
  const dialogs = Array.from(document.querySelectorAll('.modal-content, mat-dialog-container')).filter((d) => d.offsetParent !== null);
  const dialog = dialogs.find((d) => /create\s*message\s*template/i.test(d.querySelector('.modal-header, .modal-title, h4, h5')?.textContent || ''))
              || dialogs[dialogs.length - 1];
  if (!dialog) return { error: 'no dialog' };
  return {
    inputs: Array.from(dialog.querySelectorAll('input')).filter((el) => el.offsetParent !== null).map((el) => ({
      fc: el.getAttribute('formcontrolname'),
      type: el.type,
      placeholder: el.placeholder,
      value: el.value,
      required: el.required || el.getAttribute('required') !== null,
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
    selects: Array.from(dialog.querySelectorAll('select')).filter((el) => el.offsetParent !== null).map((el) => ({
      fc: el.getAttribute('formcontrolname'),
      valueLabel: el.options[el.selectedIndex]?.textContent?.trim() || null,
      options: Array.from(el.options).map((o) => ({ value: o.value, label: o.textContent.trim() })).slice(0, 30),
      required: el.required,
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
  };
});

await writeFile(path.join(OUT, 'qp2-msg-template-dialog-probe.json'), JSON.stringify(dump, null, 2));
console.log('=== Top-level inputs ===');
for (const i of dump.inputs) {
  console.log(`  fc="${i.fc}" type=${i.type} placeholder="${i.placeholder}" label="${i.nearbyLabel}" ${i.required ? '[REQ]' : ''}`);
}
console.log('=== Top-level selects ===');
for (const s of dump.selects) {
  console.log(`  fc="${s.fc}" label="${s.nearbyLabel}" value="${s.valueLabel}" options=${JSON.stringify(s.options.slice(0, 6))} ${s.required ? '[REQ]' : ''}`);
}

await page.waitForTimeout(2000);
await ctx.close();
await browser.close();
