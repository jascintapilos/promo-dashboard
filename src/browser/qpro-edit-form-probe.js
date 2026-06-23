// 5.3d probe — discover the post-save flow on QPRO11:
//   * the URL pattern when you open an existing code in edit mode
//   * whether "+ Promotion Names" is on the Create form (and what happens
//     when clicked before save) or only on Edit
//   * the Names popup DOM: locale picker, name fields, submit button
//
//   node src/browser/qpro-edit-form-probe.js [--site=qpro11] [--code=FT_REL_…]
//
// If --code is given, the probe opens that code. Otherwise it picks the
// first code on the list (any existing promo) and opens it.

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../../bin/_args.js';
import { getSite } from '../sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const headless = !(flags.headless === 'false' || process.env.HEADLESS === 'false');
const site = getSite(flags.site || 'qpro11');
const targetCode = flags.code || '';

const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

// Pipe console errors out so we see any Angular bootstrap noise.
page.on('pageerror', (e) => console.error('[page error]', e.message));

// ── Capture all XHR responses, useful for finding the names-list endpoint
const xhrLog = [];
page.on('response', async (r) => {
  const url = r.url();
  if (!url.includes('823868.com')) return;
  if (!/(promotion|name|currency)/i.test(url)) return;
  let body = '';
  try { body = (await r.text()).slice(0, 1500); } catch {}
  xhrLog.push({ method: r.request().method(), url, status: r.status(), body });
});

console.error(`[probe] ${site.id} login`);
await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.locator('input[formcontrolname="merchant_code"]').waitFor({ timeout: 20000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
const loginResp = page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
await page.locator('button:has-text("Login")').click();
await loginResp;
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

// ── PROBE 1: Check the Create form for a Names button ─────────────────
console.error(`[probe] checking Create form for Names button`);
await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);
await page.locator('button:has-text("Create")').first().click();
await page.waitForTimeout(2500);
const createFormButtons = await page.$$eval('button, a[role="button"]', (els) =>
  els.filter((e) => e.offsetWidth || e.offsetHeight)
    .map((e) => (e.textContent || '').trim())
    .filter((t) => t.length > 0 && t.length < 60)
);
const namesButtonInCreate = createFormButtons.find((b) => /names?/i.test(b) || /\+\s*Name/i.test(b));
console.error(`[probe] Create form buttons containing "Name": ${createFormButtons.filter((b) => /name/i.test(b)).join(' | ') || 'NONE'}`);
console.error(`[probe] "+ Promotion Names" on Create form: ${namesButtonInCreate ? 'YES — "' + namesButtonInCreate + '"' : 'NO'}`);
await page.screenshot({ path: path.join(OUT, `${site.id}-create-form-buttons.png`), fullPage: true }).catch(() => {});

// ── PROBE 2: Navigate to list, SEARCH for a known code, open the row ──
await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);

// The list page renders empty by default — "Press Search to load data".
// The filters at the top expose ID (numeric) + Promotion (text by name).
// We search by Promotion (text) since the operator typically knows the code,
// not the numeric id.
const searchCode = targetCode || 'FT_WEL_SLOTS_120PCT'; // known existing on QPRO11 (id=139)
console.error(`[probe] searching for "${searchCode}" via the Promotion text filter`);
await page.locator('input[formcontrolname="promotion"]').first().waitFor({ timeout: 15000 });
await page.locator('input[formcontrolname="promotion"]').first().fill(searchCode);
const tableRespP = page.waitForResponse((r) => r.url().includes('/api/bo/promotion?') && r.status() === 200, { timeout: 10000 }).catch(() => null);
await page.locator('button:has-text("Search")').first().click();
await tableRespP;
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(OUT, `${site.id}-list-after-search.png`), fullPage: true }).catch(() => {});

// Now rows should be present and visible.
console.error('[probe] looking for the row containing the code');
const beforeUrl = page.url();
const targetRow = page.locator(`tr:has-text("${searchCode}")`).first();
let clicked = false;
try {
  await targetRow.waitFor({ timeout: 8000 });
  // Try clicking an edit icon inside the row first.
  const inRowEdit = targetRow.locator('a, button').first();
  await inRowEdit.click();
  clicked = true;
  console.error('[probe] clicked an action inside the row');
} catch (e) {
  console.error('[probe] in-row click failed:', e.message.split('\n')[0]);
}
await page.waitForTimeout(3000);
await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
const editUrl = page.url();
console.error(`[probe] before: ${beforeUrl}`);
console.error(`[probe] after:  ${editUrl}`);
console.error(`[probe] page title: ${await page.title()}`);
await page.screenshot({ path: path.join(OUT, `${site.id}-edit-page.png`), fullPage: true }).catch(() => {});

// Find all buttons on the edit page — Names should be one of them.
const editFormButtons = await page.$$eval('button, a[role="button"]', (els) =>
  els.filter((e) => e.offsetWidth || e.offsetHeight)
    .map((e) => ({ text: (e.textContent || '').trim(), tag: e.tagName }))
    .filter((b) => b.text.length > 0 && b.text.length < 60)
);
console.error('[probe] edit-page buttons containing Name:');
editFormButtons.filter((b) => /name/i.test(b.text)).forEach((b) => console.error('  ' + b.text));

// ── PROBE 3: Click the Names button, capture the popup ────────────────
const namesBtn = page.locator('button:has-text("+ Promotion Names"), button:has-text("Promotion Names"), button:has-text("Promotion Name")').first();
let popupCaptured = null;
try {
  await namesBtn.waitFor({ timeout: 5000 });
  await namesBtn.click();
  console.error('[probe] clicked Promotion Names button');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, `${site.id}-names-popup.png`), fullPage: true }).catch(() => {});

  // The popup is usually a modal at the page level. Capture all visible
  // input/select/textarea/button inside elements with role=dialog or
  // class containing modal.
  popupCaptured = await page.evaluate(() => {
    const modal = document.querySelector('[role="dialog"], .modal-content, .modal-dialog, kt-modal, .mat-dialog-container');
    const scope = modal || document.body;
    const visible = (e) => !!(e.offsetWidth || e.offsetHeight);
    const items = (sel, fn) => Array.from(scope.querySelectorAll(sel)).filter(visible).map(fn);
    return {
      modalFound: !!modal,
      modalTag: modal ? modal.tagName.toLowerCase() : null,
      inputs: items('input, textarea', (e) => ({
        tag: e.tagName.toLowerCase(),
        type: e.type || '',
        placeholder: e.placeholder || '',
        formcontrolname: e.getAttribute('formcontrolname') || '',
        name: e.name || '',
      })),
      selects: items('select', (e) => ({
        formcontrolname: e.getAttribute('formcontrolname') || '',
        options: Array.from(e.options).map((o) => ({ value: o.value, label: o.textContent.trim() })),
      })),
      buttons: items('button, a[role="button"]', (e) => ({
        text: (e.textContent || '').trim().slice(0, 60),
        type: e.type || '',
      })),
      multiselects: items('kt-dropdown-wo-lazyload, kt-dropdown, .multiselect', (e) => ({
        tag: e.tagName.toLowerCase(),
        text: (e.textContent || '').trim().slice(0, 120),
      })),
    };
  });
  console.error(`[probe] popup captured: ${popupCaptured.inputs.length} inputs, ${popupCaptured.selects.length} selects, ${popupCaptured.buttons.length} buttons, ${popupCaptured.multiselects.length} multi-selects`);
} catch (e) {
  console.error('[probe] Names button not found or click failed:', e.message);
}

// ── Save the haul ─────────────────────────────────────────────────────
const out = {
  site: site.id,
  baseUrl: site.baseUrl,
  beforeUrl,
  editUrl,
  createForm: { namesButtonPresent: !!namesButtonInCreate, namesButtonText: namesButtonInCreate || null },
  editForm: { buttonsWithName: editFormButtons.filter((b) => /name/i.test(b.text)) },
  namesPopup: popupCaptured,
  xhrCount: xhrLog.length,
};
await writeFile(path.join(OUT, `${site.id}-edit-flow-probe.json`), JSON.stringify(out, null, 2));
await writeFile(path.join(OUT, `${site.id}-edit-xhr.json`), JSON.stringify(xhrLog, null, 2));

console.log('\n=== EDIT FLOW PROBE ===');
console.log(JSON.stringify({
  beforeUrl,
  editUrl,
  namesButtonOnCreateForm: !!namesButtonInCreate,
  editPageNameButtons: out.editForm.buttonsWithName,
  popup: popupCaptured && {
    modalFound: popupCaptured.modalFound,
    inputCount: popupCaptured.inputs.length,
    selectCount: popupCaptured.selects.length,
    inputs: popupCaptured.inputs,
    selects: popupCaptured.selects,
    relevantButtons: popupCaptured.buttons.filter((b) => /submit|save|close|add|cancel/i.test(b.text)),
    multiselects: popupCaptured.multiselects.map((m) => m.text.slice(0, 80)),
  },
}, null, 2));

await ctx.close();
await browser.close();
