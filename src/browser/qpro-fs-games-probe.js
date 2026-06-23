// Probe: open QPRO11 Create Promotion Code form, pick Free Spin, then
// dump everything we can learn about the Free Spin Games dropdowns —
// HTML structure, formcontrolname (if any), label markup, option labels.
//
// Run: node src/browser/qpro-fs-games-probe.js
//
// Writes to captures/qpro11-fs-games-probe.json.

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSite } from '../sites.js';

const site = getSite('qpro11');
const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

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

// Open Create Promo Code form.
await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2000);
await page.locator('button:has-text("Create")').first().click();
await page.waitForTimeout(2500);
console.log('[create-form] opened');

// Pick Free Spin in the Promo Type dropdown.
await page.locator('form:has(input[formcontrolname="code"]) select[formcontrolname="promo_type"]').last().selectOption({ label: 'Free Spin' });
await page.waitForTimeout(2500);
console.log('[promo-type] Free Spin picked, waiting for FS-specific fields to render');

// Dump everything related to FS Games.
const result = await page.evaluate(() => {
  // 1. Find any text node containing "Free Spin Games" (case-sensitive first, then -insensitive)
  const all = Array.from(document.querySelectorAll('*'));
  const labelEls = all.filter((el) => {
    if (el.children.length > 0) return false; // leaf nodes only
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return /^Free Spin Games/i.test(t);
  });

  const labelInfo = labelEls.map((el) => ({
    tag: el.tagName.toLowerCase(),
    cls: el.className,
    text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
    // Walk up to find the enclosing row/group
    rowOuterHTML: (() => {
      let p = el;
      for (let i = 0; i < 6; i++) {
        if (!p.parentElement) break;
        p = p.parentElement;
        if (p.classList && (p.classList.contains('row') || p.classList.contains('form-group') || p.tagName === 'TR')) {
          return p.outerHTML.slice(0, 4000);
        }
      }
      return el.parentElement?.outerHTML?.slice(0, 4000) || '';
    })(),
  }));

  // 2. Find ALL visible selects on the page (any formcontrolname), so we
  //    can pick out which two are the FS Games selects.
  const selects = Array.from(document.querySelectorAll('select')).filter((s) => s.offsetParent !== null);
  const selectInfo = selects.map((s, idx) => ({
    idx,
    formcontrolname: s.getAttribute('formcontrolname'),
    id: s.id,
    name: s.name,
    cls: s.className,
    options: Array.from(s.options).map((o) => o.textContent.trim()).slice(0, 10),
    valueLabel: s.options[s.selectedIndex]?.textContent?.trim() || null,
    nearbyLabel: (() => {
      // Walk up to find a nearby span with a "*" indicator or kt-font-bold,
      // or any label/heading text within 3 ancestors.
      let p = s;
      for (let i = 0; i < 4; i++) {
        if (!p.parentElement) break;
        p = p.parentElement;
        const span = p.querySelector('span.kt-font-bold, label, th, .label, .form-label');
        if (span) return (span.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      }
      return null;
    })(),
  }));

  // 3. Also check for ng-select / kt-dropdown / mat-select (Angular custom dropdowns)
  const customSelectsTags = ['ng-select', 'kt-dropdown', 'kt-dropdown-wo-lazyload', 'mat-select'];
  const customSelects = [];
  for (const tag of customSelectsTags) {
    const list = Array.from(document.querySelectorAll(tag)).filter((el) => el.offsetParent !== null);
    list.forEach((el, idx) => customSelects.push({
      tag,
      idx,
      cls: el.className,
      // formcontrolname might be on the host element OR a child input
      formcontrolname: el.getAttribute('formcontrolname') || (el.querySelector('[formcontrolname]')?.getAttribute('formcontrolname') || null),
      visibleText: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    }));
  }

  return { labelInfo, selectInfo, customSelects };
});

await writeFile(path.join(OUT, 'qpro11-fs-games-probe.json'), JSON.stringify(result, null, 2));
console.log('=== PROBE RESULT ===');
console.log(JSON.stringify(result, null, 2));

await ctx.close();
await browser.close();
