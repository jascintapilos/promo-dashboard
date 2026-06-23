// Probe: capture the GET /api/bo/popups response that populates the
// kt-dropdown's items list, so we can see what fields the BO sends and
// figure out how items get the `<promo_code> - <label>` display format.
//
//   node src/browser/dialog-popup-list-probe.js qpro11

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSite } from '../sites.js';

const siteId = process.argv[2] || 'qpro11';
const site = getSite(siteId);
const OUT = path.resolve('captures');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: false, channel: 'chrome', slowMo: 30, args: ['--start-maximized'] });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();

const apiCalls = [];
page.on('response', async (resp) => {
  const req = resp.request();
  const url = resp.url();
  if (!/\/api\/bo\//i.test(url)) return;
  try { apiCalls.push({ method: req.method(), url, status: resp.status(), body: (await resp.text()).slice(0, 80000) }); } catch {}
});

await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
await page.locator('button:has-text("Login")').click();
await page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });

// Navigate to promotion edit page that we KNOW is in the system
// Just visit the promotion codes list — that triggers the popups GET
await page.goto(`${site.baseUrl}/general/promotion-codes`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(3000);

// Now open V13's promo Edit modal to trigger the dropdown's data fetch
await page.locator('input[formcontrolname="promotion"]').first().fill('TEST_VIP_30FC_5X_MB13');
await page.waitForTimeout(800);
await page.locator('button:has-text("Search")').first().click();
await page.waitForTimeout(2500);
await page.locator('tr:has-text("TEST_VIP_30FC_5X_MB13")').first().locator('a, button').first().click();
await page.waitForTimeout(3500);

// Open the Dialog Popup kt-dropdown to trigger any deferred fetch
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
await page.waitForTimeout(2500);

// Dump the first 5 li items as rendered in the open dropdown
const liItems = await page.evaluate(() => {
  const panels = Array.from(document.querySelectorAll('.dropdown-list')).filter((p) => p.offsetParent !== null);
  const panel = panels[panels.length - 1];
  if (!panel) return [];
  return Array.from(panel.querySelectorAll('li')).slice(0, 8).map((li) => ({
    text: (li.textContent || '').replace(/\s+/g, ' ').trim(),
    html: (li.innerHTML || '').slice(0, 600),
    attrs: Array.from(li.attributes).map((a) => `${a.name}="${a.value}"`).join(' '),
  }));
});
console.log('\n=== Dropdown LI items (first 8) ===');
liItems.forEach((it, i) => {
  console.log(`[${i}] text="${it.text.slice(0, 100)}"`);
  console.log(`     attrs: ${it.attrs}`);
  console.log(`     html: ${it.html.replace(/\s+/g, ' ').slice(0, 300)}`);
});

const popupsCall = apiCalls.findLast((c) => c.method === 'GET' && /\/api\/bo\/popups(\?|$)/.test(c.url));
if (popupsCall) {
  try {
    const json = JSON.parse(popupsCall.body);
    const rows = json?.data?.rows || json?.data || [];
    console.log(`\n=== GET /api/bo/popups: ${rows.length} rows ===`);
    if (rows.length > 0) {
      console.log('first row keys:', Object.keys(rows[0]));
      console.log('first row:', JSON.stringify(rows[0], null, 2).slice(0, 1500));
    }
    // Find the row with id=19 (V13 dialog)
    const v13 = rows.find((r) => r.id === 19);
    if (v13) {
      console.log('\n--- V13 dialog (id=19) row ---');
      console.log(JSON.stringify(v13, null, 2).slice(0, 1500));
    }
    await writeFile(path.join(OUT, `dialog-popup-list-probe-${siteId}.json`), JSON.stringify(json, null, 2));
  } catch (e) {
    console.log('parse error:', e.message);
    console.log('body slice:', popupsCall.body.slice(0, 2000));
  }
} else {
  console.log('No GET /api/bo/popups call seen. Calls:');
  apiCalls.forEach((c) => console.log(`  ${c.method} ${c.status} ${c.url.replace(/\?.*$/,'')}`));
}

await page.waitForTimeout(2500);
await ctx.close();
await browser.close();
