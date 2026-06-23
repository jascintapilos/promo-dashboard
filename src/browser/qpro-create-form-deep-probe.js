// Deep probe: open the QPRO Create Promotion Code form (modal/page) and
// dump the actual DOM around every field the canary keeps failing on, so we
// can repair selectors in src/bo-mapper-qpro.js and bin/canary-write.js.
//
//   node src/browser/qpro-create-form-deep-probe.js --site=qpro11
//
// Output: captures/<site>-create-form-deep-probe.json + screenshot.

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../../bin/_args.js';
import { getSite } from '../sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const site = getSite(flags.site || 'qpro11');
if (site.platform !== 'qpro') {
  console.error(`error: site "${site.id}" is platform "${site.platform}", expected qpro`);
  process.exit(2);
}

const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

// Use system Chrome — Playwright's bundled Chromium is blocked on this VDI.
const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 30 });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

// ── Login ────────────────────────────────────────────────────────────────
console.error(`[probe] login ${site.baseUrl}`);
await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.locator('input[formcontrolname="merchant_code"]').waitFor({ timeout: 20000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
const loginResp = page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
await page.locator('button:has-text("Login")').click();
await loginResp;
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

// ── Navigate to Promotion Codes list ─────────────────────────────────────
await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2500);

// ── Click "+ Create" (top-right action button) ───────────────────────────
let createClicked = false;
for (const sel of [
  '.kt-portlet__head-toolbar button:has-text("Create")',
  '.kt-portlet__head button:has-text("Create")',
  'button:has-text("+ Create")',
  'button:has-text("Create")',
]) {
  const btn = page.locator(sel).last();
  try {
    await btn.waitFor({ state: 'visible', timeout: 2000 });
    await btn.click({ timeout: 3000 });
    console.error(`[probe] clicked: ${sel}`);
    createClicked = true;
    break;
  } catch {}
}
if (!createClicked) { console.error('[probe] no Create button — aborting'); await browser.close(); process.exit(1); }
await page.waitForTimeout(3000);

// Save a baseline screenshot — invaluable for cross-checking against the JSON.
await page.screenshot({ path: path.join(OUT, `${site.id}-create-form-deep.png`), fullPage: true });
console.error(`[probe] form url=${page.url()}; screenshot saved`);

// ── 1. Dump every form input/select/textarea with rich context ──────────
const fields = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('input, select, textarea').forEach((el, idx) => {
    const fcn = el.getAttribute('formcontrolname') || '';
    let nearbyLabel = '';
    // Closest .form-group / row / label[for=id]
    if (el.id) {
      const lbl = document.querySelector(`label[for="${el.id}"]`);
      if (lbl) nearbyLabel = lbl.textContent.trim().slice(0, 80);
    }
    if (!nearbyLabel) {
      const fg = el.closest('.form-group, .kt-form__group, .row, .kt-input-icon, .col, .col-md-12, .col-md-6, .col-md-4');
      if (fg) {
        const lbl = fg.querySelector('label');
        if (lbl) nearbyLabel = lbl.textContent.trim().slice(0, 80);
      }
    }
    // Section: walk up to find a section header
    let section = '';
    let p = el.parentElement;
    for (let i = 0; i < 14 && p; i++) {
      const t = p.querySelector(':scope > .kt-portlet__head-label, :scope > h3, :scope > h4, :scope > .section-title, :scope > .kt-section__heading');
      if (t) { section = t.textContent.trim().slice(0, 60); break; }
      p = p.parentElement;
    }
    out.push({
      idx,
      tag: el.tagName.toLowerCase(),
      type: el.type || '',
      formcontrolname: fcn,
      placeholder: el.placeholder || '',
      label: nearbyLabel,
      section,
      visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
      disabled: el.disabled,
      ...(el.tagName === 'SELECT' ? { options: Array.from(el.options).map((o) => o.textContent.trim()) } : {}),
      ...(el.type === 'radio' || el.type === 'checkbox' ? { value: el.value, checked: el.checked } : {}),
    });
  });
  return out;
});
const visibleFields = fields.filter((f) => f.visible);
console.error(`[probe] ${visibleFields.length}/${fields.length} fields visible`);

// ── 2. Map kt-dropdown triggers to their labels ─────────────────────────
const dropdowns = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('kt-dropdown-wo-lazyload, kt-dropdown').forEach((el, idx) => {
    if (!el.offsetWidth && !el.offsetHeight) return;
    const trigger = el.querySelector('.c-btn');
    let label = '';
    // Walk up looking for a label
    let p = el.parentElement;
    for (let i = 0; i < 12 && p && !label; i++) {
      const lbl = p.querySelector(':scope > label, :scope > .form-group > label');
      if (lbl) label = lbl.textContent.trim().slice(0, 80);
      p = p.parentElement;
    }
    if (!label) {
      const fg = el.closest('.form-group, .kt-form__group, .row, .col-md-12, .col-md-6, .col-md-4');
      if (fg) {
        const lbl = fg.querySelector('label');
        if (lbl) label = lbl.textContent.trim().slice(0, 80);
      }
    }
    out.push({
      idx,
      tag: el.tagName.toLowerCase(),
      label,
      currentText: trigger ? trigger.textContent.trim().slice(0, 100) : '',
    });
  });
  return out;
});

// ── 3. Pick Deposit → surface promo_sub_type options ────────────────────
let subTypeInfo;
try {
  await page.locator('select[formcontrolname="promo_type"]').first().selectOption({ label: 'Deposit' });
  await page.waitForTimeout(800);
  const opts = await page.locator('select[formcontrolname="promo_sub_type"]').first().locator('option').allTextContents();
  subTypeInfo = { ok: true, options: opts };
} catch (e) {
  subTypeInfo = { ok: false, error: e.message.split('\n')[0].slice(0, 200) };
}

// ── 4. Probe each multiselect panel by opening it ───────────────────────
const panels = {};
const probeTargets = ['KYC Status', 'Game Providers', 'Categories', 'Member Group'];
for (const labelHook of probeTargets) {
  console.error(`[probe] opening multiselect: ${labelHook}`);
  let trigger;
  for (const sel of [
    `:has(label:has-text("${labelHook}")) kt-dropdown-wo-lazyload .c-btn`,
    `kt-dropdown-wo-lazyload .c-btn:near(label:has-text("${labelHook}"))`,
  ]) {
    const cand = page.locator(sel).last();
    try {
      await cand.waitFor({ state: 'visible', timeout: 1500 });
      trigger = cand;
      break;
    } catch {}
  }
  if (!trigger) {
    panels[labelHook] = { error: 'no trigger found' };
    continue;
  }
  try {
    await trigger.click({ timeout: 3000 });
    await page.waitForTimeout(900);
    const panelInfo = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('.dropdown-list, [class*="dropdown-list"]')).filter((p) => p.offsetParent !== null);
      const panel = all[all.length - 1];
      if (!panel) return { error: 'no visible panel after open' };
      const toggleCandidates = Array.from(panel.querySelectorAll('label')).map((lbl) => ({
        cls: lbl.className,
        text: lbl.textContent.trim().slice(0, 80),
        spanCount: lbl.querySelectorAll('span').length,
        spanTexts: Array.from(lbl.querySelectorAll('span')).map((s) => ({ text: s.textContent.trim(), hidden: s.hidden })),
        innerHTML: lbl.innerHTML.slice(0, 250),
      }));
      const items = Array.from(panel.querySelectorAll('li.pure-checkbox, li')).slice(0, 60).map((li, idx) => ({
        idx,
        cls: li.className,
        text: li.textContent.trim().slice(0, 120),
      }));
      return { panelClass: panel.className, panelTag: panel.tagName.toLowerCase(), itemCount: panel.querySelectorAll('li').length, toggleCandidates, items };
    });
    panels[labelHook] = panelInfo;
    await trigger.click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(400);
  } catch (e) {
    panels[labelHook] = { error: e.message.split('\n')[0].slice(0, 200) };
  }
}

// ── 5. Inspect radio groups (Target Type, Transfer Amount) ──────────────
const radios = await page.evaluate(() => {
  const arr = [];
  document.querySelectorAll('input[type="radio"]').forEach((el, idx) => {
    if (!el.offsetWidth && !el.offsetHeight) return;
    const lbl = el.closest('label') || (el.parentElement && el.parentElement.querySelector('label'));
    let groupLabel = '';
    const fg = el.closest('.form-group, .row, .kt-form__group');
    if (fg) {
      const gl = fg.querySelector('label');
      if (gl) groupLabel = gl.textContent.trim().slice(0, 80);
    }
    arr.push({
      idx,
      formcontrolname: el.getAttribute('formcontrolname') || '',
      formgroupname: el.closest('[formgroupname]')?.getAttribute('formgroupname') || '',
      value: el.value,
      checked: el.checked,
      groupLabel,
      label: lbl ? lbl.textContent.trim().slice(0, 60) : '',
    });
  });
  return arr;
});

const result = {
  site: site.id,
  url: page.url(),
  title: await page.title(),
  visibleFieldCount: visibleFields.length,
  visibleFields,
  dropdowns,
  panels,
  subTypeInfo,
  radios,
};
await writeFile(path.join(OUT, `${site.id}-create-form-deep-probe.json`), JSON.stringify(result, null, 2));
console.error(`[probe] wrote captures/${site.id}-create-form-deep-probe.json`);

await ctx.close();
await browser.close();
