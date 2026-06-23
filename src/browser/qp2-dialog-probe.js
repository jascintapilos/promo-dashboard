// Probe: QP2 CMS Module 15 > Announcements > Dialog
// Goal: find the Dialog template create page, dump form structure, and
// understand per-bonus-type setup so the canary can auto-create + link
// a dialog (parallel to the Message Template flow).
//
// Output: captures/qp2-dialog-probe.json + screenshots
//   node src/browser/qp2-dialog-probe.js

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

// ── Step 1: dump sidebar items mentioning "Announce" or "Dialog" ────
const sidebarHits = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('a, li, button, [routerlink]'));
  const matches = all.filter((el) => {
    const t = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')).replace(/\s+/g, ' ').trim();
    return /announce|dialog|\b15\.|\b14\./i.test(t);
  });
  return matches.slice(0, 30).map((el) => ({
    tag: el.tagName.toLowerCase(),
    text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    routerlink: el.getAttribute('routerlink') || '',
    href: el.getAttribute('href') || '',
    visible: !!(el.offsetWidth || el.offsetHeight),
  }));
});
console.log('=== Sidebar items mentioning Announce / Dialog / 14 / 15 ===');
sidebarHits.forEach((s, i) => console.log(`  [${i}] <${s.tag}> "${s.text}" routerlink="${s.routerlink}" href="${s.href}" vis=${s.visible}`));

// ── Step 2: try common URLs for Dialog management ──────────────────
const urlGuesses = [
  '/superuser/dialog',
  '/cms/dialog',
  '/cms/announcement/dialog',
  '/cms/announcement',
  '/superuser/announcement',
  '/superuser/announcement-dialog',
];
let landedUrl = null;
for (const guess of urlGuesses) {
  try {
    await page.goto(`${site.baseUrl}${guess}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1500);
    const u = page.url();
    const heading = await page.locator('.kt-portlet__head-label, h1, h2, h3').first().textContent({ timeout: 1500 }).catch(() => '');
    console.log(`  tried ${guess} → ${u} (heading: "${(heading || '').trim().slice(0, 60)}")`);
    // If the URL contains "dialog" and the heading isn't an error, this is likely it
    if (/dialog/i.test(u) && !/error|not found|404/i.test(heading || '')) {
      landedUrl = u;
      break;
    }
  } catch (e) {
    console.log(`  tried ${guess} → ${e.message.split('\n')[0]}`);
  }
}
console.log(`[landed] ${landedUrl || '(none — sidebar click required)'}`);

// ── Step 3: try sidebar nav (click anything mentioning Dialog) ─────
if (!landedUrl) {
  for (const hit of sidebarHits.filter((h) => h.visible && /dialog/i.test(h.text))) {
    try {
      console.log(`  clicking sidebar item "${hit.text}"`);
      await page.locator('a, li, button').filter({ hasText: hit.text }).first().click({ timeout: 3000 });
      await page.waitForTimeout(2000);
      const u = page.url();
      console.log(`    → ${u}`);
      if (/dialog/i.test(u)) { landedUrl = u; break; }
    } catch {}
  }
}

if (!landedUrl) {
  console.log('[FATAL] could not locate Dialog page — taking screenshot for manual diagnosis');
  await page.screenshot({ path: path.join(OUT, 'qp2-dialog-probe-failed.png'), fullPage: true }).catch(() => {});
} else {
  console.log(`[ok] Dialog page at: ${landedUrl}`);
  await page.screenshot({ path: path.join(OUT, 'qp2-dialog-probe-list.png'), fullPage: true }).catch(() => {});

  // ── Step 4: dump the list page (headers, button labels) ─────────
  const listInfo = await page.evaluate(() => {
    const heading = document.querySelector('.kt-portlet__head-label, h1, h2, h3')?.textContent?.trim() || '';
    const buttons = Array.from(document.querySelectorAll('button, a[role="button"]'))
      .filter((b) => b.offsetParent !== null)
      .map((b) => ({ text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50), cls: b.className.slice(0, 60) }))
      .filter((b) => b.text && b.text.length < 50);
    const tables = Array.from(document.querySelectorAll('table')).filter((t) => t.offsetParent !== null).slice(0, 2).map((t) => ({
      headers: Array.from(t.querySelectorAll('thead th, tr:first-child th')).map((h) => h.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)),
      rowCount: t.querySelectorAll('tbody tr').length,
      firstRow: Array.from(t.querySelectorAll('tbody tr:first-child td')).map((td) => td.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)),
    }));
    return { heading, url: location.href, buttons, tables };
  });
  console.log('\n=== Dialog list page ===');
  console.log(`  heading: ${listInfo.heading}`);
  console.log(`  url: ${listInfo.url}`);
  console.log('  buttons:'); listInfo.buttons.forEach((b) => console.log(`    "${b.text}" cls="${b.cls}"`));
  console.log('  tables:');
  listInfo.tables.forEach((t, i) => {
    console.log(`    [${i}] rows=${t.rowCount} headers=${JSON.stringify(t.headers)}`);
    console.log(`        firstRow=${JSON.stringify(t.firstRow)}`);
  });

  // ── Step 5: click Create + dump the create form ─────────────────
  try {
    await page.locator('button:has-text("Create")').first().click({ timeout: 5000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, 'qp2-dialog-probe-create-form.png'), fullPage: true }).catch(() => {});

    const createForm = await page.evaluate(() => {
      const dlg = Array.from(document.querySelectorAll('mat-dialog-container, .modal-content, [role="dialog"]')).filter((d) => d.offsetParent !== null).pop()
                || document.body;
      const title = dlg.querySelector('.modal-header, .modal-title, h4, h5, mat-dialog-title')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) || '';
      const inputs = Array.from(dlg.querySelectorAll('input')).filter((el) => el.offsetParent !== null).map((el) => ({
        fc: el.getAttribute('formcontrolname'),
        type: el.type,
        placeholder: el.placeholder,
        value: el.value,
        required: el.required || el.hasAttribute('required'),
        labelHasAsterisk: (() => {
          let p = el;
          for (let i = 0; i < 5 && p.parentElement; i++) {
            p = p.parentElement;
            const l = p.querySelector('label, span.kt-font-bold, .form-label');
            if (l && l !== el) {
              const t = (l.textContent || '').replace(/\s+/g, ' ').trim();
              if (t && t.length < 50) return /\*/.test(t);
            }
          }
          return false;
        })(),
        nearbyLabel: (() => {
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
        })(),
      }));
      const selects = Array.from(dlg.querySelectorAll('select')).filter((el) => el.offsetParent !== null).map((el) => ({
        fc: el.getAttribute('formcontrolname'),
        valueLabel: el.options[el.selectedIndex]?.textContent?.trim() || null,
        options: Array.from(el.options).map((o) => ({ value: o.value, label: o.textContent.trim() })).slice(0, 30),
        nearbyLabel: (() => {
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
        })(),
      }));
      const tabs = Array.from(dlg.querySelectorAll('.mat-tab-label, [role="tab"], .nav-tabs li'))
        .filter((t) => t.offsetParent !== null)
        .map((t) => (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30));
      const hasEditor = !!dlg.querySelector('.ck-editor__editable, [contenteditable="true"]');
      return { title, inputs, selects, tabs, hasEditor };
    });
    console.log('\n=== Dialog CREATE form ===');
    console.log(`  title: "${createForm.title}"`);
    console.log(`  tabs: ${createForm.tabs.join(', ')}`);
    console.log(`  hasEditor: ${createForm.hasEditor}`);
    console.log('  inputs:');
    for (const i of createForm.inputs) {
      console.log(`    fc="${i.fc}" type=${i.type} ${i.labelHasAsterisk ? '*' : ' '} val="${i.value}" placeholder="${i.placeholder}" label="${i.nearbyLabel}"`);
    }
    console.log('  selects:');
    for (const s of createForm.selects) {
      console.log(`    fc="${s.fc}" label="${s.nearbyLabel}" val="${s.valueLabel}" options=${JSON.stringify(s.options.slice(0, 8))}`);
    }
    await writeFile(path.join(OUT, 'qp2-dialog-probe.json'), JSON.stringify({ listInfo, createForm, landedUrl }, null, 2));
  } catch (e) {
    console.log(`[create] failed: ${e.message.split('\n')[0]}`);
  }
}

await page.waitForTimeout(2000);
await ctx.close();
await browser.close();
