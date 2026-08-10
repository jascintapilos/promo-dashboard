// Quick re-auth all IGMP sites — uses the working login flow from _igmp-login-debug.mjs.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { igmpBaseUrl, listIgmpSites } from '../src/igmp-client.js';

const user = process.argv[2] || process.env.IGMP_USER;
const pass = process.argv[3] || process.env.IGMP_PASS;
if (!user || !pass) {
  console.error('Usage: node _reauth-all.mjs <user> <pass>  (or set IGMP_USER/IGMP_PASS env vars)');
  process.exit(1);
}
const COOKIE_FILE = 'igmp-sessions.local.json';
const store = existsSync(COOKIE_FILE) ? JSON.parse(readFileSync(COOKIE_FILE, 'utf8')) : { sessions: {} };
store.sessions = store.sessions || {};

const browser = await chromium.launch({ headless: false, channel: 'chrome' });
for (const siteId of listIgmpSites()) {
  process.stdout.write(siteId + ' ... ');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(igmpBaseUrl(siteId) + '/Login#PM', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.fill('input#Username, input[name="Username"], input[type="text"]', user);
    await page.fill('input#Password, input[name="Password"], input[type="password"]', pass);
    await page.click('button:has-text("Login"), button[type="submit"]');
    await page.waitForTimeout(5000);
    const url = page.url();
    if (url.includes('/Login')) throw new Error('still on login page: ' + url);
    const cookies = await ctx.cookies();
    const cookieHeader = cookies.filter(c => c.name && c.value).map(c => c.name + '=' + c.value).join('; ');
    store.sessions[siteId] = { capturedAt: new Date().toISOString(), cookieHeader, cookies };
    writeFileSync(COOKIE_FILE, JSON.stringify(store, null, 2));
    console.log('OK (' + cookies.length + ' cookies)');
  } catch (e) {
    console.log('FAIL: ' + e.message.slice(0, 120));
  } finally {
    await ctx.close();
  }
}
await browser.close();
console.log('done.');
