// Probe: search the BO templates list for the EXACT colliding codes from
// our 422 errors, and also search for any short-id-format codes (I22-*).
// Also: try saving a fresh template with completely different name and see
// if the BO returns the same collision hash. That tells us whether the
// hash is deterministic on our inputs or based on something else.

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
console.log('[login] ok');

await page.goto(`${site.baseUrl}/superuser/message-template`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(3000);

// Hashes we've seen from the 422 errors. The user reports these aren't
// real templates — verify by searching for each.
const hashes = ['fa7ec721', '6e053544', 'af75dc57', '4a566b99', '7cce37f3', '19c72dad', '4d29c1ac', 'I22-'];
const results = {};
for (const h of hashes) {
  console.log(`\n--- Searching for "${h}" ---`);
  try {
    const codeInput = page.locator('input[formcontrolname="code"]').first();
    await codeInput.fill('');
    await codeInput.fill(h);
    const resp = page.waitForResponse((r) => r.url().includes('/api/bo/messagetemplate') && r.status() < 400, { timeout: 15000 }).catch(() => null);
    await page.locator('button:has-text("Search")').first().click();
    await resp;
    await page.waitForTimeout(2000);
    const rows = await page.evaluate(() => {
      const trs = Array.from(document.querySelectorAll('tbody tr')).filter((r) => r.offsetParent !== null);
      return trs.slice(0, 10).map((r) => Array.from(r.querySelectorAll('td')).map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)));
    });
    results[h] = rows;
    console.log(`  ${rows.length} rows:`);
    for (const r of rows.slice(0, 3)) console.log(`    ${r.join(' | ')}`);
  } catch (e) {
    console.log(`  err: ${e.message.split('\n')[0]}`);
    results[h] = { error: e.message };
  }
}

// Also check direct API for any "I22" code template
console.log('\n--- Direct API: ANY template with code starting with "I22-" ---');
const apiResp = await page.evaluate(async () => {
  try {
    const r = await fetch('/api/bo/messagetemplate?code=I22&page=1&per_page=20', { credentials: 'include' });
    return { status: r.status, body: (await r.text()).slice(0, 3000) };
  } catch (e) { return { error: e.message }; }
});
console.log('  status:', apiResp.status);
console.log('  body:', apiResp.body);

await writeFile(path.join(OUT, 'qp2-find-colliding-code.json'), JSON.stringify({ results, apiResp }, null, 2));

await page.waitForTimeout(3000);
await ctx.close();
await browser.close();
