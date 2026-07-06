#!/usr/bin/env node
// Probe the exact network request the QP2A BO sends when a user deactivates a promo.
// Approach: log in, navigate to the promo edit, capture ALL /api/bo/promotion/* requests,
// then manually change status → Inactive → Save, and dump the intercepted request.
//
// This is exploratory. Once we know the exact URL, method, headers, and body shape,
// we can replicate via API without guessing.

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSite } from '../src/sites.js';

const site = getSite('ibc22');
const OUT = path.resolve('captures/probe-deactivate');
await mkdir(OUT, { recursive: true });

// Use a code we know is on QP2A. Pick FT_88FS_5X_040_GOO (id=1287, currently Active).
const TARGET_CODE = 'FT_88FS_5X_040_GOO';

const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 60, args: ['--start-maximized'] });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();

// ── Log EVERY /api/bo/promotion/* request ─────────────────────────
const captured = [];
page.on('request', (req) => {
  const u = req.url();
  if (u.includes('/api/bo/promotion') || u.includes('/api/bo/promotion/')) {
    const body = req.postData();
    captured.push({
      method: req.method(),
      url: u,
      headers: req.headers(),
      bodyLen: body ? body.length : 0,
      body: body ? body.slice(0, 3000) : null,
    });
    console.log(`[net] ${req.method()} ${u.split('?')[0]} (body ${body?.length || 0} bytes)`);
  }
});
page.on('response', async (res) => {
  const u = res.url();
  if (u.includes('/api/bo/promotion') && (res.request().method() === 'PUT' || res.request().method() === 'POST' || res.request().method() === 'DELETE')) {
    try {
      const text = await res.text();
      console.log(`[resp] ${res.request().method()} ${u.split('?')[0]} status=${res.status()} body: ${text.slice(0, 300)}`);
    } catch {}
  }
});

// ── Login ────────────────────────────────────────────────────────
await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
await page.locator('button:has-text("Login")').click();
await page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
console.log('\n[flow] logged in\n');

// ── Navigate to promo list ────────────────────────────────────────
await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2500);

// Set status filter to "All" or "Active" — check what UI has by default
// Clear status filter (might be defaulting to Active which excludes some)
const statusFilter = page.locator('select[formcontrolname="status"], kt-dropdown').filter({ hasText: /status/i }).first();
// Just try to search now
await page.locator('input[formcontrolname="name"]').first().fill(TARGET_CODE);
console.log(`\n[flow] searching for ${TARGET_CODE}...`);
await page.locator('button:has-text("Search")').first().click();
await page.waitForTimeout(3000);
await page.screenshot({ path: path.join(OUT, '1_search_result.png'), fullPage: false });

// Try to find the row — if not visible, try clearing status filter
let row = page.locator(`tr:has-text("${TARGET_CODE}")`).first();
if (!(await row.isVisible({ timeout: 3000 }).catch(() => false))) {
  console.log('[flow] row not visible with default filters. Clearing filters...');
  // Try clicking Clear button
  await page.locator('button:has-text("Clear")').first().click().catch(() => {});
  await page.waitForTimeout(1500);
  // Re-fill search
  await page.locator('input[formcontrolname="name"]').first().fill(TARGET_CODE);
  // Try setting status to All (or empty)
  await page.locator('select[formcontrolname="status"]').selectOption({ label: 'All' }).catch(() => {});
  await page.waitForTimeout(500);
  await page.locator('button:has-text("Search")').first().click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(OUT, '2_search_result_after_clear.png'), fullPage: false });
  row = page.locator(`tr:has-text("${TARGET_CODE}")`).first();
}

if (!(await row.isVisible({ timeout: 5000 }).catch(() => false))) {
  console.log('[flow] STILL not visible. Bailing — check screenshots.');
  await writeFile(path.join(OUT, 'captured.json'), JSON.stringify(captured, null, 2));
  await browser.close();
  process.exit(1);
}

// ── Open edit ─────────────────────────────────────────────────────
const rowAction = row.locator('a, button').first();
await rowAction.click();
await page.waitForTimeout(3000);
await page.screenshot({ path: path.join(OUT, '3_edit_modal.png'), fullPage: true });
console.log('[flow] opened edit modal');

// ── Try to find and toggle status — probe the DOM ─────────────────
// Common: Status dropdown next to the top of the form, or a row-level toggle.
// The main promo Status is separate from currency Status.
// Look for a Status field in the Edit modal.
console.log('\n[flow] looking for Status control in edit modal...');
const dumpStatus = await page.evaluate(() => {
  const visible = (el) => el.offsetParent !== null;
  const modals = Array.from(document.querySelectorAll('.modal-content, kt-modal, [class*="modal"]')).filter(visible);
  const results = [];
  for (const m of modals.slice(0, 3)) {
    const selects = Array.from(m.querySelectorAll('select, kt-dropdown, .switch, .kt-switch, input[type="checkbox"]')).filter(visible);
    for (const sel of selects) {
      results.push({
        tag: sel.tagName,
        name: sel.getAttribute('formcontrolname') || sel.name || '',
        placeholder: sel.getAttribute('placeholder') || '',
        text: (sel.parentElement?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        value: sel.value || (sel.checked ? 'checked' : 'unchecked'),
      });
    }
  }
  return results;
});
console.log('[flow] controls found in edit modal:');
for (const r of dumpStatus.slice(0, 15)) console.log(`  ${r.tag}[${r.name}] "${r.text.slice(0,50)}" = "${r.value}"`);

// Save the captured network requests dump so we can inspect
await writeFile(path.join(OUT, 'captured-requests.json'), JSON.stringify(captured, null, 2));
console.log(`\n[flow] Captured ${captured.length} promotion-related requests so far`);
console.log(`\n>>> BROWSER IS OPEN. Please manually deactivate this promo via the UI now. <<<`);
console.log(`    (change status to Inactive, click Save/Submit)`);
console.log(`    I will keep the browser open for 90 seconds and capture the PUT request.`);
console.log();

await page.waitForTimeout(90000);

await writeFile(path.join(OUT, 'captured-requests-final.json'), JSON.stringify(captured, null, 2));
console.log(`\n[flow] Done. Captured total ${captured.length} requests.`);
console.log(`See ${OUT}/captured-requests-final.json`);

// Print any PUT/POST requests
const writes = captured.filter(c => ['PUT', 'POST', 'DELETE'].includes(c.method));
console.log(`\nWrite requests: ${writes.length}`);
for (const w of writes) {
  console.log(`\n${w.method} ${w.url}`);
  if (w.body) console.log(`  body[${w.bodyLen}]: ${w.body.slice(0, 500)}`);
}

await browser.close();
