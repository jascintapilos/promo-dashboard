// Probe: QP2 Dialog template at /settings/dialog (sidebar: 15.1.2 Dialog).
// Dumps the list page, opens Create, and dumps the form structure including
// per-Section/Type variations (Promotions / Rewards / Rebates / etc.).
//
//   node src/browser/qp2-dialog-form-probe.js

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
await page.waitForTimeout(2000);
console.log(`[nav] ${page.url()}`);
await page.screenshot({ path: path.join(OUT, 'qp2-dialog-list.png'), fullPage: true }).catch(() => {});

// Click Search to load list rows
try {
  await page.locator('button:has-text("Search")').first().click({ timeout: 5000 });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);
} catch {}

// Dump list page structure
const listInfo = await page.evaluate(() => {
  const heading = document.querySelector('.kt-portlet__head-label, h1, h2, h3')?.textContent?.trim() || '';
  const buttons = Array.from(document.querySelectorAll('button, a[role="button"]'))
    .filter((b) => b.offsetParent !== null)
    .map((b) => ({ text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50) }))
    .filter((b) => b.text && b.text.length < 50);
  const table = Array.from(document.querySelectorAll('table')).filter((t) => t.offsetParent !== null)[0];
  let headers = [], firstRows = [];
  if (table) {
    headers = Array.from(table.querySelectorAll('thead th, tr:first-child th')).map((h) => h.textContent.replace(/\s+/g, ' ').trim().slice(0, 40));
    firstRows = Array.from(table.querySelectorAll('tbody tr')).slice(0, 5).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.replace(/\s+/g, ' ').trim().slice(0, 60))
    );
  }
  return { heading, url: location.href, buttons, headers, firstRows };
});
console.log(`\n=== List page ===`);
console.log(`  heading: ${listInfo.heading}`);
console.log(`  url: ${listInfo.url}`);
console.log(`  table headers: ${JSON.stringify(listInfo.headers)}`);
console.log(`  first ${listInfo.firstRows.length} rows:`);
for (const r of listInfo.firstRows) console.log(`    ${r.join(' | ')}`);
console.log(`  buttons: ${listInfo.buttons.map((b) => `"${b.text}"`).join(', ')}`);

// Click Create
try {
  await page.locator('button:has-text("Create")').first().click({ timeout: 5000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, 'qp2-dialog-create-form-default.png'), fullPage: true }).catch(() => {});

  // Dump the create form fields
  const dumpForm = async (label) => {
    return await page.evaluate((lbl) => {
      const dlg = Array.from(document.querySelectorAll('mat-dialog-container, .modal-content, [role="dialog"]')).filter((d) => d.offsetParent !== null).pop()
                || document.body;
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
      const inputs = Array.from(dlg.querySelectorAll('input')).filter((el) => el.offsetParent !== null).map((el) => ({
        fc: el.getAttribute('formcontrolname'),
        type: el.type,
        placeholder: el.placeholder,
        value: el.value,
        required: el.required || el.hasAttribute('required'),
        nearbyLabel: getNearby(el),
      }));
      const selects = Array.from(dlg.querySelectorAll('select')).filter((el) => el.offsetParent !== null).map((el) => ({
        fc: el.getAttribute('formcontrolname'),
        valueLabel: el.options[el.selectedIndex]?.textContent?.trim() || null,
        options: Array.from(el.options).map((o) => ({ value: o.value, label: o.textContent.trim() })).slice(0, 30),
        nearbyLabel: getNearby(el),
      }));
      const tabs = Array.from(dlg.querySelectorAll('.mat-tab-label, [role="tab"], .nav-tabs li'))
        .filter((t) => t.offsetParent !== null)
        .map((t) => (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30));
      const hasEditor = !!dlg.querySelector('.ck-editor__editable, [contenteditable="true"]');
      return { label: lbl, title, tabs, hasEditor, inputs, selects };
    }, label);
  };

  const def = await dumpForm('default');
  console.log(`\n=== Create Dialog (default state) ===`);
  console.log(`  title: "${def.title}"`);
  console.log(`  tabs: ${def.tabs.join(', ')}`);
  console.log(`  hasEditor: ${def.hasEditor}`);
  console.log(`  visible inputs:`);
  for (const i of def.inputs) console.log(`    fc="${i.fc}" type=${i.type} val="${i.value}" placeholder="${i.placeholder}" label="${i.nearbyLabel}" ${i.required ? '[REQ]' : ''}`);
  console.log(`  visible selects:`);
  for (const s of def.selects) console.log(`    fc="${s.fc}" label="${s.nearbyLabel}" val="${s.valueLabel}" options=${JSON.stringify(s.options.slice(0, 10))}`);

  // If there's a `section` select, try each option to see if dynamic fields appear
  const sectionSel = page.locator('select[formcontrolname="section"]').last();
  const hasSectionSelect = await sectionSel.count() > 0;
  const variants = [];
  if (hasSectionSelect) {
    const sectionOptions = await sectionSel.evaluate((el) =>
      Array.from(el.options).map((o) => ({ value: o.value, label: o.textContent.trim() })).filter((o) => o.value && o.value !== 'null')
    );
    console.log(`\n=== Section options (${sectionOptions.length}) ===`);
    for (const opt of sectionOptions) console.log(`    "${opt.label}"`);

    // For each section option, also iterate type options
    for (const opt of sectionOptions.slice(0, 5)) {
      try {
        await sectionSel.selectOption({ label: opt.label });
        await page.waitForTimeout(800);
        // Try iterating "type" select too
        const typeSel = page.locator('select[formcontrolname="type"]').last();
        const hasType = await typeSel.count() > 0;
        if (hasType) {
          const typeOpts = await typeSel.evaluate((el) =>
            Array.from(el.options).map((o) => ({ value: o.value, label: o.textContent.trim() })).filter((o) => o.value && o.value !== 'null')
          );
          for (const tOpt of typeOpts.slice(0, 4)) {
            try {
              await typeSel.selectOption({ label: tOpt.label });
              await page.waitForTimeout(800);
              const v = await dumpForm(`section=${opt.label} / type=${tOpt.label}`);
              variants.push(v);
              console.log(`\n  ── ${v.label} ──`);
              for (const i of v.inputs) console.log(`     fc="${i.fc}" type=${i.type} label="${i.nearbyLabel}"`);
              for (const s of v.selects) console.log(`     fc="${s.fc}" label="${s.nearbyLabel}" val="${s.valueLabel}"`);
            } catch {}
          }
        } else {
          const v = await dumpForm(`section=${opt.label}`);
          variants.push(v);
        }
      } catch {}
    }
  }

  await writeFile(path.join(OUT, 'qp2-dialog-form-probe.json'), JSON.stringify({ listInfo, defaultForm: def, variants }, null, 2));
  console.log(`\nSaved: captures/qp2-dialog-form-probe.json`);
} catch (e) {
  console.log(`[FATAL] ${e.message.split('\n')[0]}`);
}

await page.waitForTimeout(2000);
await ctx.close();
await browser.close();
