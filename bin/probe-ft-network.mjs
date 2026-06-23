#!/usr/bin/env node
/**
 * Navigate the FastTrack CRM SPA with the saved session cookies,
 * intercept all XHR/fetch requests, and report API calls + auth headers.
 *
 * Usage:
 *   node bin/probe-ft-network.mjs --instance=ws1
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const INSTANCE = flags.instance || 'ws1';

const SESSION_FILE = path.resolve(`ft-session-${INSTANCE}.local.json`);
if (!existsSync(SESSION_FILE)) {
  console.error(`No session file. Run: node bin/capture-ft-session.mjs --instance=${INSTANCE}`);
  process.exit(1);
}

const session = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
const BASE    = session.loginUrl.replace(/\/$/, '');

console.log(`\nFastTrack network probe — ${session.label} (${BASE})`);
console.log('Replaying session cookies + intercepting API calls...\n');

const browser = await chromium.launch({ headless: false, channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

// Restore all saved cookies
if (session.cookies?.length) {
  await ctx.addCookies(session.cookies.filter(c => c.value));
  console.log(`Restored ${session.cookies.filter(c => c.value).length} cookies`);
}

const apiCalls = [];

// Intercept all requests — capture POST bodies for FT API calls
ctx.on('request', req => {
  const url = req.url();
  const method = req.method();
  const headers = req.headers();
  if (url.includes('ft-crm.com') && url.includes('/crm-api/') &&
      !url.endsWith('.js') && !url.endsWith('.css')) {
    const body = method === 'POST' ? req.postData() : null;
    apiCalls.push({ method, url, body });
    const authtoken = headers['authtoken'];
    if (method === 'POST' && body) {
      console.log(`  → ${method} ${url.replace('https://mb8.ft-crm.com','')}`);
      console.log(`     Body: ${body.slice(0, 200)}`);
    }
  }
});

ctx.on('response', async res => {
  const url = res.url();
  const status = res.status();
  if (url.includes('/api') && status !== 200 && !url.includes('google')) {
    console.log(`  ← ${status} ${url.slice(0, 100)}`);
  }
});

const page = await ctx.newPage();

// Navigate to the app
console.log(`\nNavigating to ${BASE}...`);
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForTimeout(3000);

console.log(`\nCurrent URL: ${page.url()}`);
console.log(`Page title: ${await page.title().catch(() => '?')}`);

// Navigate to activity detail / edit pages directly in SPA
const actId = 6741; // most recent 2026 WS1 activity
const spaBase = BASE;
const navPaths = [
  `/v2/activities`,
  `/v2/activity-manager`,
  `/v2/activity-builder/${actId}`,
  `/v2/activities/${actId}`,
  `/v2/activities/${actId}/edit`,
  `/v2/activities/edit/${actId}`,
];
for (const p of navPaths) {
  try {
    const fullUrl = `${spaBase}${p}`;
    console.log(`\nTrying: ${fullUrl}`);
    await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(3000);
    const currentUrl = page.url();
    console.log(`  URL after nav: ${currentUrl}`);
    if (!currentUrl.includes('no-permission')) {
      console.log('  *** Landed on real page! ***');
      await page.waitForTimeout(3000); // wait for more API calls
    }
  } catch { /* ignore */ }
}

// Wait for more intercepted calls to accumulate
await page.waitForTimeout(5000);

// Save captured calls
const outFile = path.resolve(`ft-api-calls-${INSTANCE}.json`);
writeFileSync(outFile, JSON.stringify(apiCalls, null, 2));
console.log(`\nSaved ${apiCalls.length} API calls → ${outFile}`);

// Print unique API endpoints
const unique = [...new Set(apiCalls.map(c => `${c.method} ${new URL(c.url).pathname}`))];
console.log('\n=== Unique endpoints intercepted ===');
unique.forEach(u => console.log(' ', u));

await browser.close();
