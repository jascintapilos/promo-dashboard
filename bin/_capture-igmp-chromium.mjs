// One-off launcher: uses bundled Chromium (not channel:chrome) so it
// spawns a clean separate window that doesn't clash with the user's
// existing Chrome session. Same cookie-store shape as
// bin/igmp-session-capture.mjs.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const siteId = process.argv[2] || 'ws1-v3-my';
const loginUrl = siteId === 'ws1-v3-sg'
  ? 'https://kiosksg.best-in-asia.com/Login#PM'
  : 'https://kioskmy.best-in-asia.com/Login#PM';

console.error(`[capture] target: ${siteId} (${loginUrl})`);
console.error(`[capture] launching bundled Chromium (no channel:chrome)…`);

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(loginUrl);
console.error(`[capture] window open — log in, then close it.`);

await new Promise((resolve) => browser.on('disconnected', resolve));

let cookies = [];
try { cookies = await ctx.cookies(); } catch {}
if (!cookies.length) { console.error('[capture] no cookies'); process.exit(3); }

const cookieHeader = cookies
  .filter((c) => c.domain && c.name && c.value)
  .map((c) => `${c.name}=${c.value}`)
  .join('; ');

const COOKIE_FILE = path.resolve('igmp-sessions.local.json');
const store = existsSync(COOKIE_FILE)
  ? JSON.parse(readFileSync(COOKIE_FILE, 'utf8'))
  : { sessions: {} };
store.sessions = store.sessions || {};
store.sessions[siteId] = { cookie: cookieHeader, capturedAt: new Date().toISOString() };
writeFileSync(COOKIE_FILE, JSON.stringify(store, null, 2));
console.error(`[capture] saved ${siteId} cookie (len=${cookieHeader.length})`);
