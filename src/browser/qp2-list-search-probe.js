// Probe: navigate to the QP2A list page (/general/promotion-codes) and
// dump every form input/select to find the search field's formcontrolname.

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

await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2000);
await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

const dump = await page.evaluate(() => {
  const visible = (el) => el.offsetParent !== null;
  return {
    inputs: Array.from(document.querySelectorAll('input')).filter(visible).map((el) => ({
      fc: el.getAttribute('formcontrolname'),
      type: el.type,
      placeholder: el.placeholder,
      name: el.name,
      id: el.id,
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
    selects: Array.from(document.querySelectorAll('select')).filter(visible).map((el) => ({
      fc: el.getAttribute('formcontrolname'),
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
    searchButtons: Array.from(document.querySelectorAll('button')).filter((b) => visible(b) && /search/i.test(b.textContent || '')).map((b) => ({
      text: (b.textContent || '').trim().slice(0, 40),
      cls: (b.className || '').slice(0, 100),
    })),
  };
});

await writeFile(path.join(OUT, 'qp2-list-search-probe.json'), JSON.stringify(dump, null, 2));
console.log('=== Visible inputs on QP2 list page ===');
for (const i of dump.inputs) {
  console.log(`  fc="${i.fc}" type=${i.type} placeholder="${i.placeholder}" label="${i.nearbyLabel}"`);
}
console.log('\n=== Visible selects ===');
for (const s of dump.selects) {
  console.log(`  fc="${s.fc}" label="${s.nearbyLabel}"`);
}
console.log('\n=== Search buttons ===');
for (const b of dump.searchButtons) {
  console.log(`  text="${b.text}"`);
}

await ctx.close();
await browser.close();
