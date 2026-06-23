// Probe: dump DOM around the "+ Create New Content" strip on the Dialog
// list page, so we can pin a precise selector. The current OR-fallback
// matched a span that doesn't trigger the form when clicked.
//
//   node src/browser/dialog-create-button-probe.js qpro11
//   node src/browser/dialog-create-button-probe.js ibc22

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
console.log(`[nav] ${page.url()}`);

const probe = await page.evaluate(() => {
  const matches = [];
  const all = Array.from(document.querySelectorAll('*'));
  for (const el of all) {
    if (el.offsetParent === null) continue;
    const own = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!/Create New Content/i.test(own)) continue;
    // Only direct text-containing nodes (small subtrees)
    if (el.children.length > 5) continue;
    matches.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className?.toString() || '').slice(0, 200),
      id: el.id || '',
      role: el.getAttribute('role') || '',
      onclick: !!el.onclick,
      ariaLabel: el.getAttribute('aria-label') || '',
      title: el.getAttribute('title') || '',
      text: own.slice(0, 80),
      childCount: el.children.length,
      parentTag: el.parentElement?.tagName.toLowerCase() || '',
      parentCls: (el.parentElement?.className?.toString() || '').slice(0, 200),
      parentTag2: el.parentElement?.parentElement?.tagName.toLowerCase() || '',
      parentCls2: (el.parentElement?.parentElement?.className?.toString() || '').slice(0, 200),
      hasCursorPointer: window.getComputedStyle(el).cursor === 'pointer',
    });
  }
  return matches;
});

await writeFile(path.join(OUT, `dialog-create-button-probe-${siteId}.json`), JSON.stringify(probe, null, 2));
console.log(`\n=== "Create New Content" candidates on ${siteId} ===`);
probe.forEach((p, i) => {
  console.log(`  [${i}] <${p.tag}> cls="${p.cls.slice(0,60)}" cursor=${p.hasCursorPointer} children=${p.childCount}`);
  console.log(`         parent: <${p.parentTag}> cls="${p.parentCls.slice(0,60)}"`);
  console.log(`         grandparent: <${p.parentTag2}> cls="${p.parentCls2.slice(0,60)}"`);
});

await page.screenshot({ path: path.join(OUT, `dialog-create-button-probe-${siteId}.png`), fullPage: true }).catch(() => {});
console.log(`\nSaved: captures/dialog-create-button-probe-${siteId}.json`);
console.log(`Saved: captures/dialog-create-button-probe-${siteId}.png`);

await page.waitForTimeout(2500);
await ctx.close();
await browser.close();
