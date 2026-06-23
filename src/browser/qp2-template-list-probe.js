// Probe: navigate to QP2A's /superuser/message-template list and search for
// any of our TEST_QP2A_ template names. The BO's 422 says "code has been
// taken" but the operator reports the templates are NEVER created. Find
// out:
//   1. Do any TEST_QP2A_REL_50PCT templates exist?
//   2. If yes, which? Maybe one was saved and ALL subsequent attempts collide.
//   3. If no, the 422 is misleading and the BO is rejecting for a different
//      reason (e.g., uniqueness on section+type).

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

// Search for TEST_ template names. The list page typically has a search input.
const dump = await page.evaluate(() => {
  const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])')).filter((el) => el.offsetParent !== null);
  return {
    inputs: inputs.map((el) => ({
      fc: el.getAttribute('formcontrolname'),
      placeholder: el.placeholder,
      nearbyLabel: (() => {
        let p = el;
        for (let i = 0; i < 4 && p.parentElement; i++) {
          p = p.parentElement;
          const lbl = p.querySelector('label, span.kt-font-bold, .form-label');
          if (lbl && lbl !== el) return (lbl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        }
        return null;
      })(),
    })),
  };
});
console.log('[list page inputs]', JSON.stringify(dump, null, 2));

// Try to search. Use the first text input (typically a name search).
// Fall back if specific selectors not found.
try {
  // Search for "TEST_QP2A" prefix
  const nameInput = page.locator('input[formcontrolname="name"], input[formcontrolname="code"]').first();
  await nameInput.fill('TEST_QP2A');
  const resp = page.waitForResponse((r) => r.url().includes('/api/bo/messagetemplate') && r.status() < 400, { timeout: 15000 }).catch(() => null);
  await page.locator('button:has-text("Search")').first().click();
  await resp;
  await page.waitForTimeout(2500);
  console.log('[search] done, fetching rows');

  // Capture table rows
  const rows = await page.evaluate(() => {
    const trs = Array.from(document.querySelectorAll('tbody tr')).filter((r) => r.offsetParent !== null);
    return trs.slice(0, 30).map((r) => Array.from(r.querySelectorAll('td')).map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)));
  });
  console.log(`[results] ${rows.length} rows matching "TEST_QP2A":`);
  for (const r of rows) console.log(`  ${r.join(' | ')}`);

  // Also dump the response body of the search API for the full code info
  await writeFile(path.join(OUT, 'qp2-template-list-search.json'), JSON.stringify({ rows }, null, 2));
} catch (e) {
  console.log(`[search] err: ${e.message.split('\n')[0]}`);
}

// ALSO try API call directly — sometimes more info there.
console.log('\n[direct-api] fetching template list via /api/bo/messagetemplate');
const apiResp = await page.evaluate(async () => {
  try {
    const r = await fetch('/api/bo/messagetemplate?name=TEST_QP2A&page=1&per_page=50', { credentials: 'include' });
    return { status: r.status, body: (await r.text()).slice(0, 4000) };
  } catch (e) {
    return { error: e.message };
  }
});
console.log('[direct-api] status:', apiResp.status);
console.log('[direct-api] body:', apiResp.body);

await page.waitForTimeout(3000);
await ctx.close();
await browser.close();
