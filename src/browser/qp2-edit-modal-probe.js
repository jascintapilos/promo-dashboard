// Probe: open the QP2A Edit modal for TEST_QP2A_REL_50PCT_3X_V8 and dump
// every kt-font-bold label + nearby kt-dropdown trigger + Message-related
// elements. The canary's Message-link step couldn't find the Message
// kt-dropdown on QP2 — figure out what's actually there.
//
// Run: node src/browser/qp2-edit-modal-probe.js

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

const code = 'TEST_QP2A_REL_50PCT_3X_V8';
await page.locator('input[formcontrolname="name"]').first().fill(code);
const tableResp = page.waitForResponse((r) => r.url().includes('/api/bo/promotion?') && r.status() === 200, { timeout: 15000 }).catch(() => null);
await page.locator('button:has-text("Search")').first().click();
await tableResp;
await page.waitForTimeout(2500);
console.log('[search] done');

// Open the row's Edit modal
const row = page.locator(`tr:has-text("${code}")`).first();
await row.waitFor({ timeout: 10000 });
const rowAction = row.locator('a, button').first();
await rowAction.click();
await page.waitForTimeout(3000);
console.log('[edit-modal] opened');

// Dump every kt-font-bold span + relevant nearby elements
const dump = await page.evaluate(() => {
  const visible = (el) => el.offsetParent !== null;
  const spans = Array.from(document.querySelectorAll('span.kt-font-bold')).filter(visible);
  const spanInfo = spans.map((s, idx) => ({
    idx,
    text: (s.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    // Look for a .c-btn within the same row/section
    nearbyKtDropdownText: (() => {
      let p = s;
      for (let i = 0; i < 6 && p.parentElement; i++) {
        p = p.parentElement;
        const btn = p.querySelector('kt-dropdown-wo-lazyload .c-btn, kt-dropdown .c-btn');
        if (btn) return (btn.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      }
      return null;
    })(),
  }));

  // Also dump every visible kt-dropdown trigger
  const triggers = Array.from(document.querySelectorAll('kt-dropdown-wo-lazyload .c-btn, kt-dropdown .c-btn')).filter(visible).map((b, idx) => ({
    idx,
    text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    nearbyKtBold: (() => {
      let p = b;
      for (let i = 0; i < 8 && p.parentElement; i++) {
        p = p.parentElement;
        const lbl = p.querySelector('span.kt-font-bold');
        if (lbl) return (lbl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      }
      return null;
    })(),
  }));

  // Also look for any element containing "Message" text (case-sensitive)
  const messageEls = Array.from(document.querySelectorAll('*')).filter((el) => {
    if (!visible(el)) return false;
    if (el.children.length > 0) return false;  // leaf only
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return /^Message\s*\*?\s*$/.test(t);
  }).map((el) => ({
    tag: el.tagName.toLowerCase(),
    cls: (el.className || '').slice(0, 100),
    text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
  }));

  return { spanInfo, triggers, messageEls };
});

await writeFile(path.join(OUT, 'qp2-edit-modal-probe.json'), JSON.stringify(dump, null, 2));
console.log('\n=== kt-font-bold spans in Edit modal ===');
for (const s of dump.spanInfo) {
  console.log(`  [${s.idx}] "${s.text}" → nearby kt-dropdown trigger: "${s.nearbyKtDropdownText}"`);
}
console.log('\n=== All kt-dropdown triggers in Edit modal ===');
for (const t of dump.triggers) {
  console.log(`  [${t.idx}] nearest-label="${t.nearbyKtBold}" trigger-text="${t.text.slice(0, 60)}"`);
}
console.log('\n=== Elements with text exactly "Message" ===');
for (const m of dump.messageEls) {
  console.log(`  <${m.tag}> cls="${m.cls.slice(0, 50)}" text="${m.text}"`);
}

await page.waitForTimeout(2000);
await ctx.close();
await browser.close();
