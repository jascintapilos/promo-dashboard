// Pulls existing Message Templates from a QPRO BO's Section 6.6 and saves
// each one's subject + body HTML per locale tab as a reference file under
// captures/message-templates/<code>.json. The goal: gather enough diverse
// templates so we can author our own per-bonus-type templates with
// placeholders (instead of relying on "Sync Content From" at create time).
//
// Usage:
//   node src/browser/qpro-message-template-pull.js                 # pulls a default sampler from QPRO11
//   node src/browser/qpro-message-template-pull.js --site=qpro13
//   node src/browser/qpro-message-template-pull.js --max=15
//   node src/browser/qpro-message-template-pull.js --filter=FT_,REL_,FC_,FS_,CB_
//   node src/browser/qpro-message-template-pull.js --codes=FT_WEL_SLOTS_120PCT,REL_VIP_50PCT_3X
//
// Flags:
//   --site=<id>       BO site (default qpro11)
//   --max=<N>         max templates to pull (default 8)
//   --filter=<p1,p2>  only pull rows whose code STARTS WITH any of these prefixes
//                     (default: FT_,REL_,FC_,FS_,CB_,NODEP_,WELC_,RET_,VM,TSM)
//   --codes=<c1,c2>   pull these EXACT short codes (overrides --filter)
//
// Output:
//   captures/message-templates/<short-code>.json   — { code, dottedCode, topFields, locales: { MY_EN: {subject, body, bodyText}, ... } }
//   captures/message-templates/_index.json         — summary of all rows seen + which were pulled

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../../bin/_args.js';
import { getSite } from '../sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const site = getSite(flags.site || 'qpro11');
const maxPull = parseInt(flags.max || '8', 10);
const exactCodes = (flags.codes || '').split(',').map((s) => s.trim()).filter(Boolean);
const filterPrefixes = exactCodes.length
  ? []
  : (flags.filter || 'FT_,REL_,FC_,FS_,CB_,NODEP_,WELC_,RET_,VM,TSM').split(',').map((s) => s.trim()).filter(Boolean);

const OUT = path.resolve('captures/message-templates');
await mkdir(OUT, { recursive: true });

console.log(`[pull] site=${site.id} max=${maxPull} ${exactCodes.length ? `codes=${exactCodes.join(',')}` : `filter=${filterPrefixes.join(',')}`}`);

const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 30, args: ['--start-maximized'] });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();

// Login.
await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
const loginResp = page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
await page.locator('button:has-text("Login")').click();
await loginResp;
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
console.log('[login] ok');

// Navigate to 6.6.
await page.goto(`${site.baseUrl}/superuser/message-template`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2500);

// Click Search to populate the table (the list page defaults to "Press
// Search to load data" on QPRO).
try {
  await page.locator('button:has-text("Search")').first().click({ timeout: 5000 });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);
} catch (e) {
  console.log('[search] click skipped:', e.message.split('\n')[0]);
}

// Read the visible rows. Column 2 = "Code" (PROMOTIONS.MESSAGE.<X>).
const rows = await page.evaluate(() => {
  const trs = Array.from(document.querySelectorAll('table tbody tr'));
  return trs.map((tr, idx) => {
    const cells = Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim());
    return { idx, cells };
  });
});
console.log(`[list] ${rows.length} rows visible`);

// Pick which to pull.
function shortCode(dotted) {
  // "PROMOTIONS.MESSAGE.FT_WEL_SLOTS_120PCT" → "FT_WEL_SLOTS_120PCT"
  return (dotted || '').split('.').slice(-1)[0];
}

const candidates = rows
  .map((r) => ({ idx: r.idx, dotted: r.cells[1] || '', short: shortCode(r.cells[1] || ''), locales: r.cells[3] || '' }))
  .filter((r) => r.short);

let picks;
if (exactCodes.length) {
  picks = candidates.filter((c) => exactCodes.includes(c.short));
} else {
  // Greedy diversification: walk the list and pick the first match for each
  // prefix until we hit maxPull, so one FT_*, one REL_*, etc., before we
  // start adding seconds.
  const taken = new Set();
  const seenPrefixes = new Set();
  // First pass: one per prefix.
  for (const c of candidates) {
    if (taken.size >= maxPull) break;
    const pref = filterPrefixes.find((p) => c.short.startsWith(p));
    if (!pref || seenPrefixes.has(pref)) continue;
    seenPrefixes.add(pref);
    taken.add(c.short);
  }
  // Second pass: fill the rest, still respecting the prefix filter.
  for (const c of candidates) {
    if (taken.size >= maxPull) break;
    if (taken.has(c.short)) continue;
    if (filterPrefixes.length && !filterPrefixes.some((p) => c.short.startsWith(p))) continue;
    taken.add(c.short);
  }
  picks = candidates.filter((c) => taken.has(c.short));
}

console.log(`[picks] ${picks.length} templates:`, picks.map((p) => p.short).join(', ') || '(none)');

const pulled = [];
const skipped = [];

for (const pick of picks) {
  try {
    console.log('');
    console.log(`[pull] ${pick.short}  (row ${pick.idx + 1}, locales=${pick.locales})`);

    // Click the row's last cell action — try a few selector patterns
    // since the icon could be <i> / <a> / <button>.
    const row = page.locator('tbody tr').nth(pick.idx);
    let opened = false;
    for (const sel of ['td:last-child i', 'td:last-child a', 'td:last-child button', 'td:last-child [class*="eye"]', 'td:last-child [class*="edit"]']) {
      try {
        const action = row.locator(sel).first();
        await action.waitFor({ timeout: 1500 });
        await action.click({ force: true, timeout: 1500 });
        await page.waitForTimeout(2200);
        opened = true;
        break;
      } catch {}
    }
    if (!opened) {
      console.log('  ⚠ could not open edit dialog — skipping');
      skipped.push({ code: pick.short, reason: 'no action selector matched' });
      continue;
    }

    // Discover the locale tabs in the dialog.
    const tabs = await page.evaluate(() => {
      const dialog = document.querySelector('mat-dialog-container, [role="dialog"], .modal-content');
      if (!dialog) return [];
      return Array.from(dialog.querySelectorAll('.mat-tab-label, .nav-tabs li, [role="tab"]'))
        .filter((t) => t.offsetParent !== null)
        .map((t) => (t.textContent || '').replace(/\s+/g, ' ').trim());
    });
    console.log(`  tabs: ${tabs.join(', ') || '(none detected)'}`);

    // Pull the static top fields (section/type/name/code/status — same across locales).
    const topFields = await page.evaluate(() => {
      const dialog = document.querySelector('mat-dialog-container, [role="dialog"], .modal-content');
      if (!dialog) return [];
      return Array.from(dialog.querySelectorAll('input, select'))
        .filter((el) => (el.offsetWidth || el.offsetHeight))
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          type: el.type || '',
          formcontrolname: el.getAttribute('formcontrolname') || '',
          value: (el.value || '').slice(0, 200),
        }));
    });

    // For each tab, click + capture.
    const locales = {};
    for (const tab of tabs) {
      try {
        // Click the tab by exact text.
        const tabLoc = page.locator('.mat-tab-label, [role="tab"]').filter({ hasText: new RegExp(`^\\s*${tab}\\s*$`) }).first();
        await tabLoc.click({ force: true, timeout: 2000 });
        await page.waitForTimeout(900);
      } catch {
        // If we can't click the tab, capture whatever the dialog currently shows.
      }
      const detail = await page.evaluate(() => {
        const dialog = document.querySelector('mat-dialog-container, [role="dialog"], .modal-content');
        if (!dialog) return { subject: '', body: '', bodyText: '' };
        const subject = dialog.querySelector('input[formcontrolname="subject"]')?.value
          || dialog.querySelector('input[placeholder*="Subject" i]')?.value
          || '';
        const editor = dialog.querySelector('[contenteditable="true"], .ck-editor__editable');
        const body = editor ? editor.innerHTML : '';
        const bodyText = editor ? (editor.textContent || '').replace(/\s+/g, ' ').trim() : '';
        return { subject, body, bodyText };
      });
      locales[tab] = detail;
      console.log(`    ${tab.padEnd(8)} subject="${detail.subject.slice(0, 50)}" body=${detail.body.length} chars`);
    }

    const out = {
      code: pick.short,
      dottedCode: pick.dotted,
      site: site.id,
      pulledAt: new Date().toISOString(),
      topFields,
      locales,
    };
    await writeFile(path.join(OUT, `${pick.short}.json`), JSON.stringify(out, null, 2));
    pulled.push(pick.short);

    // Close the dialog before the next row.
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(800);
    // Fallback close: try the X / Cancel button.
    try {
      const closeBtn = page.locator('mat-dialog-container button:has-text("Cancel"), mat-dialog-container .modal-x-button').first();
      await closeBtn.click({ timeout: 1500 });
    } catch {}
    await page.waitForTimeout(700);
  } catch (e) {
    console.log(`  ⚠ failed: ${e.message.split('\n')[0]}`);
    skipped.push({ code: pick.short, reason: e.message.split('\n')[0] });
    // Try to recover by escaping any open dialog.
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(800);
  }
}

// Write a top-level index for quick scanning.
const indexFile = path.join(OUT, '_index.json');
await writeFile(indexFile, JSON.stringify({
  site: site.id,
  pulledAt: new Date().toISOString(),
  totalRowsSeen: rows.length,
  pulled,
  skipped,
  rowsSummary: candidates.map((c) => ({ code: c.short, locales: c.locales })),
}, null, 2));

console.log('');
console.log(`Done. Pulled ${pulled.length}, skipped ${skipped.length}.`);
console.log(`Saved to: ${OUT}`);
console.log(`Index:    ${indexFile}`);

await ctx.close();
await browser.close();
