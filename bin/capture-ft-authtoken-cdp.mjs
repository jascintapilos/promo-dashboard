#!/usr/bin/env node
/**
 * Connect to AdsPower SunBrowser via CDP and intercept a real FT CRM API request
 * to capture the exact authtoken header the app sends.
 * Does NOT navigate or reload — just listens for the next organic API call.
 *
 * Usage: node bin/capture-ft-authtoken-cdp.mjs [--instance=ws1] [--timeout=30]
 */
import { chromium } from 'playwright';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const INSTANCE   = flags.instance || 'ws1';
const TIMEOUT_S  = parseInt(flags.timeout || '60', 10);
const TRIGGER    = flags.trigger !== 'false'; // trigger a harmless API call if needed

const INSTANCES = {
  ws1:   { host: 'mb8.ft-crm.com',            url: 'https://mb8.ft-crm.com/', label: 'WS1' },
  qpro1: { host: 'alpha-iota-qp1.ft-crm.com', url: 'https://alpha-iota-qp1.ft-crm.com/', label: 'QPRO1' },
  qp2:   { host: 'alpha-iota-qp2.ft-crm.com', url: 'https://alpha-iota-qp2.ft-crm.com/', label: 'QP2' },
};

const { host, url, label } = INSTANCES[INSTANCE] || {};
if (!host) { console.error('Unknown instance:', INSTANCE); process.exit(1); }

const CDP_PORT     = 53845;
const CDP_FALLBACK = 'ws://127.0.0.1:53845/devtools/browser/f002fadf-3a94-42f2-bf35-e9dde1d58e74';

async function getCdpWsUrl() {
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { webSocketDebuggerUrl } = await res.json();
    if (webSocketDebuggerUrl) return webSocketDebuggerUrl;
  } catch (e) {
    console.warn(`  CDP version probe failed (${e.message}) — using fallback GUID`);
  }
  return CDP_FALLBACK;
}

console.log('Probing SunBrowser CDP…');
const cdpWs = await getCdpWsUrl();
const browser = await chromium.connectOverCDP(cdpWs);
console.log('Connected.');

const ftPage = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes(host));

if (!ftPage) {
  console.error(`No open FT page found for ${host}`);
  console.error('Open pages:', pages.map(p => p.url()).join(', ') || '(none)');
  await browser.close().catch(() => {});
  process.exit(1);
}

console.log(`FT page: ${ftPage.url()}`);
if (ftPage.url().includes('/login')) {
  console.error('FT page is on login page — please log in first.');
  await browser.close().catch(() => {});
  process.exit(1);
}

console.log(`Listening for /crm-api/ requests (timeout ${TIMEOUT_S}s)…`);

let captured = null;
const deadline = Date.now() + TIMEOUT_S * 1000;

// Listen for outgoing requests
ftPage.on('request', req => {
  if (req.url().includes('/crm-api/') && !captured) {
    const hdrs = req.headers();
    const auth = hdrs['authtoken'] || hdrs['Authtoken'] || null;
    if (auth) {
      captured = { url: req.url(), authtoken: auth };
      console.log(`\nCaptured request to: ${req.url().replace('https://' + host, '')}`);
    }
  }
});

// Trigger a benign API call by eval-ing a fetch inside the page
// (uses the app's own session — browser sends all cookies automatically)
if (TRIGGER) {
  console.log('Triggering a minimal API call (unleash feature flags)…');
  ftPage.evaluate(() => {
    const ls = localStorage.getItem('jwttoken');
    if (ls) {
      fetch('/crm-api/Authentication/AdminUsers', {
        headers: { authtoken: ls, Accept: 'application/json' }
      }).catch(() => {});
    }
  }).catch(() => {});
}

// Also try to read the jwttoken length/signature via CDP to verify it changed
const jwtInfo = await ftPage.evaluate(() => {
  const v = localStorage.getItem('jwttoken') || '';
  // Decode JWT payload (middle segment) to check expiry — never returns the raw token
  try {
    const parts = v.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));
      return { length: v.length, exp: payload.exp, iat: payload.iat, sub: payload.sub, role: payload.role };
    }
  } catch(_) {}
  return { length: v.length };
}).catch(() => ({ length: 0 }));

console.log(`\njwttoken info (from JWT payload decode):`);
console.log(`  length: ${jwtInfo.length}`);
if (jwtInfo.exp) {
  console.log(`  exp:    ${new Date(jwtInfo.exp * 1000).toISOString()} (${jwtInfo.exp > Date.now()/1000 ? 'VALID' : 'EXPIRED'})`);
  console.log(`  iat:    ${new Date(jwtInfo.iat * 1000).toISOString()}`);
  console.log(`  sub:    ${jwtInfo.sub}`);
  console.log(`  role:   ${jwtInfo.role}`);
}

// Wait for captured authtoken
while (!captured && Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 500));
}

if (!captured) {
  console.log('\nNo /crm-api/ requests captured within timeout.');
  console.log('The FT app may not be making API calls right now.');
} else {
  console.log(`authtoken prefix: ${captured.authtoken.slice(0, 12)}…`);
  console.log(`authtoken length: ${captured.authtoken.length}`);

  // Save to session file
  const SESSION_FILE = path.resolve(`ft-session-${INSTANCE}.local.json`);
  const existing = existsSync(SESSION_FILE) ? JSON.parse(readFileSync(SESSION_FILE, 'utf8')) : {};
  const store = {
    ...existing,
    instance:   INSTANCE,
    label,
    loginUrl:   url,
    tokenKey:   'intercepted:authtoken',
    token:      captured.authtoken,
    capturedAt: new Date().toISOString(),
  };
  writeFileSync(SESSION_FILE, JSON.stringify(store, null, 2));
  console.log(`\nSaved → ${SESSION_FILE}`);
}

await browser.close().catch(() => {});
