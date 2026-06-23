// Probe: open a few EXISTING (non-test) promo codes on QP2A and dump their
// Member Group panel state — what items are ticked, what the trigger
// displays, and the panel's checkbox tree structure. The canary's Select
// All click doesn't seem to actually tick items (V12+ form-state dumps
// show Member Group trigger="Please Select"). Understand how real codes
// have it configured.
//
// Run: node src/browser/qp2-existing-member-group-probe.js

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSite } from '../sites.js';

const site = getSite('ibc22');
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

await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2000);

// Search with EMPTY name → list all codes (or default to recent codes)
// Then we'll pick the first few non-TEST_ rows
const tableResp = page.waitForResponse((r) => r.url().includes('/api/bo/promotion?') && r.status() === 200, { timeout: 15000 }).catch(() => null);
await page.locator('button:has-text("Search")').first().click();
await tableResp;
await page.waitForTimeout(2500);

// Get all the code names from the list (NOT TEST_ prefixed)
const allRows = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('tbody tr')).filter((r) => r.offsetParent !== null);
  return rows.map((r) => {
    const cells = Array.from(r.querySelectorAll('td')).map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim());
    return cells;
  }).slice(0, 30);
});
console.log(`[list] found ${allRows.length} rows`);

// Find the first 3 non-TEST_ promo codes
const targetCodes = [];
for (const cells of allRows) {
  const codeCell = cells.find((c) => /^[A-Z][A-Z0-9_]{3,}/.test(c) && !/^TEST_/.test(c));
  if (codeCell && !targetCodes.includes(codeCell)) {
    targetCodes.push(codeCell);
    if (targetCodes.length >= 3) break;
  }
}
console.log(`[picked] target codes: ${targetCodes.join(', ')}`);

const allDumps = [];

for (const code of targetCodes) {
  console.log(`\n--- Probing: ${code} ---`);
  // Search for this specific code
  await page.locator('input[formcontrolname="name"]').first().fill(code);
  const resp = page.waitForResponse((r) => r.url().includes('/api/bo/promotion?') && r.status() === 200, { timeout: 15000 }).catch(() => null);
  await page.locator('button:has-text("Search")').first().click();
  await resp;
  await page.waitForTimeout(1500);

  // Open the row's Edit modal
  try {
    const row = page.locator(`tr:has-text("${code}")`).first();
    await row.waitFor({ timeout: 5000 });
    const rowAction = row.locator('a, button').first();
    await rowAction.click();
    await page.waitForTimeout(2500);
    console.log(`[${code}] Edit modal opened`);
  } catch (e) {
    console.log(`[${code}] Couldn't open: ${e.message.split('\n')[0]}`);
    continue;
  }

  // Dump Member Group state — both the trigger and the open panel
  const memberGroupDump = await page.evaluate(() => {
    const visible = (el) => el.offsetParent !== null;
    // Find the Member Group kt-dropdown trigger
    const spans = Array.from(document.querySelectorAll('span.kt-font-bold')).filter(visible).filter((s) => /^\s*Member Group\s*$/i.test((s.textContent || '').trim()));
    if (spans.length === 0) return { error: 'no Member Group span found' };
    const span = spans[spans.length - 1];  // last is the Edit modal's (rendered after list)
    // Walk up to find the kt-dropdown trigger
    let triggerEl = null;
    let p = span;
    for (let i = 0; i < 8 && p.parentElement; i++) {
      p = p.parentElement;
      const t = p.querySelector('kt-dropdown-wo-lazyload .c-btn, kt-dropdown .c-btn');
      if (t) { triggerEl = t; break; }
    }
    if (!triggerEl) return { error: 'no trigger near Member Group span' };
    return {
      triggerText: (triggerEl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      triggerOuterHTML: triggerEl.outerHTML.slice(0, 500),
    };
  });
  console.log(`[${code}] Member Group:`);
  console.log(`  trigger text: "${memberGroupDump.triggerText || memberGroupDump.error}"`);

  // Now CLICK the trigger to open the panel and dump items
  try {
    const clickResult = await page.evaluate(() => {
      const visible = (el) => el.offsetParent !== null;
      const spans = Array.from(document.querySelectorAll('span.kt-font-bold')).filter(visible).filter((s) => /^\s*Member Group\s*$/i.test((s.textContent || '').trim()));
      if (spans.length === 0) return { ok: false };
      const span = spans[spans.length - 1];
      let p = span;
      for (let i = 0; i < 8 && p.parentElement; i++) {
        p = p.parentElement;
        const t = p.querySelector('kt-dropdown-wo-lazyload .c-btn, kt-dropdown .c-btn');
        if (t) { t.scrollIntoView({ block: 'center' }); t.click(); return { ok: true }; }
      }
      return { ok: false };
    });
    if (clickResult.ok) {
      await page.waitForTimeout(1000);
      const panelDump = await page.evaluate(() => {
        const visible = (el) => el.offsetParent !== null;
        const panels = Array.from(document.querySelectorAll('.dropdown-list')).filter(visible);
        const panel = panels[panels.length - 1];
        if (!panel) return { error: 'no visible panel' };
        const items = Array.from(panel.querySelectorAll('li')).slice(0, 40).map((li) => ({
          text: (li.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
          cls: (li.className || '').slice(0, 80),
          checked: (() => {
            const cb = li.querySelector('input[type="checkbox"]');
            return cb ? cb.checked : null;
          })(),
        }));
        // Also get the Select All state
        const labels = Array.from(panel.querySelectorAll('label'));
        const selectAll = labels.find((l) => /select all/i.test(l.textContent || ''));
        return {
          itemCount: items.length,
          selectAllText: selectAll ? (selectAll.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) : null,
          selectAllChecked: selectAll ? selectAll.querySelector('input[type="checkbox"]')?.checked : null,
          items,
        };
      });
      console.log(`  panel items (${panelDump.itemCount || 0}):`);
      console.log(`  Select All: text="${panelDump.selectAllText}" checked=${panelDump.selectAllChecked}`);
      for (const i of (panelDump.items || []).slice(0, 25)) {
        console.log(`    ${i.checked ? '☑' : i.checked === false ? '☐' : '?'} "${i.text}" cls="${i.cls.slice(0, 50)}"`);
      }
      allDumps.push({ code, triggerText: memberGroupDump.triggerText, panel: panelDump });
      // Close panel — click trigger again
      await page.evaluate(() => {
        const visible = (el) => el.offsetParent !== null;
        const spans = Array.from(document.querySelectorAll('span.kt-font-bold')).filter(visible).filter((s) => /^\s*Member Group\s*$/i.test((s.textContent || '').trim()));
        const span = spans[spans.length - 1];
        let p = span;
        for (let i = 0; i < 8 && p.parentElement; i++) {
          p = p.parentElement;
          const t = p.querySelector('kt-dropdown-wo-lazyload .c-btn, kt-dropdown .c-btn');
          if (t) { t.click(); return; }
        }
      });
      await page.waitForTimeout(500);
    }
  } catch (e) {
    console.log(`  ⚠ panel dump failed: ${e.message.split('\n')[0]}`);
  }

  // Close the Edit modal (try Close button)
  try {
    await page.locator('mat-dialog-container button:has-text("Close"), .modal-content button:has-text("Close")').last().click({ timeout: 3000 });
    await page.waitForTimeout(1500);
  } catch {
    // dismiss via escape — risky but recoverable
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  }
}

await writeFile(path.join(OUT, 'qp2-existing-member-group-probe.json'), JSON.stringify(allDumps, null, 2));
console.log(`\n=== Wrote captures/qp2-existing-member-group-probe.json (${allDumps.length} dumps) ===`);

await page.waitForTimeout(2000);
await ctx.close();
await browser.close();
