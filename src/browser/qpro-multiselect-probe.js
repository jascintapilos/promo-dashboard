// Cycle-1 probe: capture each kt-dropdown-wo-lazyload multi-select on the
// QPRO Create form in its OPEN state, so we can build a generic
// multiselect action handler with confidence.
//
//   node src/browser/qpro-multiselect-probe.js --site=qpro11
//
// For each open dropdown, captures:
//   • the trigger element's selector + text
//   • the options list container selector
//   • the option item selector pattern (label / checkbox)
//   • the "Select All" / "Unselect All" buttons if present
//   • a search input if present (some chips have an inline filter)

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../../bin/_args.js';
import { getSite } from '../sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const headless = !(flags.headless === 'false' || process.env.HEADLESS === 'false');
const site = getSite(flags.site || 'qpro11');

const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

// Login.
await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded' });
await page.locator('input[formcontrolname="merchant_code"]').waitFor({ timeout: 20000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
const loginResp = page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200);
await page.locator('button:has-text("Login")').click();
await loginResp;
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

// Open Create form.
await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);
await page.locator('button:has-text("Create")').first().click();
await page.waitForTimeout(2500);
console.error('[probe] Create form open');

// Inspect each kt-dropdown-wo-lazyload. We'll click each one in turn,
// snapshot the DOM around the open dropdown panel, then close it.
const dropdowns = await page.$$('kt-dropdown-wo-lazyload');
console.error(`[probe] found ${dropdowns.length} kt-dropdown elements`);

const results = [];
for (let i = 0; i < dropdowns.length; i++) {
  const handle = dropdowns[i];
  // Get a stable description before clicking (the closest field label).
  const meta = await handle.evaluate((el) => {
    const visible = !!(el.offsetWidth || el.offsetHeight);
    if (!visible) return { visible: false };
    // Walk up looking for a sibling/parent label.
    let label = '';
    let parent = el.parentElement;
    for (let k = 0; k < 6 && parent; k++) {
      const lbl = parent.querySelector(':scope > label, :scope label.col-form-label, :scope > .form-label, :scope > .col-form-label');
      if (lbl) { label = lbl.textContent.trim().slice(0, 60); break; }
      parent = parent.parentElement;
    }
    return {
      visible: true,
      label,
      currentText: (el.textContent || '').trim().slice(0, 80),
      htmlSnippet: el.outerHTML.slice(0, 400),
    };
  });
  if (!meta.visible) continue;

  // Click the trigger to open the option list.
  try {
    // The trigger button inside the dropdown — usually .c-btn or similar.
    const trigger = await handle.$('.c-btn, .selected-list, button, .dropdown-toggle');
    if (!trigger) {
      results.push({ idx: i, label: meta.label, error: 'no trigger found inside dropdown' });
      continue;
    }
    await trigger.click();
    await page.waitForTimeout(700);
  } catch (e) {
    results.push({ idx: i, label: meta.label, error: 'trigger click failed: ' + e.message.split('\n')[0] });
    continue;
  }

  // Capture the now-open panel.
  const open = await page.evaluate((rootHandleIdx) => {
    // Find the open panel — usually a sibling of the trigger with class
    // .dropdown-list or .c-list or aria-expanded=true.
    const panels = Array.from(document.querySelectorAll('.dropdown-list, .dropdown-list.lazyloadcontainer, ul.lazyloadclass, .multiselect-list, .c-list, .open .lazyContainer'));
    const visible = panels.filter((p) => p.offsetWidth || p.offsetHeight);
    const panel = visible[visible.length - 1] || null; // most recently opened
    if (!panel) return { panelFound: false };
    const items = Array.from(panel.querySelectorAll('li, label')).filter((e) => e.offsetWidth || e.offsetHeight);
    return {
      panelFound: true,
      panelTag: panel.tagName.toLowerCase(),
      panelClass: panel.className,
      itemCount: items.length,
      // Sample first 12 items
      items: items.slice(0, 12).map((e) => ({
        tag: e.tagName.toLowerCase(),
        cls: e.className,
        text: (e.textContent || '').trim().slice(0, 80),
        innerHTMLSnippet: e.innerHTML.slice(0, 200),
      })),
      // Look for select-all / unselect-all controls
      controls: Array.from(panel.querySelectorAll('button, a, .pure-checkbox'))
        .filter((e) => /select\s*all|unselect|all/i.test(e.textContent || ''))
        .slice(0, 4)
        .map((e) => ({ tag: e.tagName.toLowerCase(), text: (e.textContent || '').trim().slice(0, 40) })),
      // Look for search input
      hasSearch: !!panel.querySelector('input[type="text"]'),
    };
  });

  results.push({
    idx: i,
    label: meta.label,
    currentText: meta.currentText,
    panel: open,
  });

  // Close — click outside on a safe spot.
  await page.locator('body').click({ position: { x: 10, y: 10 } }).catch(() => {});
  await page.waitForTimeout(400);
}

await writeFile(path.join(OUT, `${site.id}-multiselect-probe.json`), JSON.stringify(results, null, 2));
await page.screenshot({ path: path.join(OUT, `${site.id}-multiselect-final.png`), fullPage: true }).catch(() => {});

console.log('\n=== MULTI-SELECT SUMMARY ===');
for (const r of results) {
  console.log(`\n[${r.idx}] label="${r.label}"  currentText="${r.currentText?.slice(0, 50)}"`);
  if (r.error) { console.log(`   ERROR: ${r.error}`); continue; }
  console.log(`   panel: ${r.panel.panelFound ? r.panel.panelTag + '.' + r.panel.panelClass.split(' ').slice(0, 2).join('.') : 'NOT FOUND'}`);
  if (r.panel.panelFound) {
    console.log(`   itemCount: ${r.panel.itemCount}, hasSearch: ${r.panel.hasSearch}, controls: ${r.panel.controls.map((c) => c.text).join(' / ')}`);
    if (r.panel.items.length) console.log(`   sample items: ${r.panel.items.slice(0, 5).map((it) => it.text).join(' | ')}`);
  }
}

await ctx.close();
await browser.close();
