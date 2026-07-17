#!/usr/bin/env node
// GM01 session keep-alive daemon.
// Pings /ajax/common/chkLogin every few minutes to reset the server-side
// idle timer, keeping the JSESSIONID session alive far beyond its ~8h default.
// Updates capturedAt in gm01-session.local.json on each successful ping so
// downstream age-checks stay fresh.
//
// Usage:
//   node bin/gm01-keepalive.mjs                 # ping every 5 min (default)
//   node bin/gm01-keepalive.mjs --interval=10   # ping every 10 min
//   node bin/gm01-keepalive.mjs --once          # single ping then exit
//
// Run in the background (Windows):
//   start /b node bin/gm01-keepalive.mjs
// Or via Claude Code's run_in_background.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SESSION_FILE = path.join(ROOT, 'gm01-session.local.json');
const BASE = 'https://utn.bo5w.com';

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] ?? true;
}
const intervalMin = Number(args.interval) || 5;
const once = !!args.once;

function loadSession() {
  if (!existsSync(SESSION_FILE)) return null;
  try { return JSON.parse(readFileSync(SESSION_FILE, 'utf8')); } catch { return null; }
}

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

async function ping() {
  const session = loadSession();
  if (!session) { console.log(`[${ts()}] ✗ No session file — stopping.`); return false; }

  const cookie = session.cookies.map(c => `${c.name}=${c.value}`).join('; ');
  try {
    const res = await fetch(`${BASE}/ajax/common/chkLogin`, {
      headers: { Cookie: cookie }, redirect: 'manual',
    });
    const body = await res.text().catch(() => '');
    const alive = res.status === 200 && body.includes('success');

    if (alive) {
      // Refresh capturedAt so age-based checks treat the session as current
      session.capturedAt = new Date().toISOString();
      writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
      console.log(`[${ts()}] ✓ alive (chkLogin → ${body.trim()})`);
      return true;
    } else {
      console.log(`[${ts()}] ✗ session dead (status ${res.status}, body ${JSON.stringify(body.slice(0,60))}) — stopping.`);
      return false;
    }
  } catch (e) {
    console.log(`[${ts()}] ⚠ ping error: ${e.message} (will retry)`);
    return true; // transient network error — keep looping
  }
}

console.log(`[gm01-keepalive] Starting — ping every ${intervalMin} min. Ctrl+C to stop.`);

if (once) {
  await ping();
  process.exit(0);
}

// Loop
let running = true;
while (running) {
  running = await ping();
  if (!running) break;
  await new Promise(r => setTimeout(r, intervalMin * 60 * 1000));
}
console.log('[gm01-keepalive] Stopped — session expired. Re-capture with gm01-session-capture.mjs.');
process.exit(0);
