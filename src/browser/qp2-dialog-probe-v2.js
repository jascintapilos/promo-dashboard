// Probe v2: dump the full QP2 BO sidebar tree to find the Dialog route.
//
//   node src/browser/qp2-dialog-probe-v2.js

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSite } from '../sites.js';

const site = getSite('ibc22');
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
console.log('[login] ok');
await page.waitForTimeout(2000);

// ── Step 1: dump EVERY routerlink on the page ──────────────────────
const allRouterlinks = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('[routerlink], [routerLink], a[href^="/"]'));
  return els.map((el) => ({
    tag: el.tagName.toLowerCase(),
    text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100),
    routerlink: el.getAttribute('routerlink') || el.getAttribute('routerLink') || '',
    href: el.getAttribute('href') || '',
    visible: !!(el.offsetWidth || el.offsetHeight),
  })).filter((e) => e.routerlink || e.href);
});
console.log(`\n=== All routerlinks (${allRouterlinks.length}) ===`);
for (const r of allRouterlinks) {
  console.log(`  [${r.visible ? 'V' : ' '}] <${r.tag}> "${r.text.slice(0, 50)}" → ${r.routerlink || r.href}`);
}

// ── Step 2: try clicking parent menu items to expand sub-menus ─────
// QP2 BO uses kt-menu structure. Top-level items might collapse children.
// Look for any sidebar item with arrow icon or "menu" indicator.
const sidebarParents = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('.kt-menu__link, .kt-menu__item > a, nav a, li > a, [class*="menu"] a'))
    .filter((el) => el.offsetParent !== null)
    .slice(0, 50)
    .map((el) => ({
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      cls: el.className.slice(0, 80),
      href: el.getAttribute('href') || '',
    }))
    .filter((e) => e.text && e.text.length < 60);
});
console.log(`\n=== Visible sidebar items (${sidebarParents.length}) ===`);
for (const s of sidebarParents) {
  console.log(`  "${s.text}"`);
}

// ── Step 3: search for any element with text "CMS" or "Announce" ─
const cmsSearch = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('*'));
  return all
    .filter((el) => {
      const direct = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
      return direct && /^(CMS|Announce|Dialog|Module|14|15)/i.test(direct);
    })
    .slice(0, 30)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100),
      cls: el.className.toString().slice(0, 80),
      visible: !!(el.offsetWidth || el.offsetHeight),
    }));
});
console.log(`\n=== Elements with leading text CMS/Announce/Dialog/14/15 ===`);
for (const c of cmsSearch) {
  console.log(`  [${c.visible ? 'V' : ' '}] <${c.tag}> "${c.text.slice(0, 80)}"`);
}

// Take a sidebar screenshot
await page.screenshot({ path: path.join(OUT, 'qp2-dialog-probe-v2-dashboard.png'), fullPage: true }).catch(() => {});

// Dump everything
await writeFile(path.join(OUT, 'qp2-dialog-probe-v2.json'), JSON.stringify({
  allRouterlinks,
  sidebarParents,
  cmsSearch,
}, null, 2));
console.log('\nSaved: captures/qp2-dialog-probe-v2.json');

await page.waitForTimeout(2000);
await ctx.close();
await browser.close();
