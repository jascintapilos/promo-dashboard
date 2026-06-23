// QP2 Dialog probe v2: click Duplicate on an existing Dialog Popup row
// (same pattern as Message Template) and dump the resulting form.
//
//   node src/browser/qp2-dialog-form-probe-v2.js

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
await page.waitForTimeout(2500);
console.log(`[nav] ${page.url()}`);

// Click Search to load the Dialog Popup table
try {
  await page.locator('button:has-text("Search")').first().click({ timeout: 5000 });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);
} catch {}

// Dump ALL tables visible on the page
const allTables = await page.evaluate(() => {
  const tables = Array.from(document.querySelectorAll('table')).filter((t) => t.offsetParent !== null);
  return tables.map((t, idx) => ({
    idx,
    headers: Array.from(t.querySelectorAll('thead th, tr:first-child th')).map((h) => h.textContent.replace(/\s+/g, ' ').trim().slice(0, 30)),
    rowCount: t.querySelectorAll('tbody tr').length,
    firstRow: Array.from(t.querySelectorAll('tbody tr:first-child td')).map((td) => td.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)),
  }));
});
console.log(`\n=== ${allTables.length} visible tables ===`);
allTables.forEach((t) => {
  console.log(`  [${t.idx}] rows=${t.rowCount} headers=${JSON.stringify(t.headers)}`);
  console.log(`      firstRow=${JSON.stringify(t.firstRow.slice(0, 4))}…`);
});

// Find the Dialog Popup table (header includes "Code" + has DIALOG-POPUP in first row)
const dialogTableIdx = allTables.findIndex((t) =>
  t.headers.includes('Code') && t.firstRow.some((c) => /DIALOG-POPUP|DIALOG_POPUP/i.test(c))
);
if (dialogTableIdx < 0) {
  console.log('[FATAL] no Dialog Popup table on page');
  await page.screenshot({ path: path.join(OUT, 'qp2-dialog-probe-v2-no-table.png'), fullPage: true }).catch(() => {});
  await ctx.close();
  await browser.close();
  process.exit(2);
}
console.log(`[Dialog table] index ${dialogTableIdx}`);

// Dump row 0's Actions cell and click Duplicate (fa-clone)
const rowProbe = await page.evaluate((tIdx) => {
  const tables = Array.from(document.querySelectorAll('table')).filter((t) => t.offsetParent !== null);
  const tbody = tables[tIdx].querySelector('tbody');
  const tr = tbody?.querySelector('tr');
  if (!tr) return { ok: false, reason: 'no row 0' };
  const cells = tr.querySelectorAll('td');
  const actions = cells[cells.length - 1];
  if (!actions) return { ok: false, reason: 'no actions cell' };
  // Dump all clickable elements in actions cell
  const clickables = Array.from(actions.querySelectorAll('a, button, i, [role="button"]')).filter((el) => el.offsetParent !== null).map((el) => ({
    tag: el.tagName.toLowerCase(),
    text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
    title: el.getAttribute('title') || el.getAttribute('mattooltip') || el.getAttribute('aria-label') || '',
    cls: (el.className.toString() || '').slice(0, 120),
  }));
  // Click anything matching duplicate / clone / copy
  const dupBtn = actions.querySelector('button[mattooltip*="Duplicate" i]')
              || Array.from(actions.querySelectorAll('button')).find((b) => b.querySelector('i.fa-clone, i[class*="copy"], i[class*="clone"]'));
  if (dupBtn) { dupBtn.click(); return { ok: true, via: 'duplicate-btn', clickables, source: (cells[2]?.textContent || cells[1]?.textContent || '').replace(/\s+/g, ' ').trim() }; }
  return { ok: false, reason: 'no duplicate button found', clickables };
}, dialogTableIdx);

console.log(`\n=== Row 0 Actions ===`);
for (const c of (rowProbe.clickables || [])) {
  console.log(`  <${c.tag}> text="${c.text}" title="${c.title}" cls="${c.cls.slice(0, 80)}"`);
}
if (!rowProbe.ok) {
  console.log(`[FATAL] ${rowProbe.reason}`);
  await page.screenshot({ path: path.join(OUT, 'qp2-dialog-probe-v2-no-dup.png'), fullPage: true }).catch(() => {});
  await ctx.close();
  await browser.close();
  process.exit(3);
}
console.log(`[Duplicate] clicked → source: ${rowProbe.source}`);

await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(OUT, 'qp2-dialog-duplicate-form.png'), fullPage: true }).catch(() => {});

// Dump the resulting dialog form
const formDump = await page.evaluate(() => {
  const dialogs = Array.from(document.querySelectorAll('mat-dialog-container, .modal-content, [role="dialog"]')).filter((d) => d.offsetParent !== null);
  if (!dialogs.length) return { error: 'no dialog' };
  const dlg = dialogs[dialogs.length - 1];
  const title = dlg.querySelector('.modal-header, .modal-title, h4, h5, mat-dialog-title')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) || '';
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
    name: el.name,
    type: el.type,
    placeholder: el.placeholder,
    value: el.value,
    nearbyLabel: getNearby(el),
  }));
  const hiddenInputs = Array.from(dlg.querySelectorAll('input[type="hidden"]')).map((el) => ({
    fc: el.getAttribute('formcontrolname'),
    name: el.name,
    id: el.id,
    value: el.value,
  }));
  const visibleSelects = Array.from(dlg.querySelectorAll('select')).filter((el) => el.offsetParent !== null).map((el) => ({
    fc: el.getAttribute('formcontrolname'),
    valueLabel: el.options[el.selectedIndex]?.textContent?.trim() || null,
    optionCount: el.options.length,
    nearbyLabel: getNearby(el),
    options: Array.from(el.options).map((o) => ({ value: o.value, label: o.textContent.trim() })).slice(0, 25),
  }));
  const tabs = Array.from(dlg.querySelectorAll('.mat-tab-label, [role="tab"], .nav-tabs li'))
    .filter((t) => t.offsetParent !== null)
    .map((t) => (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30));
  const hasEditor = !!dlg.querySelector('.ck-editor__editable, [contenteditable="true"]');
  return { title, tabs, hasEditor, visibleInputs, hiddenInputs, visibleSelects };
});

await writeFile(path.join(OUT, 'qp2-dialog-form-probe-v2.json'), JSON.stringify({ allTables, rowProbe, formDump }, null, 2));
console.log(`\n=== Duplicate Dialog form ===`);
console.log(`  title: "${formDump.title}"`);
console.log(`  tabs: ${(formDump.tabs || []).join(', ')}`);
console.log(`  hasEditor: ${formDump.hasEditor}`);
console.log(`  visible inputs:`);
for (const i of (formDump.visibleInputs || [])) {
  console.log(`    fc="${i.fc}" type=${i.type} val="${(i.value || '').slice(0, 50)}" label="${i.nearbyLabel}"`);
}
console.log(`  hidden inputs:`);
for (const i of (formDump.hiddenInputs || [])) {
  console.log(`    fc="${i.fc}" name="${i.name}" id="${i.id}" value="${(i.value || '').slice(0, 80)}"`);
}
console.log(`  visible selects:`);
for (const s of (formDump.visibleSelects || [])) {
  console.log(`    fc="${s.fc}" label="${s.nearbyLabel}" val="${s.valueLabel}" options=${s.optionCount}`);
}

console.log(`\nSaved: captures/qp2-dialog-form-probe-v2.json`);

await page.waitForTimeout(2000);
await ctx.close();
await browser.close();
