// QP2 Dialog probe v3: DON'T click Search — table loads on nav. Find the
// Dialog Popup table, click Duplicate on row 0, dump the form.
//
//   node src/browser/qp2-dialog-form-probe-v3.js

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
await page.waitForTimeout(3000);  // generous initial settle, NO Search click
console.log(`[nav] ${page.url()}`);
await page.screenshot({ path: path.join(OUT, 'qp2-dialog-list-v3.png'), fullPage: true }).catch(() => {});

// Dump all visible tables
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
allTables.forEach((t) => console.log(`  [${t.idx}] rows=${t.rowCount} headers=${JSON.stringify(t.headers.slice(0, 8))}…`));

// Find the Dialog Popup table — has "Code" header AND a row with DIALOG-POPUP in code column
const dialogTableIdx = allTables.findIndex((t) =>
  t.headers.includes('Code') && t.firstRow.some((c) => /DIALOG-POPUP|DIALOG_POPUP/i.test(c))
);
if (dialogTableIdx < 0) {
  console.log('[FATAL] no Dialog Popup table on page');
  await ctx.close(); await browser.close(); process.exit(2);
}
console.log(`[Dialog table] index ${dialogTableIdx}, row0: ${JSON.stringify(allTables[dialogTableIdx].firstRow.slice(0, 4))}`);

// Click Duplicate on row 0
const dupResult = await page.evaluate((tIdx) => {
  const tables = Array.from(document.querySelectorAll('table')).filter((t) => t.offsetParent !== null);
  const tr = tables[tIdx].querySelector('tbody tr');
  if (!tr) return { ok: false, reason: 'no row 0' };
  const actions = tr.querySelectorAll('td');
  const actionsCell = actions[actions.length - 1];
  const allBtns = Array.from(actionsCell.querySelectorAll('a, button, i, [role="button"]')).filter((el) => el.offsetParent !== null).map((el) => ({
    tag: el.tagName.toLowerCase(),
    text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30),
    title: el.getAttribute('title') || el.getAttribute('mattooltip') || el.getAttribute('aria-label') || '',
    cls: (el.className.toString() || '').slice(0, 100),
  }));
  const dupBtn = actionsCell.querySelector('button[mattooltip*="Duplicate" i]')
              || Array.from(actionsCell.querySelectorAll('button')).find((b) => b.querySelector('i.fa-clone, i[class*="copy"], i[class*="clone"]'));
  if (dupBtn) { dupBtn.click(); return { ok: true, allBtns, source: (actions[2]?.textContent || '').replace(/\s+/g, ' ').trim() }; }
  return { ok: false, reason: 'no duplicate button', allBtns };
}, dialogTableIdx);

console.log(`\n=== Row 0 Actions ===`);
for (const b of (dupResult.allBtns || [])) {
  console.log(`  <${b.tag}> text="${b.text}" title="${b.title}" cls="${b.cls.slice(0, 80)}"`);
}
if (!dupResult.ok) { console.log(`[FATAL] ${dupResult.reason}`); await ctx.close(); await browser.close(); process.exit(3); }
console.log(`[Duplicate] clicked → source: ${dupResult.source}`);

await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(OUT, 'qp2-dialog-duplicate-form-v3.png'), fullPage: true }).catch(() => {});

// Dump the resulting form
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
  // Also grab the visible body editor content / textareas for shape
  const textareas = Array.from(dlg.querySelectorAll('textarea')).filter((el) => el.offsetParent !== null).map((el) => ({
    fc: el.getAttribute('formcontrolname'),
    placeholder: el.placeholder,
    nearbyLabel: getNearby(el),
  }));
  return { title, tabs, hasEditor, visibleInputs, hiddenInputs, visibleSelects, textareas };
});

await writeFile(path.join(OUT, 'qp2-dialog-form-probe-v3.json'), JSON.stringify({ allTables, dupResult, formDump }, null, 2));
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
  if (s.fc === 'section' || s.fc === 'type') {
    console.log(`      → options=${JSON.stringify(s.options.map((o) => o.label))}`);
  }
}
console.log(`  textareas:`);
for (const t of (formDump.textareas || [])) {
  console.log(`    fc="${t.fc}" placeholder="${t.placeholder}" label="${t.nearbyLabel}"`);
}
console.log(`\nSaved: captures/qp2-dialog-form-probe-v3.json`);

await page.waitForTimeout(2000);
await ctx.close();
await browser.close();
