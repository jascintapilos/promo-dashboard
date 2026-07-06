#!/usr/bin/env node
// One-off (Slack C03LF5QH5F0 / p1783101685135169): member SMS shows
// "Time Limited Exclusive Offer - 45% Reload Bonus" on WS1 MYR.
// Probe the WS1 MY BO via Playwright for promo names matching that SMS
// so the team can identify which promo code it belongs to.
//
//   node bin/_probe-ws1-tleo-name-match.mjs [--site=ws1-v3-my] [--headed]
//
// Reuses cookies from igmp-sessions.local.json; if the session is stale,
// auto-relogs via the /Login form using igmp-creds.local.json and saves
// the refreshed cookies back to the store.

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const COOKIE_FILE = path.resolve('igmp-sessions.local.json');
const CREDS_FILE = path.resolve('igmp-creds.local.json');

const BASE_URLS = {
  'ws1-v3-my': 'https://kioskmy.best-in-asia.com',
  'ws1-v3-sg': 'https://kiosksg.best-in-asia.com',
  'ws1-v3-id': 'https://kioskid.best-in-asia.com',
  'ws1-v3-th': 'https://kioskth.best-in-asia.com',
  'ws1-v3-kh': 'https://kioskkh.best-in-asia.com',
  'ws2': 'https://ws2-kioskmy.best-in-asia.com',
};

const TARGET_NAME = 'Time Limited Exclusive Offer - 45% Reload Bonus';

const args = process.argv.slice(2);
const siteId = (args.find((a) => a.startsWith('--site=')) || '--site=ws1-v3-my').split('=')[1];
const headed = args.includes('--headed');
const baseUrl = BASE_URLS[siteId];
if (!baseUrl) {
  console.error(`unknown site "${siteId}" — known: ${Object.keys(BASE_URLS).join(', ')}`);
  process.exit(2);
}

const store = existsSync(COOKIE_FILE) ? JSON.parse(readFileSync(COOKIE_FILE, 'utf8')) : { sessions: {} };
const saved = store.sessions?.[siteId];

const browser = await chromium.launch({ headless: !headed, channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
if (saved?.cookies?.length) {
  await ctx.addCookies(saved.cookies.filter((c) => c.name && c.value && c.domain));
  console.error(`[probe] loaded ${saved.cookies.length} cookies (captured ${saved.capturedAt})`);
}

async function listPage(pageNum) {
  const res = await ctx.request.post(`${baseUrl}/PM/GetPromotionsList?pageNum=${pageNum}&rowPerPage=200`, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json, text/plain, */*' },
    data: { PromotionCode: '', PromotionName: '', PromotionType: 0, IsActive: '', IsPublished: '' },
  });
  const text = await res.text();
  if (!res.ok()) throw new Error(`HTTP ${res.status()} on page ${pageNum}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return null; } // HTML → stale session
}

async function relogin() {
  const creds = JSON.parse(readFileSync(CREDS_FILE, 'utf8'));
  const { username, password } = creds.overrides?.[siteId] || creds.default;
  console.error(`[probe] session stale — re-logging in as ${username}…`);
  const page = await ctx.newPage();
  await page.goto(`${baseUrl}/Login#PM`);
  await page.waitForSelector('input[type="text"], input[id*="user" i]', { timeout: 15000 });
  await page.fill('input[name="txtUserID"], input[id="txtUserID"], input[placeholder*="sername"], input[type="text"]', username);
  await page.fill('input[name="txtPassword"], input[id="txtPassword"], input[placeholder*="assword"], input[type="password"]', password);
  await page.click('button[type="submit"], input[type="submit"], button:has-text("Login"), a:has-text("Login")');
  await page.waitForURL((url) => !url.href.includes('/Login'), { timeout: 20000 });
  await page.waitForTimeout(1500);
  const cookies = await ctx.cookies();
  store.sessions = store.sessions || {};
  store.sessions[siteId] = {
    capturedAt: new Date().toISOString(),
    cookieHeader: cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    cookies,
  };
  writeFileSync(COOKIE_FILE, JSON.stringify(store, null, 2));
  console.error(`[probe] re-login OK — ${cookies.length} cookies saved back to store`);
  await page.close();
}

// Validate session; relogin once if the response isn't JSON.
let first = await listPage(1);
if (!first || !Array.isArray(first.data)) {
  await relogin();
  first = await listPage(1);
  if (!first || !Array.isArray(first.data)) {
    console.error('[probe] still no JSON after re-login — aborting');
    await browser.close();
    process.exit(3);
  }
}

const all = [...first.data];
for (let pg = 2; pg <= 40; pg++) {
  if (first.data.length < 200 && pg === 2 && all.length >= (first.recordsFiltered ?? all.length)) break;
  const r = await listPage(pg);
  const rows = r?.data || [];
  if (!rows.length) break;
  all.push(...rows);
  if (rows.length < 200) break;
}
console.error(`[probe] fetched ${all.length} Type-0 promos from ${siteId}`);

const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const target = norm(TARGET_NAME);

function score(p) {
  const name = norm(p.PromotionName);
  const code = (p.PromotionCode || '').toUpperCase();
  if (name === target) return 100;
  let s = 0;
  if (name.includes('time limited')) s += 30;
  if (name.includes('exclusive offer') || name.includes('exclusive')) s += 20;
  if (/\b45\s*%|45pct|45 pct/.test(name)) s += 30;
  if (name.includes('reload')) s += 15;
  if (/TLEO/.test(code)) s += 25;
  if (/45/.test(code)) s += 15;
  return s;
}

const scored = all
  .map((p) => ({ p, s: score(p) }))
  .filter((x) => x.s >= 40)
  .sort((a, b) => b.s - a.s);

console.log(`\nTarget SMS promo name: "${TARGET_NAME}"`);
console.log(`Site: ${siteId} — ${all.length} promos scanned\n`);
if (!scored.length) {
  console.log('No similar promo names found (score >= 40).');
} else {
  console.log(`${scored.length} candidate match(es):\n`);
  for (const { p, s } of scored) {
    console.log(`  score=${s}  id=${p.PromotionId}  code=${p.PromotionCode}`);
    console.log(`     name="${p.PromotionName}"`);
    console.log(`     active=${p.IsActive}  published=${p.IsPublished}  start=${p.PromotionStartDate ?? '-'}\n`);
  }
}

// Also show every TLEO-coded promo for completeness (the known SMS family).
const tleo = all.filter((p) => /TLEO/i.test(p.PromotionCode || ''));
console.log(`All TLEO-coded promos on ${siteId}: ${tleo.length}`);
for (const p of tleo) {
  console.log(`  id=${p.PromotionId}  code=${p.PromotionCode}  active=${p.IsActive}  name="${p.PromotionName}"`);
}

await browser.close();
