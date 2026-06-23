// v3: click the SETTINGS/GEAR icon (not eye) to open the editable form.
// First dump the row's action buttons so we know what's clickable.
//
//   node src/browser/dialog-content-probe-v3.js --site=ibc22

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../../bin/_args.js';
import { getSite } from '../sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const site = getSite(flags.site || 'ibc22');
const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 30, args: ['--start-maximized'] });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();

await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
await page.locator('button:has-text("Login")').click();
await page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

await page.goto(`${site.baseUrl}/settings/dialog`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(3000);

// Dump row 0 action buttons in DETAIL to find settings/gear
const buttons = await page.evaluate(() => {
  const table = Array.from(document.querySelectorAll('table')).find((t) => t.offsetParent !== null);
  const tr = table?.querySelector('tbody tr');
  const cells = tr?.querySelectorAll('td');
  const actions = cells?.[cells.length - 1];
  if (!actions) return [];
  return Array.from(actions.querySelectorAll('button, a, i')).filter((el) => el.offsetParent !== null).map((el, idx) => ({
    idx,
    tag: el.tagName.toLowerCase(),
    text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30),
    title: el.getAttribute('title') || el.getAttribute('mattooltip') || el.getAttribute('aria-label') || '',
    cls: (el.className.toString() || '').slice(0, 150),
    iconCls: el.tagName === 'I' ? null : el.querySelector('i')?.className?.toString() || null,
    outerHTML: el.outerHTML.slice(0, 250),
  }));
});
console.log('\n=== Row 0 actions cell — all buttons/icons ===');
for (const b of buttons) console.log(`  [${b.idx}] <${b.tag}> text="${b.text}" title="${b.title}" cls="${b.cls.slice(0, 60)}" iconCls="${b.iconCls?.slice(0, 50)}"`);

// Click the SETTINGS/GEAR/PENCIL icon — try several patterns
const clicked = await page.evaluate(() => {
  const table = Array.from(document.querySelectorAll('table')).find((t) => t.offsetParent !== null);
  const tr = table?.querySelector('tbody tr');
  const actions = tr?.querySelectorAll('td');
  const cell = actions?.[actions.length - 1];
  if (!cell) return { ok: false };
  // Try gear icon first
  const candidates = [
    cell.querySelector('i.fa-cog, i.fas.fa-cog, i[class*="cog"]'),
    cell.querySelector('i.fa-pencil, i.fas.fa-pencil, i[class*="pencil"]'),
    cell.querySelector('i.fa-edit, i.fas.fa-edit, i[class*="edit"]'),
    cell.querySelector('button[mattooltip*="Edit" i]'),
    cell.querySelector('button[mattooltip*="Setting" i]'),
  ].filter(Boolean);
  for (const c of candidates) {
    const btn = c.closest('button') || c;
    btn.click();
    return { ok: true, via: c.className || c.tagName };
  }
  // Fallback: SECOND button in the actions cell (first is usually eye/view)
  const allBtns = Array.from(cell.querySelectorAll('button')).filter((el) => el.offsetParent !== null);
  if (allBtns.length >= 2) { allBtns[1].click(); return { ok: true, via: 'second-button' }; }
  return { ok: false, reason: 'no settings candidate' };
});
console.log(`[click] ${JSON.stringify(clicked)}`);
await page.waitForTimeout(3000);
await page.screenshot({ path: path.join(OUT, 'dialog-after-settings-click.png'), fullPage: true }).catch(() => {});

// Dump ALL form fields + content editor
const fields = await page.evaluate(() => {
  const getNearby = (el) => {
    let p = el;
    for (let i = 0; i < 6 && p.parentElement; i++) {
      p = p.parentElement;
      const labels = Array.from(p.querySelectorAll('label, span.kt-font-bold, .form-label, h6, b'));
      for (const l of labels) {
        const t = (l.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && t.length < 50 && !/^Date|^Location|^Session/.test(t)) return t;
      }
    }
    return null;
  };
  const inputs = Array.from(document.querySelectorAll('input, textarea, select'))
    .filter((el) => el.offsetParent !== null)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.type || '',
      fc: el.getAttribute('formcontrolname'),
      value: (el.value || '').slice(0, 300),
      nearbyLabel: getNearby(el),
    }));
  const editors = Array.from(document.querySelectorAll('.ck-editor__editable[contenteditable="true"], [contenteditable="true"]'))
    .filter((el) => el.offsetParent !== null)
    .map((el) => ({
      html: el.innerHTML.slice(0, 800),
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400),
      nearbyLabel: getNearby(el),
    }));
  const tabs = Array.from(document.querySelectorAll('.mat-tab-label, [role="tab"], .nav-tabs li'))
    .filter((t) => t.offsetParent !== null)
    .map((t) => (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30));
  return { inputs, editors, tabs };
});

await writeFile(path.join(OUT, 'dialog-content-probe-v3-fields.json'), JSON.stringify(fields, null, 2));
console.log(`\ntabs: ${fields.tabs.join(' | ')}`);
console.log(`\n${fields.inputs.length} inputs:`);
for (const i of fields.inputs.filter((i) => i.fc && i.fc !== 'null' && !['datetime_type','defaultDate','code','label','location','status','locale_id','platform','session'].includes(i.fc))) {
  console.log(`  fc="${i.fc}" label="${i.nearbyLabel}" val="${(i.value || '').slice(0, 80)}"`);
}
console.log(`\n${fields.editors.length} editors:`);
for (const e of fields.editors) console.log(`  label="${e.nearbyLabel}" text="${e.text.slice(0, 200)}"`);

await page.waitForTimeout(2000);
await ctx.close();
await browser.close();
