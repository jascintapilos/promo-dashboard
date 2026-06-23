// QP2 Dialog probe v5: rows have leading checkbox + no inline actions.
// Workflow: tick row checkbox → click top-bar Duplicate button.
//
//   node src/browser/qp2-dialog-form-probe-v5.js

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

await page.goto(`${site.baseUrl}/settings/dialog`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(3000);

// Tick the checkbox in row 0 (first <td>)
const tickResult = await page.evaluate(() => {
  const table = Array.from(document.querySelectorAll('table')).find((t) => t.offsetParent !== null);
  const tr = table?.querySelector('tbody tr');
  if (!tr) return { ok: false, reason: 'no row 0' };
  const firstCell = tr.querySelector('td');
  const cb = firstCell?.querySelector('input[type="checkbox"]');
  if (cb) { cb.click(); return { ok: true, via: 'first-cell-checkbox' }; }
  // Some material tables wrap checkboxes in <mat-checkbox>
  const mc = firstCell?.querySelector('mat-checkbox, [class*="checkbox"]');
  if (mc) { mc.click(); return { ok: true, via: 'mat-checkbox' }; }
  return { ok: false, reason: 'no checkbox in first cell', html: firstCell?.innerHTML?.slice(0, 200) };
});
console.log(`[checkbox] ${JSON.stringify(tickResult)}`);
await page.waitForTimeout(800);

// Try clicking the top-bar Duplicate button
let opened = false;
try {
  await page.locator('button:has-text("Duplicate")').first().click({ timeout: 5000 });
  opened = true;
  console.log('[Duplicate] clicked top-bar Duplicate');
} catch (e) {
  console.log(`[Duplicate] click failed: ${e.message.split('\n')[0]}`);
}

if (!opened) {
  // Fall back to clicking the row (some BO tables open Edit on row click)
  try {
    await page.locator('table tbody tr').first().click({ timeout: 5000 });
    opened = true;
    console.log('[row-click] clicked row 0');
  } catch (e) {
    console.log(`[row-click] failed: ${e.message.split('\n')[0]}`);
  }
}

if (!opened) {
  console.log('[FATAL] could not open any form');
  await page.screenshot({ path: path.join(OUT, 'qp2-dialog-form-v5-fatal.png'), fullPage: true }).catch(() => {});
  await ctx.close(); await browser.close(); process.exit(2);
}

await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(OUT, 'qp2-dialog-form-v5-form.png'), fullPage: true }).catch(() => {});

// Dump form
const formDump = await page.evaluate(() => {
  const dialogs = Array.from(document.querySelectorAll('mat-dialog-container, .modal-content, [role="dialog"]')).filter((d) => d.offsetParent !== null);
  const dlg = dialogs.length ? dialogs[dialogs.length - 1] : document.body;
  const title = dlg.querySelector('.modal-header, .modal-title, h4, h5, mat-dialog-title, .kt-portlet__head-label')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) || '';
  const getNearby = (el) => {
    let p = el;
    for (let i = 0; i < 5 && p.parentElement; i++) {
      p = p.parentElement;
      const l = p.querySelector('label, span.kt-font-bold, .form-label');
      if (l && l !== el) {
        const t = (l.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && t.length < 60) return t;
      }
    }
    return null;
  };
  const visibleInputs = Array.from(dlg.querySelectorAll('input')).filter((el) => el.offsetParent !== null).map((el) => ({
    fc: el.getAttribute('formcontrolname'),
    type: el.type,
    placeholder: el.placeholder,
    value: el.value,
    nearbyLabel: getNearby(el),
  }));
  const hiddenInputs = Array.from(dlg.querySelectorAll('input[type="hidden"]')).map((el) => ({
    fc: el.getAttribute('formcontrolname'),
    name: el.name,
    value: (el.value || '').slice(0, 80),
  }));
  const visibleSelects = Array.from(dlg.querySelectorAll('select')).filter((el) => el.offsetParent !== null).map((el) => ({
    fc: el.getAttribute('formcontrolname'),
    valueLabel: el.options[el.selectedIndex]?.textContent?.trim() || null,
    optionCount: el.options.length,
    nearbyLabel: getNearby(el),
    options: Array.from(el.options).map((o) => ({ value: o.value, label: o.textContent.trim() })).slice(0, 20),
  }));
  const textareas = Array.from(dlg.querySelectorAll('textarea')).filter((el) => el.offsetParent !== null).map((el) => ({
    fc: el.getAttribute('formcontrolname'),
    placeholder: el.placeholder,
    nearbyLabel: getNearby(el),
  }));
  const tabs = Array.from(dlg.querySelectorAll('.mat-tab-label, [role="tab"], .nav-tabs li'))
    .filter((t) => t.offsetParent !== null)
    .map((t) => (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30));
  const fileInputs = Array.from(dlg.querySelectorAll('input[type="file"]')).map((el) => ({
    fc: el.getAttribute('formcontrolname'),
    accept: el.accept,
    nearbyLabel: getNearby(el),
  }));
  const hasCkEditor = !!dlg.querySelector('.ck-editor__editable, [contenteditable="true"]');
  return { title, tabs, hasCkEditor, visibleInputs, hiddenInputs, visibleSelects, textareas, fileInputs };
});

await writeFile(path.join(OUT, 'qp2-dialog-form-probe-v5.json'), JSON.stringify({ tickResult, formDump }, null, 2));
console.log(`\n=== Form ===`);
console.log(`  title: "${formDump.title}"`);
console.log(`  tabs: ${(formDump.tabs || []).join(', ')}`);
console.log(`  hasCkEditor: ${formDump.hasCkEditor}`);
console.log(`  fileInputs: ${formDump.fileInputs?.length || 0}`);
for (const f of (formDump.fileInputs || [])) console.log(`    file fc="${f.fc}" accept="${f.accept}" label="${f.nearbyLabel}"`);
console.log(`  visible inputs:`);
for (const i of (formDump.visibleInputs || [])) {
  console.log(`    fc="${i.fc}" type=${i.type} val="${(i.value || '').slice(0, 50)}" label="${i.nearbyLabel}"`);
}
console.log(`  visible selects:`);
for (const s of (formDump.visibleSelects || [])) {
  console.log(`    fc="${s.fc}" label="${s.nearbyLabel}" val="${s.valueLabel}" options=${s.optionCount}`);
  if (s.optionCount < 12) console.log(`      → ${JSON.stringify(s.options.map((o) => o.label))}`);
}
console.log(`  textareas:`);
for (const t of (formDump.textareas || [])) console.log(`    fc="${t.fc}" label="${t.nearbyLabel}"`);
console.log(`\nSaved: captures/qp2-dialog-form-probe-v5.json`);

await page.waitForTimeout(2500);
await ctx.close();
await browser.close();
