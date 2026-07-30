#!/usr/bin/env node
// Cache-header + BUILD_ID tests for QC Dashboard server.
// Runs a subprocess server with a fixed BUILD_ID and asserts:
// - HTML responses: no-cache, must-revalidate
// - Asset with correct ?v=BUILD_ID: public, max-age, immutable
// - Asset with wrong ?v: no-cache, must-revalidate
// - Asset with missing ?v: no-cache, must-revalidate
// - HTML content is fully substituted (no literal __BUILD__)
// - All asset refs inside HTML share the same BUILD_ID
//
// Run: node test/qc-dashboard-cache.test.mjs

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const PORT = 4398;
const BASE = `http://127.0.0.1:${PORT}`;
const BUILD_ID = 'test-build-a1b2c3.d4';

const server = spawn(process.execPath, ['bin/qc-dashboard.mjs'], {
  env: { ...process.env, PORT: String(PORT), AUTH_MODE: 'dev', DEV_USER_EMAIL: 'test@localhost', BUILD_ID },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
server.stderr.on('data', (d) => (stderr += d.toString()));

async function waitReady() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/api/config`);
      if (r.ok) return;
    } catch {}
    await sleep(150);
  }
  throw new Error(`Server not ready. stderr:\n${stderr}`);
}

async function login() {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  return r.headers.get('set-cookie').split(';')[0];
}

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

// ── HTML always revalidates ──────────────────────────────────────────────
test('/ HTML → Cache-Control: no-cache, must-revalidate', async () => {
  const r = await fetch(`${BASE}/`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-cache, must-revalidate');
});

test('/dashboard HTML (authenticated) → Cache-Control: no-cache, must-revalidate', async () => {
  const cookie = await login();
  const r = await fetch(`${BASE}/dashboard`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-cache, must-revalidate');
});

// ── HTML __BUILD__ substitution ──────────────────────────────────────────
test('/ HTML has all __BUILD__ markers replaced with BUILD_ID', async () => {
  const body = await fetch(`${BASE}/`).then((r) => r.text());
  assert.doesNotMatch(body, /__BUILD__/, 'literal __BUILD__ marker leaked into response');
  assert.match(body, new RegExp(`\\?v=${BUILD_ID}`), `expected ?v=${BUILD_ID} in HTML`);
});

test('/ HTML: all asset refs share exactly one ?v value', async () => {
  const body = await fetch(`${BASE}/`).then((r) => r.text());
  const versions = [...body.matchAll(/\?v=([A-Za-z0-9._-]+)/g)].map((m) => m[1]);
  assert.ok(versions.length >= 2, `expected at least 2 versioned asset refs, got ${versions.length}`);
  const unique = new Set(versions);
  assert.equal(unique.size, 1, `expected all asset refs to share one BUILD_ID, got: ${[...unique].join(', ')}`);
  assert.equal(versions[0], BUILD_ID);
});

test('/dashboard HTML has all __BUILD__ markers replaced', async () => {
  const cookie = await login();
  const body = await fetch(`${BASE}/dashboard`, { headers: { cookie } }).then((r) => r.text());
  assert.doesNotMatch(body, /__BUILD__/);
  assert.match(body, new RegExp(`\\?v=${BUILD_ID}`));
});

// ── Asset caching: matching ?v ───────────────────────────────────────────
test('/app.js?v=<correct BUILD_ID> → immutable long-cache', async () => {
  const r = await fetch(`${BASE}/app.js?v=${BUILD_ID}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'public, max-age=31536000, immutable');
});

test('/styles.css?v=<correct> → immutable long-cache', async () => {
  const r = await fetch(`${BASE}/styles.css?v=${BUILD_ID}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'public, max-age=31536000, immutable');
});

test('/dashboard-switcher.css?v=<correct> → immutable long-cache', async () => {
  const r = await fetch(`${BASE}/dashboard-switcher.css?v=${BUILD_ID}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'public, max-age=31536000, immutable');
});

// ── Asset caching: missing ?v ────────────────────────────────────────────
test('/app.js with no ?v → no-cache, must-revalidate', async () => {
  const r = await fetch(`${BASE}/app.js`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-cache, must-revalidate');
});

test('/dashboard-switcher.css with no ?v → no-cache, must-revalidate', async () => {
  const r = await fetch(`${BASE}/dashboard-switcher.css`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-cache, must-revalidate');
});

// ── Asset caching: stale ?v (mismatch) ───────────────────────────────────
test('/app.js?v=<stale-different> → no-cache, must-revalidate', async () => {
  const r = await fetch(`${BASE}/app.js?v=stale-old-build-xyz`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-cache, must-revalidate');
});

test('/styles.css?v=<stale-different> → no-cache, must-revalidate', async () => {
  const r = await fetch(`${BASE}/styles.css?v=nope`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-cache, must-revalidate');
});

// ── Runner ───────────────────────────────────────────────────────────────
(async () => {
  try {
    await waitReady();
    let passed = 0;
    let failed = 0;
    for (const { name, fn } of cases) {
      try {
        await fn();
        console.log(`  ok ${name}`);
        passed++;
      } catch (e) {
        console.log(`FAIL ${name}\n     ${e.message}`);
        failed++;
      }
    }
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed === 0 ? 0 : 1;
  } finally {
    server.kill();
  }
})();
