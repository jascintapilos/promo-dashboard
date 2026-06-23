// Probe: After opening the Create New Dialog form (inline on QPRO), dump
// every visible button + its location relative to the form so we can
// pin the right Submit selector.
//
//   node src/browser/dialog-submit-button-probe.js qpro11

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSite } from '../sites.js';

const siteId = process.argv[2] || 'qpro11';
const site = getSite(siteId);
const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 35, args: ['--start-maximized'] });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();

await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
await page.locator('button:has-text("Login")').click();
await page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
console.log(`[login ok] ${siteId}`);

await page.goto(`${site.baseUrl}/settings/dialog`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(3500);

// Click "Create New Content" via the now-known selector
await page.locator('th.pr-0.pl-0:has-text("Create New Content")').first().click({ timeout: 5000 });
await page.waitForTimeout(3000);
console.log('[click ok] Create New Content');

// Dump every visible button + nearby context
const probe = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('button, a.btn, [type="submit"], [role="button"]'))
    .filter((b) => b.offsetParent !== null);
  return buttons.map((b, i) => {
    const r = b.getBoundingClientRect();
    return {
      idx: i,
      tag: b.tagName.toLowerCase(),
      text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      cls: (b.className?.toString() || '').slice(0, 100),
      type: b.getAttribute('type') || '',
      x: Math.round(r.x), y: Math.round(r.y),
      w: Math.round(r.width), h: Math.round(r.height),
      disabled: b.disabled === true,
    };
  });
});

// Also locate the form's CKEditor — Submit should be a sibling/below it
const formAnchor = await page.evaluate(() => {
  const editor = document.querySelector('.ck-editor__editable[contenteditable="true"]');
  if (!editor) return null;
  const r = editor.getBoundingClientRect();
  // Climb up to find the form container
  let container = editor;
  for (let i = 0; i < 10; i++) {
    if (!container.parentElement) break;
    container = container.parentElement;
    if (container.tagName === 'FORM' || container.classList?.contains('kt-portlet')) break;
  }
  const cr = container.getBoundingClientRect();
  return {
    editorY: Math.round(r.y),
    editorH: Math.round(r.height),
    containerTag: container.tagName.toLowerCase(),
    containerCls: (container.className?.toString() || '').slice(0, 200),
    containerX: Math.round(cr.x),
    containerY: Math.round(cr.y),
    containerW: Math.round(cr.width),
    containerH: Math.round(cr.height),
  };
});

await writeFile(path.join(OUT, `dialog-submit-button-probe-${siteId}.json`), JSON.stringify({ buttons: probe, formAnchor }, null, 2));
console.log('\n=== Form anchor (CKEditor → ancestor container) ===');
console.log(`  container=<${formAnchor?.containerTag}> cls="${formAnchor?.containerCls?.slice(0,100)}"`);
console.log(`  bbox: x=${formAnchor?.containerX} y=${formAnchor?.containerY} w=${formAnchor?.containerW} h=${formAnchor?.containerH}`);
console.log(`  editor y=${formAnchor?.editorY} h=${formAnchor?.editorH}`);

console.log('\n=== Visible buttons on page ===');
probe.forEach((b) => {
  const inForm = formAnchor && b.y >= formAnchor.containerY && b.y < (formAnchor.containerY + formAnchor.containerH);
  console.log(`  [${b.idx}] <${b.tag}> y=${b.y} text="${b.text}" cls="${b.cls.slice(0,40)}" ${inForm ? '⟵ in form' : ''}`);
});

await page.screenshot({ path: path.join(OUT, `dialog-submit-button-probe-${siteId}.png`), fullPage: true }).catch(() => {});
console.log(`\nSaved: captures/dialog-submit-button-probe-${siteId}.json`);

await page.waitForTimeout(2500);
await ctx.close();
await browser.close();
