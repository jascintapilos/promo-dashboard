// QP2 Dialog probe v4: page at /settings/dialog is the Dialog Popup
// IMAGE/Content management (per-locale thumbnails + Code). Click
// "Create New Content" and dump the create form.
//
//   node src/browser/qp2-dialog-form-probe-v4.js

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
console.log(`[nav] ${page.url()}`);

// Look at row 0 actions on the list to understand the per-row Edit/Duplicate flow
const rowDump = await page.evaluate(() => {
  const table = Array.from(document.querySelectorAll('table')).find((t) => t.offsetParent !== null);
  if (!table) return { ok: false, reason: 'no visible table' };
  const tr = table.querySelector('tbody tr');
  if (!tr) return { ok: false, reason: 'no row 0' };
  const cells = Array.from(tr.querySelectorAll('td'));
  const cellTexts = cells.map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80));
  const actions = cells[cells.length - 1];
  const allBtns = actions ? Array.from(actions.querySelectorAll('a, button, i, [role="button"]')).filter((el) => el.offsetParent !== null).map((el) => ({
    tag: el.tagName.toLowerCase(),
    text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30),
    title: el.getAttribute('title') || el.getAttribute('mattooltip') || el.getAttribute('aria-label') || '',
    cls: (el.className.toString() || '').slice(0, 100),
  })) : [];
  return { ok: true, cellTexts, allBtns };
});
console.log(`\n=== Row 0 cells ===`);
(rowDump.cellTexts || []).forEach((t, i) => console.log(`  [${i}] "${t}"`));
console.log(`\n=== Row 0 Actions ===`);
(rowDump.allBtns || []).forEach((b) => console.log(`  <${b.tag}> text="${b.text}" title="${b.title}" cls="${b.cls.slice(0, 80)}"`));

// Try Duplicate (fa-clone) on row 0 first — if exists
let actionTaken = null;
const dupResult = await page.evaluate(() => {
  const table = Array.from(document.querySelectorAll('table')).find((t) => t.offsetParent !== null);
  const tr = table?.querySelector('tbody tr');
  const actions = tr?.querySelectorAll('td');
  const actionsCell = actions?.[actions.length - 1];
  if (!actionsCell) return { ok: false };
  const dupBtn = actionsCell.querySelector('button[mattooltip*="Duplicate" i]')
              || Array.from(actionsCell.querySelectorAll('button')).find((b) => b.querySelector('i.fa-clone, i[class*="copy"], i[class*="clone"]'));
  if (dupBtn) { dupBtn.click(); return { ok: true }; }
  return { ok: false };
});
if (dupResult.ok) {
  actionTaken = 'duplicate-row-0';
  console.log(`\n[Duplicate] clicked on row 0`);
  await page.waitForTimeout(2500);
} else {
  // Fall back to clicking "Create New Content"
  try {
    await page.locator('button:has-text("Create New Content")').first().click({ timeout: 5000 });
    actionTaken = 'create-new';
    console.log('\n[Create New Content] clicked');
    await page.waitForTimeout(2500);
  } catch (e) {
    console.log(`[FATAL] no Duplicate AND no Create New Content: ${e.message.split('\n')[0]}`);
    await ctx.close(); await browser.close(); process.exit(2);
  }
}

await page.screenshot({ path: path.join(OUT, `qp2-dialog-form-v4-${actionTaken}.png`), fullPage: true }).catch(() => {});

// Dump the resulting form
const formDump = await page.evaluate(() => {
  const dialogs = Array.from(document.querySelectorAll('mat-dialog-container, .modal-content, [role="dialog"]')).filter((d) => d.offsetParent !== null);
  // Some forms render inline (no modal) — fall back to body
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
    id: el.id,
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
  const hasEditor = !!dlg.querySelector('.ck-editor__editable, [contenteditable="true"]');
  // File-upload fields are common on banner/dialog image forms
  const fileInputs = Array.from(dlg.querySelectorAll('input[type="file"]')).map((el) => ({
    fc: el.getAttribute('formcontrolname'),
    accept: el.accept,
    nearbyLabel: getNearby(el),
  }));
  return { title, tabs, hasEditor, visibleInputs, hiddenInputs, visibleSelects, textareas, fileInputs };
});

await writeFile(path.join(OUT, 'qp2-dialog-form-probe-v4.json'), JSON.stringify({ rowDump, formDump, actionTaken }, null, 2));
console.log(`\n=== Form (after ${actionTaken}) ===`);
console.log(`  title: "${formDump.title}"`);
console.log(`  tabs: ${(formDump.tabs || []).join(', ')}`);
console.log(`  hasEditor: ${formDump.hasEditor}`);
console.log(`  fileInputs: ${formDump.fileInputs?.length || 0}`);
for (const f of (formDump.fileInputs || [])) {
  console.log(`    file fc="${f.fc}" accept="${f.accept}" label="${f.nearbyLabel}"`);
}
console.log(`  visible inputs:`);
for (const i of (formDump.visibleInputs || [])) {
  console.log(`    fc="${i.fc}" type=${i.type} val="${(i.value || '').slice(0, 50)}" label="${i.nearbyLabel}"`);
}
console.log(`  visible selects:`);
for (const s of (formDump.visibleSelects || [])) {
  console.log(`    fc="${s.fc}" label="${s.nearbyLabel}" val="${s.valueLabel}" options=${s.optionCount}`);
}
console.log(`  textareas:`);
for (const t of (formDump.textareas || [])) {
  console.log(`    fc="${t.fc}" placeholder="${t.placeholder}" label="${t.nearbyLabel}"`);
}
console.log(`\nSaved: captures/qp2-dialog-form-probe-v4.json`);

await page.waitForTimeout(2500);
await ctx.close();
await browser.close();
