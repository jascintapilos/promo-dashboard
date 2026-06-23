// Auto-login to all IGMP sites with given creds and save cookies to igmp-sessions.local.json.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { igmpBaseUrl, listIgmpSites } from '../src/igmp-client.js';

const user = process.argv[2] || 'promo_testbot';
const pass = process.argv[3] || '123456';
const COOKIE_FILE = path.resolve('igmp-sessions.local.json');
const store = existsSync(COOKIE_FILE) ? JSON.parse(readFileSync(COOKIE_FILE, 'utf8')) : { sessions: {} };
store.sessions = store.sessions || {};

const browser = await chromium.launch({ headless: false, channel: 'chrome' });
for (const siteId of listIgmpSites()) {
  process.stdout.write(`${siteId} … `);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${igmpBaseUrl(siteId)}/Login#PM`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input#Username, input[name="Username"], input[type="text"]', { timeout: 15000 });
    await page.fill('input#Username, input[name="Username"], input[type="text"]', user);
    await page.fill('input#Password, input[name="Password"], input[type="password"]', pass);
    await page.click('button:has-text("Login"), button[type="submit"], input[type="submit"]');
    await page.waitForURL((u) => !/\/Login/i.test(u.href), { timeout: 25000 });
    await page.waitForTimeout(1500);
    const cookies = await ctx.cookies();
    const cookieHeader = cookies.filter((c) => c.name && c.value).map((c) => `${c.name}=${c.value}`).join('; ');
    if (!cookieHeader) throw new Error('no cookies');
    store.sessions[siteId] = { capturedAt: new Date().toISOString(), cookieHeader, cookies };
    writeFileSync(COOKIE_FILE, JSON.stringify(store, null, 2));
    console.log(`OK (${cookies.length} cookies, url=${page.url()})`);
  } catch (e) {
    console.log(`FAIL: ${e.message.slice(0, 100)}`);
  } finally {
    await ctx.close();
  }
}
await browser.close();
console.log('done.');
