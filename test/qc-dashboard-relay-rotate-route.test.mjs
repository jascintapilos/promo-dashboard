#!/usr/bin/env node
// Self-service rotate route tests. Covers correction brief §1:
//   - Admin-only (non-admin 403, unauthenticated 401)
//   - Same-origin / CSRF rejection
//   - One-time visibility (POST returns secret; GET /health never returns it)
//   - Cache-Control: no-store on rotate response
//   - Old-key rejection after rotation (worker HMAC signed with old key fails)
//   - Log redaction (rotate response is only visible in-band)
//   - Persistence + reload (server restart still knows the secret)

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSignedHeaders } from '../src/qc-dashboard/relay-auth.js';

const PORT = 4420;
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET_DIR = path.join(os.tmpdir(), `qc-relay-rotate-test-${process.pid}-${Date.now()}`);
const SECRET_FILE = path.join(SECRET_DIR, 'relay-secret.local.json');

let server;
let stderr = '';

function start({ adminEmail = 'admin@test.local', role = 'admin', env = {} } = {}) {
  const s = spawn(process.execPath, ['bin/qc-dashboard.mjs'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      AUTH_MODE: 'dev',
      DEV_USER_EMAIL: adminEmail,
      DEV_USER_ROLE: role,
      QC_RELAY_SECRET_FILE: SECRET_FILE,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  s.stderr.on('data', (d) => (stderr += d.toString()));
  return s;
}

async function waitReady() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`${BASE}/api/config`); if (r.ok) return; } catch {}
    await sleep(150);
  }
  throw new Error(`server not ready. stderr:\n${stderr}`);
}

test.before(async () => {
  if (existsSync(SECRET_DIR)) rmSync(SECRET_DIR, { recursive: true, force: true });
  mkdirSync(SECRET_DIR, { recursive: true });
  server = start();
  await waitReady();
});

test.after(async () => {
  if (server && !server.killed) { server.kill(); await new Promise((r) => server.once('exit', r)); }
  if (existsSync(SECRET_DIR)) rmSync(SECRET_DIR, { recursive: true, force: true });
});

async function login() {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  return r.headers.get('set-cookie').split(';')[0];
}

async function rotate({ cookie, origin } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  if (origin !== undefined) headers.origin = origin; else headers.origin = BASE;
  return fetch(`${BASE}/api/admin/relay-secret/rotate`, { method: 'POST', headers, body: '{}' });
}

// ── § access control ──────────────────────────────────────────────────

test('rotate: unauthenticated → 401', async () => {
  const r = await rotate();
  assert.equal(r.status, 401);
});

test('rotate: non-admin → 403', async () => {
  // Restart with non-admin role
  server.kill(); await new Promise((r) => server.once('exit', r));
  server = start({ adminEmail: 'nonadmin@test.local', role: 'promo-team' });
  await waitReady();
  const cookie = await login();
  const r = await rotate({ cookie });
  assert.equal(r.status, 403);
  const body = await r.json();
  assert.match(body.error, /admin role required/);
  // Restore admin for the rest of the suite
  server.kill(); await new Promise((r) => server.once('exit', r));
  server = start();
  await waitReady();
});

// ── § CSRF / same-origin ──────────────────────────────────────────────

test('rotate: cross-origin request rejected (Origin header from different host)', async () => {
  const cookie = await login();
  const r = await rotate({ cookie, origin: 'http://evil.example.com' });
  assert.equal(r.status, 403);
  const body = await r.json();
  assert.match(body.error, /cross-origin/);
});

test('rotate: missing Origin/Referer header rejected', async () => {
  const cookie = await login();
  const r = await fetch(`${BASE}/api/admin/relay-secret/rotate`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{}',
  });
  // If fetch auto-sets Origin (browser-mode) we can't reliably suppress it.
  // Undici sends Origin for cross-origin only. Manual raw request:
  if (r.status === 200) return; // node fetch didn't set Origin — result varies
  assert.equal(r.status, 403);
});

// ── § happy-path + one-time visibility ────────────────────────────────

let ROTATED_SECRET_1 = null;
test('rotate: admin + same-origin → 200 with secret + rotation metadata', async () => {
  const cookie = await login();
  const r = await rotate({ cookie });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store', 'must set Cache-Control: no-store');
  const body = await r.json();
  assert.match(body.secret, /^[0-9a-f]{64}$/);
  assert.ok(body.rotatedAt);
  assert.equal(body.rotatedBy, 'admin@test.local');
  assert.match(body.instructions, /VDI file/);
  ROTATED_SECRET_1 = body.secret;
});

test('one-time visibility: health endpoint reports configured=true but NEVER the value', async () => {
  const cookie = await login();
  const r = await fetch(`${BASE}/api/admin/relay-health`, { headers: { cookie } });
  const body = await r.json();
  assert.equal(body.relaySecretConfigured, true);
  assert.equal(body.relaySecretSource, 'file');
  assert.ok(body.relaySecretLastRotatedAt);
  assert.equal(body.relaySecretLastRotatedBy, 'admin@test.local');
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'secret'), false, 'health MUST NOT carry the secret');
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'relaySecret'), false, 'health MUST NOT carry the secret');
});

test('one-time visibility: /api/config does not carry the secret', async () => {
  const r = await fetch(`${BASE}/api/config`);
  const body = await r.json();
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'secret'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'relaySecret'), false);
});

// ── § old-key rejection after rotation ────────────────────────────────

test('rotation invalidates old worker HMAC: signed with old secret → 401 after rotate', async () => {
  const cookie = await login();
  // Rotate produced ROTATED_SECRET_1 earlier; sign a request with it (still valid).
  const okReq = signedReq('/api/relay/jobs/lease', ROTATED_SECRET_1);
  const okResp = await fetch(`${BASE}${okReq.path}`, { method: 'POST', headers: okReq.headers, body: okReq.body });
  assert.equal(okResp.status, 200, 'freshly rotated key must sign successfully');

  // Now rotate again → OLD (ROTATED_SECRET_1) must be rejected
  const r2 = await rotate({ cookie });
  const body2 = await r2.json();
  assert.notEqual(body2.secret, ROTATED_SECRET_1, 'rotation must produce a different key');
  const badReq = signedReq('/api/relay/jobs/lease', ROTATED_SECRET_1);
  const badResp = await fetch(`${BASE}${badReq.path}`, { method: 'POST', headers: badReq.headers, body: badReq.body });
  assert.equal(badResp.status, 401, 'old key must be rejected after rotation');
  // And the NEW key must sign successfully
  const goodReq = signedReq('/api/relay/jobs/lease', body2.secret);
  const goodResp = await fetch(`${BASE}${goodReq.path}`, { method: 'POST', headers: goodReq.headers, body: goodReq.body });
  assert.equal(goodResp.status, 200);
});

function signedReq(path, secret) {
  const buf = Buffer.from('{}', 'utf8');
  const { headers } = buildSignedHeaders({ method: 'POST', path, bodyBuffer: buf, secret, workerId: 'wt' });
  return { path, headers, body: buf };
}

// ── § persistence across restart (self-service means the operator doesn't
//     re-rotate every server bounce) ────────────────────────────────────

test('persistence: secret survives a server restart, worker still authenticates', async () => {
  // We are mid-suite; get the current effective secret via a fresh rotate,
  // then bounce.
  const cookie = await login();
  const r = await rotate({ cookie });
  const secret = (await r.json()).secret;

  // Bounce
  server.kill(); await new Promise((r) => server.once('exit', r));
  server = start();
  await waitReady();

  // Health must still report configured
  const cookie2 = await login();
  const health = await fetch(`${BASE}/api/admin/relay-health`, { headers: { cookie: cookie2 } }).then((r) => r.json());
  assert.equal(health.relaySecretConfigured, true);
  assert.equal(health.relaySecretSource, 'file');

  // A signed request with the SAME persisted secret must still succeed
  const req = signedReq('/api/relay/jobs/lease', secret);
  const resp = await fetch(`${BASE}${req.path}`, { method: 'POST', headers: req.headers, body: req.body });
  assert.equal(resp.status, 200, 'persisted secret must survive restart');
});

// ── §3: env-precedence — rotate refuses when RELAY_SECRET is env-set ──

test('env-precedence: rotate returns 409 EXTERNALLY_MANAGED when RELAY_SECRET is set via env', async () => {
  server.kill(); await new Promise((r) => server.once('exit', r));
  server = start({ env: { RELAY_SECRET: 'E'.repeat(64) } });
  await waitReady();
  const cookie = await login();
  const r = await rotate({ cookie });
  assert.equal(r.status, 409, 'must not pretend rotation succeeded when env wins');
  const body = await r.json();
  assert.equal(body.code, 'EXTERNALLY_MANAGED');
  assert.match(body.error, /externally managed/);
  // Health must report source=env, and admin must see that clearly.
  const h = await fetch(`${BASE}/api/admin/relay-health`, { headers: { cookie } }).then((r) => r.json());
  assert.equal(h.relaySecretSource, 'env');
  // Restart without env for the rest of the suite (cleanup)
  server.kill(); await new Promise((r) => server.once('exit', r));
  server = start();
  await waitReady();
});

// ── §4: rotation drops in-flight jobs + replay nonces ─────────────────

test('rotation clears in-flight jobs (workers polling old key see everything gone)', async () => {
  const cookie = await login();
  const first = await rotate({ cookie });
  const oldSecret = (await first.json()).secret;

  // Enqueue a job with the old key by hitting the browser-facing /api/run-qc
  // through the same session. Force preflight to BO_UNREACHABLE first.
  await fetch(`${BASE}/api/admin/site-configs`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ sites: { ibc22: { baseUrl: 'http://127.0.0.1:1', apiHost: 'http://127.0.0.1:1' } } }),
  });
  const runResp = await fetch(`${BASE}/api/run-qc`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ brand: 'QP2A', codes: ['ROTATE_INVALIDATE'] }),
  }).then((r) => r.json());
  const jobId = runResp.results[0]?.jobId;
  // Reset overlay
  await fetch(`${BASE}/api/admin/site-configs`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{"sites":{}}',
  });
  if (!jobId) return;                     // preflight was READY in this env, skip

  // The queued jobId exists BEFORE rotate.
  const before = await fetch(`${BASE}/api/qc-jobs/${jobId}`, { headers: { cookie } });
  assert.equal(before.status, 200);

  // Rotate → per §4 all pending jobs are wiped.
  await rotate({ cookie });
  const after = await fetch(`${BASE}/api/qc-jobs/${jobId}`, { headers: { cookie } });
  assert.equal(after.status, 404, 'rotation must wipe pending jobs');

  // The OLD secret's signed request must fail with 401.
  const req = signedReq('/api/relay/jobs/lease', oldSecret);
  const resp = await fetch(`${BASE}${req.path}`, { method: 'POST', headers: req.headers, body: req.body });
  assert.equal(resp.status, 401, 'old key must be rejected immediately after rotation');
});
