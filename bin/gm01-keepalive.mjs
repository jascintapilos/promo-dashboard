#!/usr/bin/env node
// GM01 session keep-alive daemon.
//
// Pings /ajax/common/chkLogin periodically to reset the server-side idle timer,
// keeping the saved session alive while this machine stays on. Uses the saved
// Playwright auth state (storageState) through an authenticated request context,
// so cookies are applied by the framework and never handled by hand. On session
// death it stops and tells you to re-authenticate. Nothing secret is printed.
//
// Usage:
//   node bin/gm01-keepalive.mjs                 # ping every 5 min (default)
//   node bin/gm01-keepalive.mjs --interval=10   # ping every 10 min
//   node bin/gm01-keepalive.mjs --once          # single ping then exit

import { BASE, openAuthedContext, hasSavedState } from '../src/gm01-session.js';

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] ?? true;
}
const intervalMin = Number(args.interval) || 5;
const once = !!args.once;

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

if (!hasSavedState()) {
  console.error('[gm01-keepalive] No saved session. Run: node bin/gm01-session-capture.mjs');
  process.exit(1);
}

const { browser, context } = await openAuthedContext({ headless: true });

async function ping() {
  try {
    const res = await context.request.get(`${BASE}/ajax/common/chkLogin`, {
      maxRedirects: 0,
      timeout: 15_000,
    });
    const body = await res.text().catch(() => '');
    const alive = res.status() === 200 && body.includes('success');
    if (alive) {
      console.log(`[${ts()}] ✓ alive`);
      return true;
    }
    console.log(`[${ts()}] ✗ session dead (status ${res.status()}) — stopping.`);
    return false;
  } catch (e) {
    console.log(`[${ts()}] ⚠ ping error: ${e.message} (will retry)`);
    return true; // transient — keep looping
  }
}

console.log(`[gm01-keepalive] Starting — ping every ${intervalMin} min. Ctrl+C to stop.`);

let running = true;
if (once) {
  await ping();
} else {
  while (running) {
    running = await ping();
    if (!running) break;
    await new Promise(r => setTimeout(r, intervalMin * 60 * 1000));
  }
  console.log('[gm01-keepalive] Stopped — re-capture with gm01-session-capture.mjs.');
}

await browser.close();
process.exit(0);
