// Probe QPRO BO section 6.6 ("Message Template" per memory) — log in,
// locate the sidebar entry numbered 6.6, navigate, inspect the list of
// existing templates, then open one (or click Create) to dump the form.
//
//   node src/browser/qpro-section-6-6-probe.js --site=qpro11

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../../bin/_args.js';
import { getSite } from '../sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const site = getSite(flags.site || 'qpro11');
const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 30, args: ['--start-maximized'] });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();

await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.locator('input[formcontrolname="merchant_code"]').waitFor({ timeout: 20000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
const loginResp = page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
await page.locator('button:has-text("Login")').click();
await loginResp;
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
console.error('[probe] logged in');
await page.waitForTimeout(2000);

// Dump the sidebar menu. QPRO uses numbered nav items like "3.2", "6.6", etc.
// The left rail shows abbreviated codes; the full title appears on hover/click.
const sidebar = await page.evaluate(() => {
  // Walk every <a>, <li> with text or aria-label containing "6.6"
  const all = Array.from(document.querySelectorAll('a, li, button, [routerlink], [class*="menu"]'));
  const matches = all.filter((el) => {
    const text = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')).replace(/\s+/g, ' ').trim();
    return /\b6\.6\b/.test(text);
  });
  return matches.map((el) => ({
    tag: el.tagName.toLowerCase(),
    text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100),
    cls: el.className.toString().slice(0, 80),
    routerlink: el.getAttribute('routerlink') || '',
    href: el.getAttribute('href') || '',
    visible: !!(el.offsetWidth || el.offsetHeight),
  }));
});

await writeFile(path.join(OUT, `${site.id}-6-6-sidebar.json`), JSON.stringify(sidebar, null, 2));
console.log('=== Sidebar items mentioning "6.6" ===');
sidebar.forEach((s, i) => console.log(`  [${i}] <${s.tag}> "${s.text}" routerlink="${s.routerlink}" href="${s.href}" vis=${s.visible}`));

// Click the most likely one (first visible match)
const target = sidebar.find((s) => s.visible);
if (!target) {
  console.log('No visible 6.6 entry — try expanding "6" parent first');
  // Try clicking an expandable section "6" (or "6.0", "6.")
  const expand = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('a, li, button, [routerlink]'));
    const six = candidates.filter((el) => {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return /^\s*6\b/.test(t) && t.length < 60;
    });
    return six.map((el) => ({ text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) }));
  });
  console.log('Section 6 candidates:', expand);
  // Try clicking the first one
  if (expand[0]) {
    await page.locator('a, li, button').filter({ hasText: expand[0].text }).first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, `${site.id}-6-after-expand.png`), fullPage: true });
  }
}

// Navigate directly — `/superuser/message-template` from the sidebar href.
await page.goto(`${site.baseUrl}/superuser/message-template`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2500);
console.log(`Navigated. URL: ${page.url()}`);

await page.screenshot({ path: path.join(OUT, `${site.id}-6-6-list.png`), fullPage: true });

// Inspect the page: should be a list/table of message templates
const pageInfo = await page.evaluate(() => {
  // Title / heading
  const heading = document.querySelector('.kt-portlet__head-label, h1, h2, h3')?.textContent?.trim()?.slice(0, 100) || '';
  // Top-right toolbar buttons (likely "Create", "New", etc.)
  const buttons = Array.from(document.querySelectorAll('button, a[role="button"]')).filter((b) => {
    const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
    return t.length > 0 && t.length < 50;
  }).map((b) => ({
    text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50),
    cls: b.className.slice(0, 60),
    visible: !!(b.offsetWidth || b.offsetHeight),
  })).filter((b) => b.visible).slice(0, 25);
  // Tables of existing templates
  const tables = Array.from(document.querySelectorAll('table')).filter((t) => t.offsetParent !== null).slice(0, 2).map((t) => ({
    headers: Array.from(t.querySelectorAll('thead th, tr:first-child th')).map((h) => h.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)).slice(0, 20),
    rowCount: t.querySelectorAll('tbody tr').length,
    firstRow: Array.from(t.querySelectorAll('tbody tr:first-child td')).map((td) => td.textContent.replace(/\s+/g, ' ').trim().slice(0, 50)).slice(0, 20),
  }));
  return { heading, url: location.href, buttons, tables };
});
await writeFile(path.join(OUT, `${site.id}-6-6-page.json`), JSON.stringify(pageInfo, null, 2));

console.log(`\n=== 6.6 page ===`);
console.log(`  heading: ${pageInfo.heading}`);
console.log(`  url: ${pageInfo.url}`);
console.log('  buttons:');
pageInfo.buttons.forEach((b) => console.log(`    "${b.text}" cls="${b.cls.slice(0, 50)}"`));
console.log('  tables:');
pageInfo.tables.forEach((t, i) => {
  console.log(`    [${i}] rows=${t.rowCount} headers=${JSON.stringify(t.headers)}`);
  console.log(`        firstRow=${JSON.stringify(t.firstRow)}`);
});

// Click "Create" to inspect the Create-Template form (most useful for our
// future automation — we want to know what fields go into a new template).
try {
  const createBtn = page.locator('button:has-text("Create")').last();
  await createBtn.waitFor({ timeout: 3000 });
  await createBtn.click({ force: true });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, `${site.id}-6-6-create-form.png`), fullPage: true });
  // Dump the detail form
  const detail = await page.evaluate(() => {
    // Look for the active dialog or new view
    const dialog = Array.from(document.querySelectorAll('[role="dialog"], .modal-content, mat-dialog-container, .kt-portlet'))
      .filter((d) => d.offsetParent !== null).pop();
    if (!dialog) return { error: 'no detail view' };
    const fields = [];
    dialog.querySelectorAll('input, select, textarea').forEach((el) => {
      if (!(el.offsetWidth || el.offsetHeight)) return;
      fields.push({
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        formcontrolname: el.getAttribute('formcontrolname') || '',
        placeholder: el.placeholder || '',
        value: (el.value || '').slice(0, 120),
        options: el.tagName === 'SELECT' ? Array.from(el.options).map((o) => o.textContent.trim()).slice(0, 12) : undefined,
      });
    });
    const labels = Array.from(dialog.querySelectorAll('label, .kt-form__label, span.kt-font-bold')).map((l) => l.textContent.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 60).slice(0, 25);
    return { fields, labels, headings: Array.from(dialog.querySelectorAll('h1, h2, h3, h4, h5, .kt-portlet__head-label, .modal-title')).map((h) => h.textContent.trim().slice(0, 80)) };
  });
  await writeFile(path.join(OUT, `${site.id}-6-6-template-detail.json`), JSON.stringify(detail, null, 2));
  console.log(`\n=== 6.6 template detail (first row) ===`);
  console.log(`  headings: ${JSON.stringify(detail.headings)}`);
  console.log(`  labels: ${JSON.stringify(detail.labels)}`);
  console.log(`  fields:`);
  detail.fields?.forEach((f) => console.log(`    ${f.tag}[${f.type}] fcn="${f.formcontrolname}" placeholder="${f.placeholder}" value="${f.value}" options=${f.options?.length ?? '-'}`));
} catch (e) {
  console.log(`Couldn't open first template row: ${e.message.split('\n')[0]}`);
}

await ctx.close();
await browser.close();
