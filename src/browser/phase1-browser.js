// Phase 1 — drive the BO through the UI with Playwright.
// Logs in, sets the Merchant filter to a specific merchant, ensures
// Status=Active, clicks Search, sorts by ID desc, reads results from the
// network response.
//
//   node src/browser/phase1-browser.js [--site=<id>] <BRAND> [--limit=N] [--json]

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from '../../bin/_args.js';
import { getSite } from '../sites.js';

const OUT = path.resolve('captures');
const HEADLESS = process.env.HEADLESS !== 'false';

const { flags, positional } = parseArgs(process.argv.slice(2));
const merchantName = positional[0] || 'KING333';
const limit = Number(flags.limit) || 30;
const asJson = flags.json === true;
const site = getSite(flags.site);

async function setMultiselectFilter(page, labelText, optionText) {
  const row = page.locator(`.filter-row:has(label:text-is("${labelText}"))`).first();
  await row.waitFor({ timeout: 5000 });
  const trigger = row.locator('kt-dropdown-wo-lazyload .c-btn').first();
  await trigger.click();
  const opt = row.locator(`li.pure-checkbox label:text-is("${optionText}")`).first();
  await opt.waitFor({ timeout: 8000 });
  await opt.click();
  await page.waitForTimeout(300);
  await page.locator('body').click({ position: { x: 10, y: 10 } }).catch(() => {});
  const triggerText = (await trigger.textContent()) || '';
  if (!triggerText.includes(optionText)) {
    throw new Error(`failed to select ${labelText} ${optionText}; trigger reads "${triggerText.trim()}"`);
  }
}

async function setNativeStatus(page, label) {
  const select = page.locator('select[formcontrolname="status"]').first();
  await select.selectOption({ label });
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: HEADLESS });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await page.goto(site.baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.fill('input[placeholder*="user" i]', site.username);
  await page.fill('input[type="password"]', site.password);
  await page.keyboard.press('Enter');
  await page.waitForLoadState('networkidle').catch(() => {});

  await page.locator('button:has-text("Search")').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);

  await setMultiselectFilter(page, 'Merchant:', merchantName);
  await setNativeStatus(page, 'Active');

  const respPromise = page.waitForResponse(
    (r) => r.url().includes('/api/bo/promotion?') && r.status() === 200,
    { timeout: 20000 },
  );
  await page.locator('button:has-text("Search")').first().click();
  let lastResp = await respPromise.catch(() => null);

  const sortPromise = page.waitForResponse(
    (r) => r.url().includes('/api/bo/promotion?') && r.url().includes('sort_'),
    { timeout: 15000 },
  );
  const idHeader = page.locator('th:has-text("ID")').first();
  await idHeader.click().catch(() => {});
  await page.waitForTimeout(700);
  await idHeader.click().catch(() => {});
  lastResp = (await sortPromise.catch(() => null)) || lastResp;

  const json = lastResp ? await lastResp.json().catch(() => null) : null;
  const rows = (json?.data?.rows || []).slice(0, limit);
  const total = json?.data?.paginations?.total ?? rows.length;
  const pages = json?.data?.paginations?.last_page ?? 1;
  const apiUrl = lastResp?.url();

  await page.screenshot({ path: path.join(OUT, `${site.id}-${merchantName}-phase1.png`), fullPage: true });

  if (asJson) {
    console.log(JSON.stringify({ site: site.id, merchant: merchantName, total, returned: rows.length, pages, apiUrl, rows }, null, 2));
  } else {
    console.log(`Site: ${site.id}`);
    console.log(`Merchant: ${merchantName}`);
    console.log(`Active promotions: ${total} total, ${pages} page(s). Showing ${rows.length}, sorted by id desc.`);
    if (apiUrl) console.log(`Backed by: ${apiUrl}\n`); else console.log();
    console.log(['ID', 'Code', 'Name', 'Type', 'Valid From', 'Valid To'].join('\t'));
    for (const r of rows) {
      console.log([r.id, r.code, r.name, r.promo_type, r.valid_from ?? '', r.valid_to ?? ''].join('\t'));
    }
  }

  await ctx.close();
  await browser.close();
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
