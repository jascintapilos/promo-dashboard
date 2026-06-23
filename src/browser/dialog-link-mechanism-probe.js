// Probe: figure out the actual mechanism for linking a dialog popup to a
// promo. Strategy: open an existing promo's Edit modal that has NO dialog
// linked yet (e.g. one of our V5-V19 TEST promos, which all submitted with
// dialog_popup_list: []), manually pick a dialog from the kt-dropdown,
// click Submit, and dump every API call made. The DELTA between
// dropdown-click and modal-Submit tells us what request actually persists
// the link.
//
//   node src/browser/dialog-link-mechanism-probe.js qpro11 TEST_VIP_30FC_5X_MB19
//
// Outputs:
//   captures/dialog-link-mechanism-probe-<site>-<promo>.json — every API call

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSite } from '../sites.js';

const siteId = process.argv[2] || 'qpro11';
const promoCode = process.argv[3] || 'TEST_VIP_30FC_5X_MB19';
const site = getSite(siteId);
const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 40, args: ['--start-maximized'] });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();

// Capture EVERY /api/bo/* request + response
const calls = [];
page.on('request', (req) => {
  const url = req.url();
  if (!/\/api\/bo\//i.test(url)) return;
  calls.push({
    phase: phase,
    ts: Date.now(),
    method: req.method(),
    url,
    requestBody: req.postData() || null,
    status: null,
    responseBody: null,
  });
});
page.on('response', async (resp) => {
  const url = resp.url();
  if (!/\/api\/bo\//i.test(url)) return;
  const last = [...calls].reverse().find((c) => c.url === url && c.status === null);
  if (!last) return;
  last.status = resp.status();
  try { last.responseBody = (await resp.text()).slice(0, 12000); } catch {}
});

let phase = 'login';
await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
await page.locator('button:has-text("Login")').click();
await page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
console.log(`[login ok] ${siteId}`);

phase = 'nav-list';
await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2500);

phase = 'search-promo';
const searchInput = page.locator('input[formcontrolname="promotion"], input[formcontrolname="name"]').first();
await searchInput.waitFor({ timeout: 10000 });
await searchInput.fill(promoCode);
await page.waitForTimeout(800);
await page.locator('button:has-text("Search")').first().click();
await page.waitForTimeout(2500);

phase = 'open-edit-modal';
const row = page.locator(`tr:has-text("${promoCode}")`).first();
await row.waitFor({ timeout: 10000 });
await row.locator('a, button').first().click();
await page.waitForTimeout(3500);
console.log(`[edit modal opened] ${promoCode}`);

// Capture form state before clicking dropdown
const stateBefore = await page.evaluate(() => {
  const triggers = Array.from(document.querySelectorAll('kt-dropdown-wo-lazyload, kt-dropdown')).filter((t) => t.offsetParent !== null);
  return triggers.map((t) => {
    const btn = t.querySelector('.c-btn');
    const txt = btn ? (btn.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50) : null;
    // Find nearby label
    let p = t;
    let lblText = null;
    for (let i = 0; i < 14 && p.parentElement; i++) {
      p = p.parentElement;
      const lbl = p.querySelector('span.kt-font-bold, label');
      if (lbl) { lblText = (lbl.textContent || '').replace(/\s+/g, ' ').trim(); break; }
    }
    return { label: lblText, trigger: txt };
  });
});
console.log('\n=== kt-dropdowns on Edit modal (BEFORE click) ===');
stateBefore.forEach((s, i) => console.log(`  [${i}] label="${s.label}" trigger="${s.trigger}"`));

phase = 'open-dialog-dropdown';
console.log('\n[step] opening Dialog Popup kt-dropdown');
const opened = await page.evaluate(() => {
  const triggers = Array.from(document.querySelectorAll('kt-dropdown-wo-lazyload .c-btn, kt-dropdown .c-btn'))
    .filter((b) => b.offsetParent !== null);
  for (const b of triggers) {
    let p = b;
    for (let i = 0; i < 14 && p.parentElement; i++) {
      p = p.parentElement;
      const lbl = p.querySelector('span.kt-font-bold, label');
      if (lbl && /Dialog\s*Popup/i.test((lbl.textContent || '').trim())) {
        b.scrollIntoView({ block: 'center' });
        b.click();
        return { ok: true };
      }
    }
  }
  return { ok: false };
});
if (!opened.ok) { console.log('FATAL: could not open Dialog Popup dropdown'); process.exit(2); }
await page.waitForTimeout(2000);

phase = 'pick-first-item';
console.log('\n[step] picking FIRST item in dropdown panel');
const pickRes = await page.evaluate(() => {
  const panels = Array.from(document.querySelectorAll('.dropdown-list')).filter((p) => p.offsetParent !== null);
  const panel = panels[panels.length - 1];
  if (!panel) return { ok: false, reason: 'no panel' };
  const items = Array.from(panel.querySelectorAll('li')).filter((li) => li.offsetParent !== null);
  if (items.length === 0) return { ok: false, reason: 'no items' };
  const first = items[0];
  const txt = (first.textContent || '').replace(/\s+/g, ' ').trim();
  first.click();
  return { ok: true, itemText: txt, itemCount: items.length };
});
console.log(`  picked: "${pickRes.itemText}" (panel had ${pickRes.itemCount} items)`);
await page.waitForTimeout(1500);

// Close panel by clicking the Dialog Popup trigger AGAIN to toggle it.
// Don't click outside the modal — that closes the Edit modal entirely.
phase = 'close-panel';
await page.evaluate(() => {
  const triggers = Array.from(document.querySelectorAll('kt-dropdown-wo-lazyload .c-btn, kt-dropdown .c-btn'))
    .filter((b) => b.offsetParent !== null);
  for (const b of triggers) {
    let p = b;
    for (let i = 0; i < 14 && p.parentElement; i++) {
      p = p.parentElement;
      const lbl = p.querySelector('span.kt-font-bold, label');
      if (lbl && /Dialog\s*Popup/i.test((lbl.textContent || '').trim())) {
        b.click();
        return;
      }
    }
  }
});
await page.waitForTimeout(800);

// Capture form state AFTER click
const stateAfter = await page.evaluate(() => {
  const triggers = Array.from(document.querySelectorAll('kt-dropdown-wo-lazyload, kt-dropdown')).filter((t) => t.offsetParent !== null);
  return triggers.map((t) => {
    const btn = t.querySelector('.c-btn');
    const txt = btn ? (btn.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) : null;
    let p = t;
    let lblText = null;
    for (let i = 0; i < 14 && p.parentElement; i++) {
      p = p.parentElement;
      const lbl = p.querySelector('span.kt-font-bold, label');
      if (lbl) { lblText = (lbl.textContent || '').replace(/\s+/g, ' ').trim(); break; }
    }
    return { label: lblText, trigger: txt };
  });
});
console.log('\n=== kt-dropdowns AFTER pick ===');
stateAfter.forEach((s, i) => console.log(`  [${i}] label="${s.label}" trigger="${s.trigger}"`));

phase = 'submit-edit-modal';
console.log('\n[step] clicking Submit on Edit Promotion Code modal');
try {
  const editModal = page.locator('mat-dialog-container, [role="dialog"], .modal-content')
    .filter({ hasText: /Edit\s*Promotion\s*Code/i })
    .last();
  const editSubmit = editModal.locator('button').filter({ hasText: /^\s*Submit\s*$/i }).first();
  await editSubmit.waitFor({ state: 'visible', timeout: 3000 });
  await editSubmit.click({ timeout: 3000 });
  console.log('  ✓ Submit clicked');
} catch (e) {
  console.log('  Submit click failed:', e.message.split('\n')[0]);
}
await page.waitForTimeout(5000);

phase = 'done';

console.log('\n\n========== ALL API CALLS ==========');
calls.forEach((c, i) => {
  console.log(`[${i}] phase=${c.phase} ${c.method} ${c.status} ${c.url.replace(/\?.*$/, '')}`);
});

// Highlight the calls during 'pick-first-item' and 'submit-edit-modal'
console.log('\n========== KEY PHASES ==========');
const linkCalls = calls.filter((c) => c.phase === 'pick-first-item' || c.phase === 'close-panel' || c.phase === 'submit-edit-modal');
linkCalls.forEach((c, i) => {
  console.log(`\n[${i}] phase=${c.phase} ${c.method} ${c.status} ${c.url.replace(/\?.*$/, '')}`);
  if (c.requestBody) {
    const trunc = c.requestBody.length > 1000 ? c.requestBody.slice(0, 1000) + '...' : c.requestBody;
    console.log(`     request: ${trunc}`);
  }
  if (c.responseBody) {
    const trunc = c.responseBody.length > 800 ? c.responseBody.slice(0, 800) + '...' : c.responseBody;
    console.log(`     response: ${trunc}`);
  }
});

await writeFile(path.join(OUT, `dialog-link-mechanism-probe-${siteId}-${promoCode}.json`), JSON.stringify({ stateBefore, stateAfter, pickRes, calls }, null, 2));
console.log(`\nSaved: captures/dialog-link-mechanism-probe-${siteId}-${promoCode}.json`);

await page.waitForTimeout(2500);
await ctx.close();
await browser.close();
