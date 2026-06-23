// Probe: find the Code input on the Message Template Create dialog.
// Earlier label-anchored XPath timed out. Dump all text inputs in the
// dialog with their nearby text so we can build a reliable locator.

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

const dump = await page.evaluate(() => {
  const dialogs = Array.from(document.querySelectorAll('.modal-content, mat-dialog-container')).filter((d) => d.offsetParent !== null);
  const dialog = dialogs.find((d) => /create\s*message\s*template/i.test(d.querySelector('.modal-header, .modal-title, h4, h5')?.textContent || ''))
              || dialogs[dialogs.length - 1];
  if (!dialog) return { error: 'no dialog' };
  const inputs = Array.from(dialog.querySelectorAll('input[type="text"]')).filter((el) => el.offsetParent !== null);
  return inputs.map((el, idx) => ({
    idx,
    fc: el.getAttribute('formcontrolname'),
    name: el.name,
    id: el.id,
    placeholder: el.placeholder,
    value: el.value,
    outerHTML: el.outerHTML.slice(0, 250),
    // Find ALL labels in the surrounding 5 ancestors
    nearbyLabels: (() => {
      const labels = [];
      let p = el;
      for (let i = 0; i < 5 && p.parentElement; i++) {
        p = p.parentElement;
        const lbls = Array.from(p.querySelectorAll('label, span.kt-font-bold, .form-label, h6, b'));
        for (const l of lbls) {
          const t = (l.textContent || '').replace(/\s+/g, ' ').trim();
          if (t && t.length < 30) labels.push({ tag: l.tagName.toLowerCase(), cls: (l.className || '').slice(0, 50), text: t });
        }
        if (labels.length > 0) break;
      }
      return labels.slice(0, 5);
    })(),
    // Parent chain for context
    parentChain: (() => {
      const chain = [];
      let p = el;
      for (let i = 0; i < 5 && p.parentElement; i++) {
        p = p.parentElement;
        chain.push(`${p.tagName.toLowerCase()}.${(p.className || '').slice(0, 50)}`);
      }
      return chain;
    })(),
  }));
});

await writeFile(path.join(OUT, 'qp2-msg-code-input-locate.json'), JSON.stringify(dump, null, 2));
console.log('=== All text inputs in Create Message Template dialog ===');
for (const i of dump) {
  console.log(`\n[${i.idx}] fc="${i.fc}" placeholder="${i.placeholder}" value="${i.value}"`);
  console.log(`     parents: ${i.parentChain.join(' < ')}`);
  console.log(`     nearby labels: ${i.nearbyLabels.map((l) => `<${l.tag}>"${l.text}"`).join(', ')}`);
}

await page.waitForTimeout(2000);
await ctx.close();
await browser.close();
