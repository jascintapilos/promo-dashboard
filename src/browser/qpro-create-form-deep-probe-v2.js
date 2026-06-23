// v2 deep probe — scopes EVERYTHING to the [role="dialog"]:visible modal so
// we don't pick up filters from the underlying list page. Picks Deposit so
// sub-types load. Picks KYC Type = "KYC Status" so the tier multiselect
// appears. Then captures the modal's dropdown structure precisely.
//
//   node src/browser/qpro-create-form-deep-probe-v2.js --site=qpro11

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../../bin/_args.js';
import { getSite } from '../sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const site = getSite(flags.site || 'qpro11');
const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 30 });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

// Login
await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.locator('input[formcontrolname="merchant_code"]').waitFor({ timeout: 20000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
const loginResp = page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
await page.locator('button:has-text("Login")').click();
await loginResp;
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2500);

// Click Create — last button to favor the top-right action button
await page.locator('button:has-text("Create")').last().click({ timeout: 3000 });
await page.waitForTimeout(3000);

const dialog = page.locator('[role="dialog"]:visible').last();

// Pick Deposit promo type, wait for sub-types to load
await dialog.locator('select[formcontrolname="promo_type"]:visible').selectOption({ label: 'Deposit' });
await page.waitForTimeout(2000); // give Angular time to repopulate sub-types

// Probe sub-type options
let subTypeOptions;
try {
  subTypeOptions = await dialog.locator('select[formcontrolname="promo_sub_type"]:visible').locator('option').allTextContents();
} catch (e) { subTypeOptions = { error: e.message.slice(0, 200) }; }

// Pick KYC Type = "KYC Status" so the tier multiselect appears
let kycTypeOptions = [];
try {
  kycTypeOptions = await dialog.locator('select[formcontrolname="kyc_type"]:visible').locator('option').allTextContents();
  await dialog.locator('select[formcontrolname="kyc_type"]:visible').selectOption({ label: 'KYC Status' });
  await page.waitForTimeout(1500);
} catch (e) { kycTypeOptions = { error: e.message.slice(0, 200) }; }

// Take a screenshot now that the form is in its filled-with-Deposit state
await page.screenshot({ path: path.join(OUT, `${site.id}-create-form-v2.png`), fullPage: true });

// 1. Map every visible <label> in the dialog → the next field after it
const labelMap = await dialog.evaluate((root) => {
  const out = [];
  const labels = root.querySelectorAll('label');
  labels.forEach((lbl, idx) => {
    const text = lbl.textContent.trim().slice(0, 80);
    if (!text) return;
    // Walk forward in DOM until we find an input/select/textarea/kt-dropdown
    let node = lbl.parentElement;
    let field = null;
    let fieldType = '';
    let formcontrolname = '';
    let currentText = '';
    let options = null;
    // Look in the parent for the field (label sibling-or-cousin pattern)
    while (node && !field) {
      // Try direct children that are form fields
      field = node.querySelector('input, select, textarea, kt-dropdown-wo-lazyload, kt-dropdown');
      if (field) break;
      node = node.parentElement;
      if (node === root) break;
    }
    if (!field) return;
    fieldType = field.tagName.toLowerCase();
    formcontrolname = field.getAttribute('formcontrolname') || '';
    if (fieldType === 'select') {
      options = Array.from(field.options).map((o) => o.textContent.trim());
    } else if (fieldType.startsWith('kt-dropdown')) {
      const trigger = field.querySelector('.c-btn');
      currentText = trigger ? trigger.textContent.trim().slice(0, 80) : '';
    } else {
      currentText = field.type || '';
    }
    out.push({ idx, labelText: text, fieldType, formcontrolname, currentText, options });
  });
  return out;
}, await dialog.elementHandle());

// 2. For each kt-dropdown in the dialog, open it and capture its panel
const probedDropdowns = {};
const ktDropdownLabels = labelMap.filter((m) => m.fieldType.startsWith('kt-dropdown')).map((m) => m.labelText);
for (const lbl of ktDropdownLabels) {
  console.error(`[probe] opening dropdown for label: "${lbl}"`);
  // Find within the dialog: the kt-dropdown's trigger near label text `lbl`
  const triggerInDialog = dialog.locator(`:has(label:text-is("${lbl}")) kt-dropdown-wo-lazyload .c-btn, :has(label:text-is("${lbl}")) kt-dropdown .c-btn`).last();
  try {
    await triggerInDialog.waitFor({ state: 'visible', timeout: 2000 });
    await triggerInDialog.click({ timeout: 3000 });
    await page.waitForTimeout(900);
    const panelInfo = await page.evaluate(() => {
      const panels = Array.from(document.querySelectorAll('.dropdown-list, [class*="dropdown-list"]')).filter((p) => p.offsetParent !== null);
      const panel = panels[panels.length - 1];
      if (!panel) return { error: 'no visible panel' };
      const toggle = Array.from(panel.querySelectorAll('label')).filter((l) => l.querySelectorAll('span').length >= 1 && !l.className.includes('ng-star-inserted'));
      const items = Array.from(panel.querySelectorAll('li.pure-checkbox, li')).slice(0, 80).map((li, idx) => ({
        idx,
        cls: li.className,
        text: li.textContent.trim().slice(0, 120),
      }));
      return {
        panelClass: panel.className,
        itemCount: panel.querySelectorAll('li').length,
        toggleLabel: toggle.length ? toggle[0].innerHTML.slice(0, 250) : null,
        items,
      };
    });
    probedDropdowns[lbl] = panelInfo;
    // Close
    await triggerInDialog.click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(400);
  } catch (e) {
    probedDropdowns[lbl] = { error: e.message.split('\n')[0].slice(0, 200) };
  }
}

// 3. Radios in the dialog — find label associations
const radiosInDialog = await dialog.evaluate((root) => {
  const arr = [];
  root.querySelectorAll('input[type="radio"]').forEach((el, idx) => {
    const visible = !!(el.offsetWidth || el.offsetHeight);
    // Find adjacent text/label
    let adjacentText = '';
    if (el.nextElementSibling) adjacentText = el.nextElementSibling.textContent.trim().slice(0, 40);
    if (!adjacentText && el.parentElement) {
      const lbl = el.parentElement.querySelector('label');
      adjacentText = lbl ? lbl.textContent.trim().slice(0, 40) : '';
    }
    // Find the group label (in the row/form-group)
    let groupLabel = '';
    const fg = el.closest('.form-group, .row, .kt-form__group');
    if (fg) {
      const lbl = fg.querySelector('label');
      if (lbl) groupLabel = lbl.textContent.trim().slice(0, 60);
    }
    arr.push({ idx, visible, formcontrolname: el.getAttribute('formcontrolname') || '', value: el.value, checked: el.checked, adjacentText, groupLabel });
  });
  return arr;
}, await dialog.elementHandle());

const out = {
  site: site.id,
  url: page.url(),
  title: await page.title(),
  subTypeOptions,
  kycTypeOptions,
  labelMap,
  probedDropdowns,
  radiosInDialog,
};
await writeFile(path.join(OUT, `${site.id}-create-form-v2.json`), JSON.stringify(out, null, 2));
console.error(`[probe] wrote captures/${site.id}-create-form-v2.json`);

await ctx.close();
await browser.close();
