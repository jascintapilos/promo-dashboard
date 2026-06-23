// One-off probe: login to a QPRO BO, navigate to the "Create Promotion
// Code" form, dump every input/select element with its formcontrolname.
// Output: captures/<site>-create-form-selectors.json + screenshot.
//
//   node src/browser/qpro-create-form-probe.js --site=qpro11

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../../bin/_args.js';
import { getSite } from '../sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const headless = !(flags.headless === 'false' || process.env.HEADLESS === 'false');
const site = getSite(flags.site || 'qpro11');
if (site.platform !== 'qpro') {
  console.error(`error: site "${site.id}" is platform "${site.platform}", expected qpro`);
  process.exit(2);
}

const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

// ── Login ─────────────────────────────────────────────────────────────
console.error(`[probe] navigating to ${site.baseUrl}`);
await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.locator('input[formcontrolname="merchant_code"]').waitFor({ timeout: 20000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
// Block until the login XHR returns so we know we're authenticated.
const loginResp = page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
await page.locator('button:has-text("Login")').click();
await loginResp;
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
console.error(`[probe] logged in; url=${page.url()}`);

// ── Navigate to Promotion Code create form ────────────────────────────
// The QPRO localStorage navigation says the Promotion Code List is at
// /promotion/list. The Create page is typically /promotion/create or
// reachable from the list via a Create button.
console.error(`[probe] direct nav to /general/promotion-codes`);
await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2000);
console.error(`[probe] list url=${page.url()}`);
await page.screenshot({ path: path.join(OUT, `${site.id}-list.png`), fullPage: true }).catch(() => {});

// Try clicking a Create button on the list page.
let createClicked = false;
for (const sel of [
  'button:has-text("Create")',
  'button:has-text("+ Create")',
  'a:has-text("Create")',
  'button:has-text("New")',
  'button:has-text("Add")',
  '[routerlink*="create"]',
]) {
  const btn = page.locator(sel).first();
  if (await btn.count() > 0) {
    try { await btn.click({ timeout: 3000 }); console.error(`[probe] clicked: ${sel}`); createClicked = true; break; } catch {}
  }
}

// Fallback: direct URL guess based on the nav menu metadata.
if (!createClicked) {
  console.error(`[probe] no Create button found — trying direct /general/promotion-setup`);
  await page.goto(`${site.baseUrl}/general/promotion-setup`, { waitUntil: 'domcontentloaded', timeout: 20000 });
}
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(3000); // let Angular render the multi-column form

await page.screenshot({ path: path.join(OUT, `${site.id}-create-form.png`), fullPage: true }).catch(() => {});
console.error(`[probe] form url=${page.url()}`);
console.error(`[probe] title=${await page.title()}`);

// ── Dump form fields with rich context (parent section, options, nth) ─
const fields = await page.$$eval('input, select, textarea, [contenteditable]', (els) => els.map((e, idx) => {
  // Walk up to find a labeled section (kt-portlet, mat-card, fieldset, etc.)
  let section = '';
  let parent = e.parentElement;
  for (let i = 0; i < 10 && parent; i++) {
    const titleEl = parent.querySelector(':scope > .kt-portlet__head-label, :scope > h3, :scope > .section-title');
    if (titleEl) { section = titleEl.textContent.trim().slice(0, 80); break; }
    parent = parent.parentElement;
  }
  const out = {
    idx,
    tag: e.tagName.toLowerCase(),
    type: e.type || '',
    name: e.name || '',
    id: e.id || '',
    placeholder: e.placeholder || '',
    formcontrolname: e.getAttribute('formcontrolname') || '',
    formgroupname: e.getAttribute('formgroupname') || '',
    ariaLabel: e.getAttribute('aria-label') || '',
    section,
    visible: !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length),
  };
  if (e.tagName === 'SELECT') {
    out.options = Array.from(e.options).map((o) => ({ value: o.value, label: o.textContent.trim() }));
  }
  // For radios/checkboxes, capture the nearest label text
  if (e.type === 'radio' || e.type === 'checkbox') {
    const lbl = e.closest('label') || (e.parentElement && e.parentElement.querySelector('label'));
    out.label = (lbl && lbl.textContent.trim().slice(0, 80)) || '';
    out.checked = e.checked;
    out.value = e.value;
  }
  return out;
}));

const visibleFields = fields.filter((f) => f.visible && (f.formcontrolname || f.placeholder || f.name || (f.options && f.options.length)));
console.error(`[probe] captured ${fields.length} elements; ${visibleFields.length} visible+labeled`);

// Buttons too — for the "Save" / "Submit" guards we'll need later
const buttons = await page.$$eval('button, a[role="button"]', (els) => els.map((e, idx) => ({
  idx,
  text: (e.textContent || '').trim().slice(0, 80),
  type: e.type || '',
  visible: !!(e.offsetWidth || e.offsetHeight),
})).filter((b) => b.visible && b.text.length > 0 && b.text.length < 50));

// kt-dropdown / custom multi-select chips — the BO uses these for Game
// Providers, Categories, KYC tiers.
const multiselects = await page.$$eval('kt-dropdown-wo-lazyload, kt-dropdown, .multiselect, [class*="multi-select"]', (els) => els.map((e, idx) => ({
  idx,
  selector: e.tagName.toLowerCase() + (e.className ? '.' + e.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''),
  text: (e.textContent || '').trim().slice(0, 120),
  visible: !!(e.offsetWidth || e.offsetHeight),
}))).then((arr) => arr.filter((m) => m.visible));

const out = {
  site: site.id,
  url: page.url(),
  title: await page.title(),
  fields,
  visibleFields,
  buttons,
  multiselects,
};
await writeFile(path.join(OUT, `${site.id}-create-form-selectors.json`), JSON.stringify(out, null, 2));

// Print a compact summary: visible fields with formcontrolname, grouped by section/type.
const groups = {};
for (const f of visibleFields) {
  const key = f.formcontrolname || f.placeholder || `(${f.tag}-${f.type})`;
  const sub = f.options ? `select[${f.options.length}]` : (f.type || f.tag);
  groups[sub] = groups[sub] || [];
  groups[sub].push({ name: key, label: f.label, options: f.options?.slice(0, 8).map((o) => o.label).join('|') });
}
console.log('=== Visible fields by type ===');
for (const [k, arr] of Object.entries(groups)) {
  console.log(`\n[${k}]  ${arr.length}`);
  arr.forEach((a) => console.log(`  ${a.name.padEnd(35)} ${a.label || ''}${a.options ? '  opts={' + a.options + '}' : ''}`));
}
console.log('\n=== Multiselect components ===');
out.multiselects.forEach((m) => console.log('  ' + m.selector + '  →  ' + m.text.slice(0, 80)));
console.log('\n=== Save / Submit-like buttons ===');
out.buttons.filter((b) => /save|submit|create/i.test(b.text)).forEach((b) => console.log(`  [${b.idx}] "${b.text}"`));

await ctx.close();
await browser.close();
