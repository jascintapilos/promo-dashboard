// v2: open row 0 dialog, dump EVERY visible input/textarea/contenteditable
// on the page (no container scoping). Diagnostic to figure out actual
// form selectors.
//
//   node src/browser/dialog-content-probe-v2.js --site=ibc22

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../../bin/_args.js';
import { getSite } from '../sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const site = getSite(flags.site || 'ibc22');
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
console.log('[login] ok');

await page.goto(`${site.baseUrl}/settings/dialog`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(3000);

// Click eye icon on row 0
const opened = await page.evaluate(() => {
  const table = Array.from(document.querySelectorAll('table')).find((t) => t.offsetParent !== null);
  const tr = table?.querySelector('tbody tr');
  const actions = tr?.querySelectorAll('td');
  const actionsCell = actions?.[actions.length - 1];
  if (!actionsCell) return false;
  const eye = actionsCell.querySelector('i.fa-eye, [class*="eye"], button[mattooltip*="View" i], button[mattooltip*="Detail" i]');
  if (eye) { (eye.closest('button') || eye).click(); return true; }
  const first = actionsCell.querySelector('button, a, i');
  if (first) { first.click(); return true; }
  return false;
});
console.log(`[click] ${opened}`);
await page.waitForTimeout(3000);
await page.screenshot({ path: path.join(OUT, 'dialog-after-eye-click.png'), fullPage: true }).catch(() => {});

// Dump EVERY visible form element on the page (not scoped)
const allFields = await page.evaluate(() => {
  const getNearby = (el) => {
    let p = el;
    for (let i = 0; i < 6 && p.parentElement; i++) {
      p = p.parentElement;
      const labels = Array.from(p.querySelectorAll('label, span.kt-font-bold, .form-label, h6, b'));
      for (const l of labels) {
        const t = (l.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && t.length < 50) return t;
      }
    }
    return null;
  };
  const inputs = Array.from(document.querySelectorAll('input, textarea, select'))
    .filter((el) => el.offsetParent !== null)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.type || '',
      fc: el.getAttribute('formcontrolname'),
      name: el.name,
      id: el.id,
      placeholder: el.placeholder,
      value: (el.value || '').slice(0, 200),
      nearbyLabel: getNearby(el),
    }));
  const editors = Array.from(document.querySelectorAll('.ck-editor__editable[contenteditable="true"], [contenteditable="true"]'))
    .filter((el) => el.offsetParent !== null)
    .map((el) => ({
      cls: (el.className.toString() || '').slice(0, 60),
      html: el.innerHTML.slice(0, 600),
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      nearbyLabel: getNearby(el),
    }));
  const radios = Array.from(document.querySelectorAll('input[type="radio"]'))
    .filter((el) => el.offsetParent !== null)
    .map((el) => ({
      fc: el.getAttribute('formcontrolname'),
      name: el.name,
      checked: el.checked,
      value: el.value,
      nearbyLabel: getNearby(el),
    }));
  const tabs = Array.from(document.querySelectorAll('.mat-tab-label, [role="tab"], .nav-tabs li'))
    .filter((t) => t.offsetParent !== null)
    .map((t) => (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30));
  return { inputs, editors, radios, tabs };
});

await writeFile(path.join(OUT, 'dialog-content-probe-v2-fields.json'), JSON.stringify(allFields, null, 2));
console.log(`\n=== Visible form elements after eye-click ===`);
console.log(`tabs: ${allFields.tabs.join(' | ')}`);
console.log(`\n${allFields.inputs.length} inputs/selects:`);
for (const i of allFields.inputs) {
  console.log(`  <${i.tag}${i.type ? ` type=${i.type}` : ''}> fc="${i.fc}" name="${i.name}" placeholder="${i.placeholder}" label="${i.nearbyLabel}" val="${(i.value || '').slice(0, 60)}"`);
}
console.log(`\n${allFields.radios.length} radios:`);
for (const r of allFields.radios) console.log(`  fc="${r.fc}" name="${r.name}" checked=${r.checked} val="${r.value}" label="${r.nearbyLabel}"`);
console.log(`\n${allFields.editors.length} CKEditor / contenteditable:`);
for (const e of allFields.editors) console.log(`  cls="${e.cls}" label="${e.nearbyLabel}" text="${e.text.slice(0, 200)}"`);
console.log(`\nSaved: captures/dialog-content-probe-v2-fields.json`);

await page.waitForTimeout(3000);
await ctx.close();
await browser.close();
