#!/usr/bin/env node
// Blocker 1 fix: end-to-end route tests for the MANUAL_PASS override endpoint.
// These prove the HTTP layer rejects every crafted-body attack that could
// otherwise turn a NOT_SAFE / REVIEW / SAFE result into MANUAL_PASS.

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const PORT = 4402;
const BASE = `http://127.0.0.1:${PORT}`;

let server;
let stderr = '';

test.before(async () => {
  server = spawn(process.execPath, ['bin/qc-dashboard.mjs'], {
    env: { ...process.env, PORT: String(PORT), AUTH_MODE: 'dev', DEV_USER_EMAIL: 'test@localhost' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => (stderr += d.toString()));
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/api/config`);
      if (r.ok) return;
    } catch {}
    await sleep(150);
  }
  throw new Error(`Server not ready. stderr:\n${stderr}`);
});

test.after(() => {
  if (server && !server.killed) server.kill();
});

async function login() {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  return r.headers.get('set-cookie').split(';')[0];
}

async function runQc(cookie, brand, code, handle = null) {
  const r = await fetch(`${BASE}/api/run-qc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ brand, codes: [code], handle }),
  });
  return r.json();
}

async function tryOverride(cookie, body) {
  const r = await fetch(`${BASE}/api/qc-manual-pass-override`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}

const OK_REASON = 'BO 403 during batch; verified via BO screenshot attached below';
const OK_EVIDENCE = 'https://drive.example.com/screenshot.png';

test('route: unauthenticated override → 401', async () => {
  const r = await fetch(`${BASE}/api/qc-manual-pass-override`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(r.status, 401);
});

test('route: missing runId → 400', async () => {
  const cookie = await login();
  const r = await tryOverride(cookie, {
    brand: 'QP2A', code: 'X', reason: OK_REASON, evidence: OK_EVIDENCE,
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /runId is required/);
});

test('route: attack — cannot invent a runId that was never issued', async () => {
  const cookie = await login();
  const r = await tryOverride(cookie, {
    brand: 'QP2A', code: 'X', runId: 'qc_forgedRunId12',
    reason: OK_REASON, evidence: OK_EVIDENCE,
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /runId does not match any recent/);
});

test('route: attack — cannot claim priorVerdict=MANUAL_REQUIRED when server-recorded verdict is NOT_SAFE', async () => {
  // /api/run-qc from this test environment cannot reach real BO from CI, so
  // fetchPromoSnapshot returns notFound → verdict NOT_SAFE. We use that.
  const cookie = await login();
  const runResp = await runQc(cookie, 'QP2A', 'DEFINITELY_NOT_A_REAL_CODE_ZZZ');
  const r = runResp.results?.[0] || {};
  assert.ok(r.runId, 'server must issue a runId on every result');
  // Server recorded whatever verdict the auto-check produced (NOT_SAFE for
  // notFound). Try to override:
  const attack = await tryOverride(cookie, {
    brand: 'QP2A', code: 'DEFINITELY_NOT_A_REAL_CODE_ZZZ',
    runId: r.runId,
    // Even with priorVerdict crafted, the server must verify against the
    // recorded verdict — which is NOT MANUAL_REQUIRED for a notFound case.
    priorVerdict: 'MANUAL_REQUIRED',
    reason: OK_REASON, evidence: OK_EVIDENCE,
  });
  // The verdict for a notFound is NOT_SAFE (auto-check), not MANUAL_REQUIRED.
  // The override MUST be rejected because server-recorded verdict differs.
  assert.equal(attack.status, 400);
  assert.match(attack.body.error, /only valid when the prior verdict is MANUAL_REQUIRED/);
});

test('route: attack — cannot reuse a runId across brands', async () => {
  const cookie = await login();
  const runResp = await runQc(cookie, 'QP2A', 'CROSS_BRAND_ATTACK_TEST');
  const r = runResp.results?.[0];
  const attack = await tryOverride(cookie, {
    brand: 'QPRO5', // different brand!
    code: 'CROSS_BRAND_ATTACK_TEST',
    runId: r.runId,
    reason: OK_REASON, evidence: OK_EVIDENCE,
  });
  assert.equal(attack.status, 400);
  assert.match(attack.body.error, /different brand/);
});

test('route: attack — cannot reuse a runId across promo codes', async () => {
  const cookie = await login();
  const runResp = await runQc(cookie, 'QP2A', 'CODE_A');
  const r = runResp.results?.[0];
  const attack = await tryOverride(cookie, {
    brand: 'QP2A',
    code: 'CODE_B', // different code!
    runId: r.runId,
    reason: OK_REASON, evidence: OK_EVIDENCE,
  });
  assert.equal(attack.status, 400);
  assert.match(attack.body.error, /different promo code/);
});
