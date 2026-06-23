// QP2A-specific dialog link probe. Opens an Edit modal, finds the Dialog
// Popup dropdown via a more permissive selector, picks the first item,
// clicks Submit, and dumps the resulting PUT body.
//
//   node src/browser/qp2-dialog-link-probe.js TEST_VIP_30FC_5X_MB25

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSite } from '../sites.js';

const promoCode = process.argv[2] || 'TEST_VIP_30FC_5X_MB25';
const site = getSite('ibc22');
const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 40, args: ['--start-maximized'] });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();

const calls = [];
page.on('request', (req) => {
  const url = req.url();
  if (!/\/api\/bo\//i.test(url)) return;
  calls.push({ method: req.method(), url, requestBody: req.postData() || null, status: null });
});
page.on('response', async (resp) => {
  const url = resp.url();
  if (!/\/api\/bo\//i.test(url)) return;
  const last = [...calls].reverse().find((c) => c.url === url && c.status === null);
  if (last) { last.status = resp.status(); try { last.responseBody = (await resp.text()).slice(0, 15000); } catch {} }
});

await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
await page.locator('button:has-text("Login")').click();
await page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2500);

await page.locator('input[formcontrolname="name"]').first().fill(promoCode);
await page.waitForTimeout(800);
await page.locator('button:has-text("Search")').first().click();
await page.waitForTimeout(2500);
await page.locator(`tr:has-text("${promoCode}")`).first().locator('a, button').first().click();
await page.waitForTimeout(3500);
console.log(`[edit modal opened] ${promoCode}`);

// Find the Dialog Popup dropdown trigger. Strategy: locate any element
// whose own text is EXACTLY "Dialog Popup" (the field label), then find
// the FIRST clickable trigger (kt-dropdown / mat-select / ng-select)
// inside the same row-group ancestor.
const trigger = await page.evaluate(() => {
  // Find the label element first.
  const allLabels = Array.from(document.querySelectorAll('span.kt-font-bold, label, .form-label, h6, strong'))
    .filter((el) => el.offsetParent !== null && /^\s*Dialog\s*Popup\s*\*?\s*$/i.test((el.textContent || '').trim()));
  for (const lbl of allLabels) {
    // Walk up to the form-row ancestor.
    let row = lbl;
    for (let i = 0; i < 6 && row.parentElement; i++) {
      row = row.parentElement;
      const trig = row.querySelector('kt-dropdown-wo-lazyload .c-btn, kt-dropdown .c-btn, ng-select, mat-select');
      if (trig) {
        trig.scrollIntoView({ block: 'center' });
        trig.click();
        return { ok: true, triggerTag: trig.tagName.toLowerCase(), triggerClass: (trig.className || '').slice(0, 100), rowDepth: i };
      }
    }
  }
  return { ok: false, labelCount: allLabels.length };
});
console.log('trigger:', JSON.stringify(trigger));
if (!trigger.ok) process.exit(2);
await page.waitForTimeout(1500);

// Wait longer for lazy-loaded items
await page.waitForTimeout(2500);

// Dump every visible "panel-like" element + items, plus full inner HTML
const panelInfo = await page.evaluate(() => {
  const candidates = Array.from(document.querySelectorAll('.dropdown-list, .ng-dropdown-panel, .mat-select-panel, ul[role="listbox"], [class*="dropdown-menu"]:not(.kt-portlet)'))
    .filter((p) => p.offsetParent !== null);
  return candidates.map((p) => ({
    tag: p.tagName.toLowerCase(),
    cls: (p.className || '').slice(0, 200),
    itemCount: p.querySelectorAll('li, .ng-option, [role="option"]').length,
    firstItemText: (p.querySelector('li, .ng-option, [role="option"]')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    innerHtmlSlice: (p.innerHTML || '').replace(/\s+/g, ' ').slice(0, 500),
  }));
});
console.log('panels found:', JSON.stringify(panelInfo, null, 2));

// Try to pick the first item in any panel that has items
const pickRes = await page.evaluate(() => {
  const candidates = Array.from(document.querySelectorAll('.dropdown-list, .ng-dropdown-panel, .mat-select-panel, ul[role="listbox"], [class*="dropdown-menu"]:not(.kt-portlet)'))
    .filter((p) => p.offsetParent !== null);
  for (const panel of candidates) {
    const items = Array.from(panel.querySelectorAll('li, .ng-option, [role="option"]')).filter((li) => li.offsetParent !== null);
    if (items.length === 0) continue;
    const first = items[0];
    const text = (first.textContent || '').replace(/\s+/g, ' ').trim();
    first.click();
    return { ok: true, itemText: text, itemCount: items.length };
  }
  return { ok: false };
});
console.log('pickRes:', JSON.stringify(pickRes));
await page.waitForTimeout(1500);

// Close any open panel by clicking the trigger again
await page.evaluate(() => {
  const triggers = Array.from(document.querySelectorAll('kt-dropdown-wo-lazyload .c-btn, kt-dropdown .c-btn')).filter((b) => b.offsetParent !== null);
  for (const b of triggers) {
    let p = b;
    for (let i = 0; i < 14 && p.parentElement; i++) {
      p = p.parentElement;
      const lbl = p.querySelector('span.kt-font-bold, label');
      if (lbl && /Dialog\s*Popup/i.test((lbl.textContent || '').trim())) { b.click(); return; }
    }
  }
});
await page.waitForTimeout(800);

// Click Submit
console.log('[step] Submit');
try {
  const editModal = page.locator('mat-dialog-container, [role="dialog"], .modal-content').filter({ hasText: /Edit\s*Promotion\s*Code/i }).last();
  const editSubmit = editModal.locator('button').filter({ hasText: /^\s*Submit\s*$/i }).first();
  await editSubmit.waitFor({ state: 'visible', timeout: 3000 });
  await editSubmit.click({ timeout: 3000 });
  console.log('  ✓ Submit clicked');
} catch (e) {
  console.log('  Submit failed:', e.message.split('\n')[0]);
}
await page.waitForTimeout(5000);

// Find the PUT and dump its body
const put = calls.find((c) => c.method === 'PUT' && /\/api\/bo\/promotion\/\d+/.test(c.url));
if (put) {
  console.log(`\n=== PUT ${put.url.split('?')[0]} status=${put.status} ===`);
  const body = JSON.parse(put.requestBody);
  console.log('dialog_popup_list:', JSON.stringify(body.dialog_popup_list, null, 2));
} else {
  console.log('\nNo PUT captured.');
}

await writeFile(path.join(OUT, `qp2-dialog-link-probe-${promoCode}.json`), JSON.stringify({ trigger, panelInfo, pickRes, calls }, null, 2));

await page.waitForTimeout(2500);
await ctx.close();
await browser.close();
