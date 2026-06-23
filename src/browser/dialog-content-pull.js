// Pull existing Dialog Popup entries (Title + CTA + per-locale Content
// body) from /settings/dialog, so we can see what real operator content
// looks like by bonus type. Parallel to qpro-message-template-pull.js.
//
// Usage:
//   node src/browser/dialog-content-pull.js --site=ibc22 --max=10
//   node src/browser/dialog-content-pull.js --site=qpro11 --max=8
//
// Output: captures/dialog-content/<site>/<idx>-<code>.json + _summary.json

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../../bin/_args.js';
import { getSite } from '../sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const site = getSite(flags.site || 'ibc22');
const maxPull = parseInt(flags.max || '8', 10);

const OUT = path.resolve('captures', 'dialog-content', site.id);
await mkdir(OUT, { recursive: true });
console.log(`[pull] site=${site.id} max=${maxPull}`);

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
console.log('[login] ok');

await page.goto(`${site.baseUrl}/settings/dialog`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(3000);

// Snapshot row metadata
const rowMeta = await page.evaluate(() => {
  const table = Array.from(document.querySelectorAll('table')).find((t) => t.offsetParent !== null);
  if (!table) return [];
  return Array.from(table.querySelectorAll('tbody tr')).slice(0, 50).map((tr, idx) => {
    const cells = Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim());
    return { idx, cells };
  });
});
console.log(`[list] ${rowMeta.length} rows visible`);
rowMeta.slice(0, 10).forEach((r) => console.log(`  [${r.idx}] ${r.cells.slice(0, 8).join(' | ')}`));

const summary = [];
const picks = rowMeta.slice(0, maxPull);

for (const pick of picks) {
  console.log(`\n[pull] row ${pick.idx} — ${pick.cells.slice(0, 4).join(' | ')}`);
  try {
    // Click GEAR icon (settings) — opens the editable form. The EYE icon
    // opens a read-only preview overlay, which doesn't have form fields.
    const opened = await page.evaluate((idx) => {
      const table = Array.from(document.querySelectorAll('table')).find((t) => t.offsetParent !== null);
      const tr = table?.querySelectorAll('tbody tr')[idx];
      if (!tr) return { ok: false, reason: 'no row' };
      const actions = tr.querySelectorAll('td');
      const actionsCell = actions[actions.length - 1];
      const gear = actionsCell.querySelector('i.fa-cog, [class*="cog"]');
      if (gear) { (gear.closest('button') || gear).click(); return { ok: true, via: 'gear' }; }
      return { ok: false, reason: 'no gear icon' };
    }, pick.idx);

    if (!opened.ok) {
      console.log(`  ⚠ ${opened.reason}`);
      continue;
    }
    await page.waitForTimeout(2500);

    // Dump top fields + locale tabs
    const dlgInfo = await page.evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll('mat-dialog-container, .modal-content, [role="dialog"]')).filter((d) => d.offsetParent !== null);
      const dlg = dialogs.length ? dialogs[dialogs.length - 1] : document.body;
      const title = dlg.querySelector('.modal-header, .modal-title, h4, h5, mat-dialog-title, .kt-portlet__head-label')?.textContent?.replace(/\s+/g, ' ').trim() || '';
      // Top-form scalars
      const code = dlg.querySelector('input[formcontrolname="code"]')?.value || '';
      const position = dlg.querySelector('input[formcontrolname="position"]')?.value || '';
      const session = dlg.querySelector('select[formcontrolname="session"]')?.options?.[dlg.querySelector('select[formcontrolname="session"]')?.selectedIndex]?.textContent?.trim() || '';
      const startDate = dlg.querySelector('input[formcontrolname="start_date"], input[formcontrolname="startDate"]')?.value || '';
      const endDate = dlg.querySelector('input[formcontrolname="end_date"], input[formcontrolname="endDate"]')?.value || '';
      const tabs = Array.from(dlg.querySelectorAll('.mat-tab-label, [role="tab"], .nav-tabs li, .ng-tns-c [class*="tab"]'))
        .filter((t) => t.offsetParent !== null)
        .map((t) => (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20))
        .filter((t) => /^([A-Z]{2}_[A-Z]{2}|MY|SG|US|ID|TH|KH|AU)/i.test(t));
      return { title, code, position, session, startDate, endDate, tabs };
    });
    console.log(`    code="${dlgInfo.code}" pos=${dlgInfo.position} session="${dlgInfo.session}"`);
    console.log(`    tabs: ${dlgInfo.tabs.join(', ')}`);

    // For each tab, capture Title + CTA + Content
    const locales = {};
    for (const tab of dlgInfo.tabs) {
      try {
        await page.locator('.mat-tab-label, [role="tab"]').filter({ hasText: new RegExp(`^\\s*${tab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).first().click({ force: true, timeout: 2000 });
        await page.waitForTimeout(800);
      } catch {}
      const tabData = await page.evaluate(() => {
        const dialogs = Array.from(document.querySelectorAll('mat-dialog-container, .modal-content, [role="dialog"]')).filter((d) => d.offsetParent !== null);
        const dlg = dialogs.length ? dialogs[dialogs.length - 1] : document.body;
        // Find inputs by nearby label
        const findByLabel = (re) => {
          const labels = Array.from(dlg.querySelectorAll('label, span.kt-font-bold, .form-label'));
          for (const l of labels) {
            if (re.test((l.textContent || '').trim())) {
              let p = l;
              for (let i = 0; i < 5 && p.parentElement; i++) {
                p = p.parentElement;
                const inp = p.querySelector('input[type="text"], input:not([type]), textarea');
                if (inp && inp.offsetParent !== null) return inp.value;
              }
            }
          }
          return null;
        };
        const title = dlg.querySelector('input[formcontrolname="title"]')?.value || findByLabel(/^Title\s*:?\s*\*?$/i) || '';
        const ctaTextLeft = dlg.querySelector('input[formcontrolname*="cta"][formcontrolname*="text"][formcontrolname*="left"]')?.value || findByLabel(/CTA.*Text.*Left/i) || '';
        const ctaLinkLeft = dlg.querySelector('input[formcontrolname*="cta"][formcontrolname*="link"][formcontrolname*="left"]')?.value || findByLabel(/CTA.*Link.*Left/i) || '';
        const ctaTextRight = dlg.querySelector('input[formcontrolname*="cta"][formcontrolname*="text"][formcontrolname*="right"]')?.value || findByLabel(/CTA.*Text.*Right/i) || '';
        const ctaLinkRight = dlg.querySelector('input[formcontrolname*="cta"][formcontrolname*="link"][formcontrolname*="right"]')?.value || findByLabel(/CTA.*Link.*Right/i) || '';
        // CKEditor body
        const editor = dlg.querySelector('.ck-editor__editable[contenteditable="true"], [contenteditable="true"]');
        const body = editor ? editor.innerHTML : '';
        const bodyText = editor ? (editor.textContent || '').replace(/\s+/g, ' ').trim() : '';
        return { title, ctaTextLeft, ctaLinkLeft, ctaTextRight, ctaLinkRight, body, bodyText };
      });
      locales[tab] = tabData;
      console.log(`    ${tab.padEnd(8)} Title="${tabData.title.slice(0, 50)}" body=${tabData.body.length}ch CTA L="${tabData.ctaTextLeft}" / R="${tabData.ctaTextRight}"`);
    }

    const fileName = `${String(pick.idx).padStart(3, '0')}-${dlgInfo.code || 'unknown'}.json`;
    await writeFile(path.join(OUT, fileName), JSON.stringify({
      idx: pick.idx,
      rowCells: pick.cells,
      dialogInfo: dlgInfo,
      locales,
    }, null, 2));
    summary.push({ idx: pick.idx, code: dlgInfo.code, file: fileName, tabs: Object.keys(locales) });

    // Close the dialog
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(800);
    // Fallback: click Close button
    try {
      await page.locator('mat-dialog-container button:has-text("Close"), mat-dialog-container button:has-text("Cancel")').first().click({ timeout: 1500 });
    } catch {}
    await page.waitForTimeout(800);
  } catch (e) {
    console.log(`  ⚠ failed: ${e.message.split('\n')[0]}`);
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(800);
  }
}

await writeFile(path.join(OUT, '_summary.json'), JSON.stringify({ site: site.id, pulledAt: new Date().toISOString(), entries: summary }, null, 2));
console.log(`\n✓ Pulled ${summary.length} entries. Saved to: ${OUT}`);

await page.waitForTimeout(2000);
await ctx.close();
await browser.close();
