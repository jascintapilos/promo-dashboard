#!/usr/bin/env node
// Route tests for QC Dashboard server — routing behavior only.
// Does NOT test OAuth flows (dev mode bypasses those); those require a live
// production-mode run against the deployed environment.
//
// Run with: node test/qc-dashboard-routes.test.mjs

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const PORT = 4399;
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, ['bin/qc-dashboard.mjs'], {
  env: { ...process.env, PORT: String(PORT), AUTH_MODE: 'dev', DEV_USER_EMAIL: 'test@localhost' },
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

async function fetchNoRedirect(path, opts = {}) {
  return fetch(`${BASE}${path}`, { redirect: 'manual', ...opts });
}

async function login() {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(r.status, 200, 'dev login should succeed');
  const cookie = r.headers.get('set-cookie');
  assert.ok(cookie && cookie.includes('qc_hub_session='), 'login must set session cookie');
  return cookie.split(';')[0];
}

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

// ── Route behavior ─────────────────────────────────────────────────────────
test('unauthenticated /dashboard → 302 to /?return=%2Fdashboard', async () => {
  const r = await fetchNoRedirect('/dashboard');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/?return=%2Fdashboard');
});

test('unauthenticated /dashboard.html → 301 to /dashboard (canonicalize)', async () => {
  const r = await fetchNoRedirect('/dashboard.html');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), '/dashboard');
});

test('unauthenticated /dashboard.html then /dashboard → still 302', async () => {
  const r1 = await fetchNoRedirect('/dashboard.html');
  assert.equal(r1.status, 301);
  const r2 = await fetchNoRedirect(r1.headers.get('location'));
  assert.equal(r2.status, 302);
  assert.equal(r2.headers.get('location'), '/?return=%2Fdashboard');
});

test('authenticated /dashboard → 200 with Ops Dashboard HTML', async () => {
  const cookie = await login();
  const r = await fetchNoRedirect('/dashboard', { headers: { cookie } });
  assert.equal(r.status, 200);
  const body = await r.text();
  assert.match(body, /Promo Team Operations/i);
});

test('unauthenticated /api/me → 401', async () => {
  const r = await fetchNoRedirect('/api/me');
  assert.equal(r.status, 401);
});

test('authenticated /api/me → 200', async () => {
  const cookie = await login();
  const r = await fetchNoRedirect('/api/me', { headers: { cookie } });
  assert.equal(r.status, 200);
});

test('unauthenticated /api/brands → 401', async () => {
  const r = await fetchNoRedirect('/api/brands');
  assert.equal(r.status, 401);
});

test('logout clears cookie + subsequent /dashboard blocked without cookie', async () => {
  const cookie = await login();
  const r = await fetchNoRedirect('/auth/logout', { method: 'POST', headers: { cookie } });
  assert.equal(r.status, 200);
  const setCookie = r.headers.get('set-cookie') || '';
  assert.match(setCookie, /qc_hub_session=;/);
  assert.match(setCookie, /Max-Age=0/i);
  // Simulate browser after cookie clear: subsequent /dashboard without cookie must 302 to login.
  const gated = await fetchNoRedirect('/dashboard');
  assert.equal(gated.status, 302);
  assert.equal(gated.headers.get('location'), '/?return=%2Fdashboard');
});

test('/api/config public (needs no session) and returns googleClientId + devMode', async () => {
  const r = await fetchNoRedirect('/api/config');
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(typeof body.googleClientId, 'string');
  assert.equal(body.devMode, true);
});

test('root / renders QC Hub SPA shell', async () => {
  const r = await fetchNoRedirect('/');
  assert.equal(r.status, 200);
  const body = await r.text();
  assert.match(body, /Promo QC Hub/);
});

test('unknown non-API path → falls through to SPA index (no leak)', async () => {
  const r = await fetchNoRedirect('/random-path-xyz');
  assert.equal(r.status, 200);
  const body = await r.text();
  // Should be the SPA shell (falls through to catch-all at end of handle())
  assert.match(body, /Promo QC Hub/);
});

// ── Runner ────────────────────────────────────────────────────────────────
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
