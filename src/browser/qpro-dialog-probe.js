// QPRO Dialog Popup probe — find the route and dump the form.
// User said "Module 14 CMS > Announcements > Dialog" on QPRO.
//
//   node src/browser/qpro-dialog-probe.js --site=qpro11

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../../bin/_args.js';
import { getSite } from '../sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const site = getSite(flags.site || 'qpro11');
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
console.log(`[login] ${site.id}`);
await page.waitForTimeout(2000);

// ── Dump every routerlink (find Dialog + Announcement) ─────────────
const allRouterlinks = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('[routerlink], [routerLink], a[href^="/"]'));
  return els.map((el) => ({
    text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100),
    routerlink: el.getAttribute('routerlink') || el.getAttribute('routerLink') || '',
    href: el.getAttribute('href') || '',
    visible: !!(el.offsetWidth || el.offsetHeight),
  })).filter((e) => e.routerlink || e.href);
});
console.log(`\n=== All routerlinks (${allRouterlinks.length}) ===`);
for (const r of allRouterlinks) {
  console.log(`  [${r.visible ? 'V' : ' '}] "${r.text.slice(0, 60)}" → ${r.routerlink || r.href}`);
}

const dialogLink = allRouterlinks.find((r) => /dialog/i.test(r.text) || /dialog/i.test(r.routerlink) || /dialog/i.test(r.href));
if (!dialogLink) {
  console.log('[FATAL] no routerlink containing "dialog"');
  await page.screenshot({ path: path.join(OUT, `${site.id}-dialog-probe-no-link.png`), fullPage: true }).catch(() => {});
  await ctx.close(); await browser.close(); process.exit(2);
}
console.log(`[Dialog link] "${dialogLink.text}" → ${dialogLink.routerlink || dialogLink.href}`);

const dialogUrl = dialogLink.routerlink || dialogLink.href;
await page.goto(`${site.baseUrl}${dialogUrl}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(3000);
console.log(`[nav] ${page.url()}`);
await page.screenshot({ path: path.join(OUT, `${site.id}-dialog-list.png`), fullPage: true }).catch(() => {});

// Dump list page structure
const listInfo = await page.evaluate(() => {
  const heading = document.querySelector('.kt-portlet__head-label, h1, h2, h3')?.textContent?.trim() || '';
  const buttons = Array.from(document.querySelectorAll('button'))
    .filter((b) => b.offsetParent !== null)
    .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50))
    .filter((t) => t && t.length < 50);
  const tables = Array.from(document.querySelectorAll('table'))
    .filter((t) => t.offsetParent !== null)
    .slice(0, 3)
    .map((t) => ({
      headers: Array.from(t.querySelectorAll('thead th, tr:first-child th')).map((h) => h.textContent.replace(/\s+/g, ' ').trim().slice(0, 30)),
      rowCount: t.querySelectorAll('tbody tr').length,
      firstRow: Array.from(t.querySelectorAll('tbody tr:first-child td')).map((td) => td.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)),
    }));
  return { heading, url: location.href, buttons, tables };
});
console.log(`\n=== ${site.id} Dialog list page ===`);
console.log(`  heading: ${listInfo.heading}`);
console.log(`  url: ${listInfo.url}`);
console.log(`  buttons: ${listInfo.buttons.slice(0, 30).join(' | ')}`);
console.log(`  tables (${listInfo.tables.length}):`);
listInfo.tables.forEach((t, i) => {
  console.log(`    [${i}] rows=${t.rowCount} headers=${JSON.stringify(t.headers.slice(0, 12))}`);
  console.log(`        firstRow=${JSON.stringify(t.firstRow.slice(0, 8))}`);
});

// Try Duplicate via row checkbox + top-bar
let opened = false;
const tickResult = await page.evaluate(() => {
  const table = Array.from(document.querySelectorAll('table')).find((t) => t.offsetParent !== null);
  const tr = table?.querySelector('tbody tr');
  const cb = tr?.querySelector('td:first-child input[type="checkbox"]');
  if (cb) { cb.click(); return { ok: true }; }
  return { ok: false };
});
if (tickResult.ok) {
  console.log(`[checkbox] row 0 ticked`);
  await page.waitForTimeout(800);
  try {
    await page.locator('button:has-text("Duplicate")').first().click({ timeout: 5000 });
    opened = true;
    console.log('[Duplicate] top-bar clicked');
  } catch {}
}
if (!opened) {
  try {
    await page.locator('button:has-text("Create New Content"), button:has-text("Create")').first().click({ timeout: 5000 });
    opened = true;
    console.log('[Create] clicked');
  } catch (e) {
    console.log(`[FATAL] no Duplicate AND no Create: ${e.message.split('\n')[0]}`);
  }
}

if (opened) {
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, `${site.id}-dialog-form.png`), fullPage: true }).catch(() => {});

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
      fc: el.getAttribute('formcontrolname'), type: el.type, placeholder: el.placeholder, value: el.value, nearbyLabel: getNearby(el),
    }));
    const visibleSelects = Array.from(dlg.querySelectorAll('select')).filter((el) => el.offsetParent !== null).map((el) => ({
      fc: el.getAttribute('formcontrolname'),
      valueLabel: el.options[el.selectedIndex]?.textContent?.trim() || null,
      optionCount: el.options.length,
      nearbyLabel: getNearby(el),
      options: Array.from(el.options).map((o) => o.textContent.trim()).slice(0, 15),
    }));
    const textareas = Array.from(dlg.querySelectorAll('textarea')).filter((el) => el.offsetParent !== null).map((el) => ({
      fc: el.getAttribute('formcontrolname'), nearbyLabel: getNearby(el),
    }));
    const tabs = Array.from(dlg.querySelectorAll('.mat-tab-label, [role="tab"], .nav-tabs li'))
      .filter((t) => t.offsetParent !== null)
      .map((t) => (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30));
    const fileInputs = Array.from(dlg.querySelectorAll('input[type="file"]')).map((el) => ({
      fc: el.getAttribute('formcontrolname'), accept: el.accept, nearbyLabel: getNearby(el),
    }));
    const hasCkEditor = !!dlg.querySelector('.ck-editor__editable, [contenteditable="true"]');
    return { title, tabs, hasCkEditor, visibleInputs, visibleSelects, textareas, fileInputs };
  });

  await writeFile(path.join(OUT, `${site.id}-dialog-form-probe.json`), JSON.stringify({ allRouterlinks, listInfo, formDump }, null, 2));
  console.log(`\n=== ${site.id} Dialog Create/Edit form ===`);
  console.log(`  title: "${formDump.title}"`);
  console.log(`  tabs: ${(formDump.tabs || []).join(', ')}`);
  console.log(`  hasCkEditor: ${formDump.hasCkEditor}`);
  console.log(`  fileInputs: ${formDump.fileInputs.length}`);
  for (const f of formDump.fileInputs) console.log(`    fc="${f.fc}" accept="${f.accept}" label="${f.nearbyLabel}"`);
  console.log(`  visible inputs:`);
  for (const i of formDump.visibleInputs) {
    console.log(`    fc="${i.fc}" type=${i.type} val="${(i.value || '').slice(0, 40)}" label="${i.nearbyLabel}"`);
  }
  console.log(`  visible selects:`);
  for (const s of formDump.visibleSelects) {
    console.log(`    fc="${s.fc}" label="${s.nearbyLabel}" val="${s.valueLabel}" opts=${s.optionCount}`);
  }
  console.log(`\nSaved: captures/${site.id}-dialog-form-probe.json`);
}

await page.waitForTimeout(2000);
await ctx.close();
await browser.close();
