// Single-purpose probe: how is "Game Providers" structured in the QPRO11
// Create form? Captures the exact DOM around the Game Providers label.
//
//   node src/browser/qpro-gp-probe.js --site=qpro11

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../../bin/_args.js';
import { getSite } from '../sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const site = getSite(flags.site || 'qpro11');
const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 20 });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
const loginResp = page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
await page.locator('button:has-text("Login")').click();
await loginResp;
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2500);
await page.locator('button:has-text("Create")').last().click({ timeout: 3000 });
await page.waitForTimeout(3000);

// Pick Deposit so the form is in the same state the canary leaves it in.
await page.locator('form:has(input[formcontrolname="code"])').last().locator('select[formcontrolname="promo_type"]').selectOption({ label: 'Deposit' });
await page.waitForTimeout(2500);

// Scroll Game Providers into view in case it's below the fold.
const gpSpan = page.locator('form:has(input[formcontrolname="code"])').locator(`xpath=.//span[contains(@class,'kt-font-bold') and contains(normalize-space(.), 'Game Providers')]`).first();
await gpSpan.scrollIntoViewIfNeeded({ timeout: 5000 }).catch((e) => console.error(`[probe] scrollIntoView failed: ${e.message.split('\n')[0]}`));
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT, `${site.id}-gp-context.png`), fullPage: true });

// Inspect the span's surrounding DOM
const info = await page.evaluate(() => {
  // Find every span.kt-font-bold containing "Game Providers" text.
  const spans = Array.from(document.querySelectorAll('span.kt-font-bold')).filter((s) => {
    const t = (s.textContent || '').replace(/\s+/g, ' ').trim();
    return t.includes('Game Providers');
  });
  return spans.map((span, idx) => {
    // Walk up to find ALL row ancestors (innermost first)
    const rowAncestors = [];
    let p = span.parentElement;
    while (p) {
      if (p.classList && (p.classList.contains('row') || /row/.test(p.className))) {
        rowAncestors.push({
          tag: p.tagName.toLowerCase(),
          cls: p.className.slice(0, 80),
          // Find kt-dropdown and c-btn inside this ancestor
          ktCount: p.querySelectorAll('kt-dropdown-wo-lazyload, kt-dropdown').length,
          cBtnCount: p.querySelectorAll('.c-btn').length,
        });
      }
      p = p.parentElement;
    }
    // Also: NEXT sibling traversal — what's after the span's parent?
    const parent = span.parentElement;
    const nextSibling = parent?.nextElementSibling;
    let nextSiblingInfo = null;
    if (nextSibling) {
      nextSiblingInfo = {
        tag: nextSibling.tagName.toLowerCase(),
        cls: nextSibling.className.slice(0, 80),
        ktCount: nextSibling.querySelectorAll('kt-dropdown-wo-lazyload, kt-dropdown').length,
        cBtnCount: nextSibling.querySelectorAll('.c-btn').length,
        firstCBtnTag: nextSibling.querySelector('.c-btn')?.tagName?.toLowerCase() || null,
      };
    }
    return {
      idx,
      exactText: JSON.stringify(span.textContent),
      normalized: span.textContent.replace(/\s+/g, ' ').trim(),
      parentTag: parent?.tagName?.toLowerCase(),
      parentCls: parent?.className?.slice(0, 80),
      rowAncestors,
      nextSiblingInfo,
      visible: !!(span.offsetWidth || span.offsetHeight),
    };
  });
});

await writeFile(path.join(OUT, `${site.id}-gp-info.json`), JSON.stringify(info, null, 2));
info.forEach((i) => {
  console.log(`--- Game Providers span [${i.idx}] ---`);
  console.log(`  exactText: ${i.exactText}`);
  console.log(`  normalized: "${i.normalized}"`);
  console.log(`  visible: ${i.visible}`);
  console.log(`  parent: ${i.parentTag}.${JSON.stringify(i.parentCls)}`);
  console.log(`  rowAncestors (innermost first):`);
  i.rowAncestors.forEach((r, ridx) => console.log(`    [${ridx}] ${r.tag}.${JSON.stringify(r.cls)} → kt=${r.ktCount} c-btn=${r.cBtnCount}`));
  console.log(`  nextSibling: ${JSON.stringify(i.nextSiblingInfo)}`);
});

await ctx.close();
await browser.close();
