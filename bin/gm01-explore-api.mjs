#!/usr/bin/env node
// Visits GM01 promo pages with the captured session and intercepts all AJAX calls.
//   node bin/gm01-explore-api.mjs

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const SESSION_FILE = path.resolve('gm01-session.local.json');
const OUT_FILE = path.resolve('captures/gm01-api-map.json');
const BASE_URL = 'https://utn.bo5w.com';

const PROMO_PAGES = [
  '/secure/promotion/promo.setting.list.xhtml',
  '/secure/coupon/coupon.setting.list.xhtml',
  '/secure/coupon/coupon.code.list.xhtml',
  '/secure/coupon/coupon.inprogress.list.xhtml',
  '/secure/coupon/player.coupon.setting.xhtml',
  '/secure/credit/submit.incentive.xhtml',
  '/secure/credit/pending.incentive.xhtml',
  '/secure/report/player.bonus.xhtml',
  '/secure/report/player.game.freespin.summary.xhtml',
  '/secure/cms/cms.promotion.list.xhtml',
  '/secure/transaction/bonus.code.xhtml',
];

const session = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
const browser = await chromium.launch({ headless: false, channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies(session.cookies.map(c => ({ ...c, domain: 'utn.bo5w.com' })));
const page = await ctx.newPage();

const captured = [];
page.on('request', req => {
  const url = req.url();
  if (!url.startsWith(BASE_URL)) return;
  const pathname = new URL(url).pathname;
  // Skip static assets
  if (/\.(css|js|png|jpg|gif|ico|woff|wav|svg)(\?|$)/i.test(pathname)) return;
  captured.push({
    method: req.method(),
    url,
    path: pathname + (new URL(url).search || ''),
    postData: req.postData() || null,
    status: null,
    responseSnippet: null,
  });
});
page.on('response', async res => {
  const url = res.url();
  if (!url.startsWith(BASE_URL)) return;
  const entry = [...captured].reverse().find(c => c.url === url && c.status === null);
  if (!entry) return;
  entry.status = res.status();
  try {
    const ct = res.headers()['content-type'] || '';
    if (ct.includes('json') || ct.includes('xml') || ct.includes('html')) {
      entry.responseSnippet = (await res.text()).slice(0, 800);
    }
  } catch {}
});

async function visit(url) {
  console.log(`\n→ ${url}`);
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);
  } catch {
    try { await page.waitForTimeout(1000); } catch {}
  }
  return page.url();
}

// 1. Verify session
const home = await visit(`${BASE_URL}/secure/home.xhtml`);
if (!home.includes('utn.bo5w.com') || home.endsWith('/')) {
  console.error('✗ Session expired.'); await browser.close(); process.exit(1);
}
console.log('✓ Session OK');

// 2. Visit each promo page; try to open create/add modal
for (const p of PROMO_PAGES) {
  const landed = await visit(BASE_URL + p);
  console.log(`  landed: ${landed}`);

  // Grab page title / heading to confirm what we're looking at
  const heading = await page.evaluate(() => {
    const h = document.querySelector('h1,h2,h3,.page-title,.panel-title,.tile-header');
    return h ? h.innerText.trim() : '';
  });
  if (heading) console.log(`  heading: "${heading}"`);

  // Try clicking Add/Create/New button to expose POST shape
  for (const sel of ['a.btn:has-text("Add")', 'button:has-text("Add")', 'a:has-text("Add New")',
                       'button:has-text("Create")', 'a.btn:has-text("New")', 'input[value="Add"]',
                       'a[href*="create"]', 'a[href*="add"]']) {
    const btn = await page.$(sel);
    if (btn) {
      try {
        await btn.click();
        await page.waitForTimeout(2000);
        console.log(`  ↳ clicked add/create`);
        // Close modal
        for (const closesel of ['button:has-text("Close")', 'button:has-text("Cancel")', '.modal .close', '[data-dismiss="modal"]']) {
          const close = await page.$(closesel);
          if (close) { await close.click(); await page.waitForTimeout(500); break; }
        }
      } catch {}
      break;
    }
  }

  // Try clicking first row to see detail/edit request
  const firstRow = await page.$('table tbody tr:first-child td:first-child a, table tbody tr:first-child .btn-edit, table tbody tr:first-child button');
  if (firstRow) {
    try {
      await firstRow.click();
      await page.waitForTimeout(2000);
      console.log(`  ↳ clicked first row`);
      for (const closesel of ['button:has-text("Close")', 'button:has-text("Cancel")', '.modal .close', '[data-dismiss="modal"]']) {
        const close = await page.$(closesel);
        if (close) { await close.click(); await page.waitForTimeout(500); break; }
      }
    } catch {}
  }
}

// 3. For promo.setting.list — also try to read the page HTML for field clues
const cookie = session.cookies.map(c => `${c.name}=${c.value}`).join('; ');
const promoHtml = await fetch(`${BASE_URL}/secure/promotion/promo.setting.list.xhtml`, {
  headers: { cookie }
}).then(r => r.text()).catch(() => '');
const formFields = [...promoHtml.matchAll(/name=["']([^"']+)["']/g)].map(m => m[1]);
const ajaxUrls   = [...promoHtml.matchAll(/['"]\/ajax\/([^'"?]+)/g)].map(m => '/ajax/' + m[1]);
const ajaxUrls2  = [...promoHtml.matchAll(/url\s*:\s*['"]([^'"]+ajax[^'"]+)/g)].map(m => m[1]);
console.log('\n── promo.setting.list.xhtml form fields:', [...new Set(formFields)].join(', '));
console.log('── promo.setting.list.xhtml ajax refs:', [...new Set([...ajaxUrls, ...ajaxUrls2])].join(', '));

// 4. Also fetch promo page JS to find all ajax routes
const wsMain = await fetch(`${BASE_URL}/js/ws.js`, { headers: { cookie } }).then(r => r.text()).catch(() => '');
const wsPromo = await fetch(`${BASE_URL}/js/ws.process.js`, { headers: { cookie } }).then(r => r.text()).catch(() => '');
const allAjax = [...new Set([
  ...[...wsMain.matchAll(/['"]\/ajax\/[^'"]+/g)].map(m => m[0].replace(/['"]/g, '')),
  ...[...wsPromo.matchAll(/['"]\/ajax\/[^'"]+/g)].map(m => m[0].replace(/['"]/g, '')),
  ...[...promoHtml.matchAll(/\/ajax\/[^'"&\s]+/g)].map(m => m[0]),
])].sort();
console.log('\n── All /ajax/ routes found in JS/HTML:');
allAjax.forEach(a => console.log(' ', a));

// 5. Deduplicate captured requests
const seen = new Set();
const unique = captured.filter(c => {
  const cleanPath = c.path.replace(/;jsessionid=[^?&]*/i, '');
  const key = `${c.method}:${cleanPath}`;
  if (seen.has(key)) return false;
  seen.add(key); return true;
});

// 6. Print grouped endpoint map
console.log('\n\n════════════════════════════════════════');
console.log('GM01 (CMM ACE) — PROMO API ENDPOINTS');
console.log('════════════════════════════════════════');
const groups = {};
for (const e of unique) {
  const cleanPath = e.path.replace(/;jsessionid=[^?&]*/i, '');
  const seg = cleanPath.split('/')[2] || 'root';
  (groups[seg] = groups[seg] || []).push({ ...e, cleanPath });
}
for (const [group, entries] of Object.entries(groups).sort()) {
  console.log(`\n[${group}]`);
  for (const e of entries) {
    console.log(`  ${e.method.padEnd(6)} ${e.cleanPath}  (${e.status ?? '?'})`);
    if (e.postData) console.log(`         POST: ${e.postData.slice(0, 200)}`);
    if (e.responseSnippet) console.log(`         ← ${e.responseSnippet.slice(0, 200)}`);
  }
}

// 7. Save
mkdirSync(path.dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify({ capturedAt: new Date().toISOString(), ajaxRoutes: allAjax, visitedPages: PROMO_PAGES, endpoints: unique }, null, 2));
console.log(`\n✓ Saved → ${OUT_FILE}`);

await browser.close();
