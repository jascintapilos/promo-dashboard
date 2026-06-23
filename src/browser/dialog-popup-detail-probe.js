// Probe: GET /api/bo/popups/<id> to see what fields the existing dialog
// popup has — specifically the current code (was it updated after POST?)
// and whether it has a back-reference to a promo.
//
//   node src/browser/dialog-popup-detail-probe.js qpro11 19

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSite } from '../sites.js';

const siteId = process.argv[2] || 'qpro11';
const popupId = process.argv[3] || '19';
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
  try { apiCalls.push({ method: req.method(), url, status: resp.status(), body: (await resp.text()).slice(0, 8000) }); } catch {}
});

await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.fill('input[formcontrolname="merchant_code"]', site.loginMerchantCode);
await page.fill('input[formcontrolname="username"]', site.username);
await page.fill('input[formcontrolname="password"]', site.password);
await page.locator('button:has-text("Login")').click();
await page.waitForResponse((r) => r.url().includes('/api/bo/login') && r.status() === 200, { timeout: 20000 });
console.log(`[login ok] ${siteId}`);

await page.goto(`${site.baseUrl}/settings/dialog`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2500);

// Find row containing popup id `popupId` and click Edit
const tableRows = await page.evaluate((id) => {
  const rows = Array.from(document.querySelectorAll('table tbody tr')).filter((r) => r.offsetParent !== null);
  for (const r of rows) {
    const cells = Array.from(r.querySelectorAll('td')).map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim());
    // First column is often ID
    if (cells[0] === String(id)) {
      const editBtn = r.querySelector('button, a, i.fa-edit, i.fa-pencil');
      if (editBtn) { (editBtn.closest('button, a') || editBtn).click(); return { ok: true, cells: cells.slice(0, 5) }; }
    }
  }
  return { ok: false };
}, popupId);
console.log('row click:', JSON.stringify(tableRows));
await page.waitForTimeout(3000);

const getCall = apiCalls.findLast((c) => c.method === 'GET' && /\/api\/bo\/popups\/\d/.test(c.url));
if (getCall) {
  try {
    const json = JSON.parse(getCall.body);
    const data = json?.data?.rows || json?.data || {};
    console.log('\n=== GET /api/bo/popups/<id> response ===');
    console.log('keys:', Object.keys(data));
    console.log('id:', data.id);
    console.log('code:', data.code);
    console.log('label:', data.label);
    console.log('status:', data.status);
    await writeFile(path.join(OUT, `dialog-popup-detail-probe-${siteId}-${popupId}.json`), JSON.stringify(json, null, 2));
  } catch (e) {
    console.log('Could not parse GET body:', e.message);
    console.log('body slice:', getCall.body.slice(0, 1000));
  }
} else {
  console.log('No GET /popups/<id> call seen. Calls:');
  apiCalls.forEach((c) => console.log(`  ${c.method} ${c.status} ${c.url.replace(/\?.*$/,'')}`));
}

await page.waitForTimeout(2500);
await ctx.close();
await browser.close();
