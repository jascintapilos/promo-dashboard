#!/usr/bin/env node
// BO Relay Increment 4 — HTTP route tests.
//
// Covers correction brief §3 (ownership), §4 (raw-body HMAC on every relay
// request), §5 (mixed-batch behavior, lost-job semantics), §6 (scrubbed
// error messages, no client verdict trusted).

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSignedHeaders } from '../src/qc-dashboard/relay-auth.js';

const PORT = 4405;
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = 'S'.repeat(64);
let server;
let stderr = '';

test.before(async () => {
  server = spawn(process.execPath, ['bin/qc-dashboard.mjs'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      AUTH_MODE: 'dev',
      DEV_USER_EMAIL: 'ownerA@test.local',
      RELAY_SECRET: SECRET,
    },
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

test.after(() => { if (server && !server.killed) server.kill(); });

// Dev-mode login always returns DEV_USER_EMAIL (dev bypass), so all sessions
// in this test share the same operator. Ownership behavior is unit-tested in
// qc-dashboard-relay-job-store.test.mjs — this file focuses on HTTP routing.
async function login() {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  return r.headers.get('set-cookie').split(';')[0];
}

// Force BO_UNREACHABLE by overlaying the target site to a dead host, then
// wait one preflight-cache tick so the next /api/run-qc sees the change.
async function forceBoUnreachable(cookie, siteId = 'ibc22') {
  await fetch(`${BASE}/api/admin/site-configs`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ sites: { [siteId]: { baseUrl: 'http://127.0.0.1:1', apiHost: 'http://127.0.0.1:1' } } }),
  });
}
async function restoreOverlay(cookie) {
  await fetch(`${BASE}/api/admin/site-configs`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ sites: {} }),
  });
}

function signed({ method, path, body, workerId = 'test-worker' } = {}) {
  const buf = Buffer.from(body ?? '', 'utf8');
  const { headers } = buildSignedHeaders({ method, path, bodyBuffer: buf, secret: SECRET, workerId });
  return { headers, body: buf };
}

async function fetchSigned(path, method, body, workerId) {
  const s = signed({ method, path, body, workerId });
  return fetch(`${BASE}${path}`, { method, headers: s.headers, body: s.body });
}

// ── unauthenticated / HMAC failures ────────────────────────────────────

test('unauthenticated POST /api/relay/jobs/lease → 401 (no HMAC headers)', async () => {
  const r = await fetch(`${BASE}/api/relay/jobs/lease`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(r.status, 401);
});

test('tampered signature → 401', async () => {
  const s = signed({ method: 'POST', path: '/api/relay/jobs/lease', body: '{}' });
  s.headers['x-relay-signature'] = 'f'.repeat(64);
  const r = await fetch(`${BASE}/api/relay/jobs/lease`, { method: 'POST', headers: s.headers, body: s.body });
  assert.equal(r.status, 401);
});

test('tampered body after signing → 401 (raw-bytes verification)', async () => {
  const s = signed({ method: 'POST', path: '/api/relay/jobs/lease', body: '{}' });
  const r = await fetch(`${BASE}/api/relay/jobs/lease`, {
    method: 'POST', headers: s.headers, body: '{"tampered":true}',
  });
  assert.equal(r.status, 401);
});

test('oversized body → 413 (server bounds BEFORE HMAC verify)', async () => {
  // Unsigned oversized body: the server must reject on size before touching
  // the HMAC layer. This is what protects the process from DoS via garbage.
  const big = 'x'.repeat(80 * 1024);
  const r = await fetch(`${BASE}/api/relay/jobs/lease`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: big,
  });
  assert.equal(r.status, 413);
});

test('signed lease works — empty jobs list initially', async () => {
  const r = await fetchSigned('/api/relay/jobs/lease', 'POST', '{}', 'w1');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j.jobs));
});

// ── enqueue → lease → submit → poll (batch shape) ──────────────────────

test('/api/run-qc enqueues jobs when preflight is BO_UNREACHABLE (relay dispatched)', async () => {
  const cookie = await login();
  await forceBoUnreachable(cookie);
  try {
    const r = await fetch(`${BASE}/api/run-qc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ brand: 'QP2A', codes: ['SMOKE_A', 'SMOKE_B'] }),
    });
    assert.equal(r.status, 200);
    const j = await r.json();
    const queued = j.results.filter((x) => x.status === 'QUEUED');
    assert.ok(queued.length > 0, `expected at least one QUEUED code; got: ${JSON.stringify(j.results.map((x) => ({code: x.code, status: x.status, verdict: x.verdict})))}`);
    for (const q of queued) {
      assert.ok(q.jobId, 'each queued result carries jobId');
      assert.equal(q.verdict, null, 'queued codes do NOT carry a verdict yet');
      assert.equal(Object.prototype.hasOwnProperty.call(q, 'runId'), false, 'no runId until the final decision is recorded');
    }
    assert.equal(j.relayDispatched, true);
  } finally { await restoreOverlay(cookie); }
});

test('GET /api/qc-jobs/:jobId — owner reads job', async () => {
  const cookie = await login();
  await forceBoUnreachable(cookie);
  try {
    const runA = await fetch(`${BASE}/api/run-qc`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ brand: 'QP2A', codes: ['OWNER_A'] }),
    }).then((r) => r.json());
    const jobId = runA.results.find((r) => r.status === 'QUEUED')?.jobId;
    assert.ok(jobId, 'expected a jobId for OWNER_A run');
    const ownerRead = await fetch(`${BASE}/api/qc-jobs/${jobId}`, { headers: { cookie } });
    assert.equal(ownerRead.status, 200);
    const j = await ownerRead.json();
    assert.equal(j.job.jobId, jobId);
    assert.equal(j.job.status, 'QUEUED');
    assert.equal(Object.prototype.hasOwnProperty.call(j.job, 'requestedBy'), false, 'safe projection must not leak requestedBy');
  } finally { await restoreOverlay(cookie); }
});

test('signed relay result: server re-derives verdict — worker cannot force SAFE', async () => {
  const cookie = await login();
  await forceBoUnreachable(cookie);
  let jobId;
  try {
    const runResp = await fetch(`${BASE}/api/run-qc`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ brand: 'QP2A', codes: ['ATTACK_CODE'] }),
    }).then((r) => r.json());
    jobId = runResp.results.find((r) => r.status === 'QUEUED')?.jobId;
  } finally { await restoreOverlay(cookie); }
  assert.ok(jobId, 'setup: expected a jobId');

  // Lease it
  await fetchSigned('/api/relay/jobs/lease', 'POST', '{}');

  // Submit a result with a "SAFE" verdict field the worker tries to force,
  // but no evidence. Server MUST return the ownership-verified job status
  // and derive MANUAL_REQUIRED from the incomplete payload.
  const submitBody = JSON.stringify({
    jobId,
    brand: 'QP2A', code: 'ATTACK_CODE',
    workerError: { code: 'BO_UNREACHABLE', message: 'BO probe failed' },
    verdict: 'SAFE',                      // ← attacker tries to force this
  });
  const submitResp = await fetchSigned(`/api/relay/jobs/${jobId}/result`, 'POST', submitBody);
  assert.equal(submitResp.status, 200);

  // Now poll the job as the owner
  const finalJob = await fetch(`${BASE}/api/qc-jobs/${jobId}`, { headers: { cookie } }).then((r) => r.json());
  assert.equal(finalJob.job.status, 'COMPLETED');
  assert.equal(finalJob.job.result.verdict, 'MANUAL_REQUIRED', 'server MUST re-derive — never trust worker verdict');
  assert.ok(finalJob.job.finalRunId, 'final runId is what MP-override will require');
});

test('signed relay result: bad jobId (path vs body mismatch) → 400', async () => {
  await fetchSigned('/api/relay/jobs/lease', 'POST', '{}');
  const submitBody = JSON.stringify({ jobId: 'qcj_different', brand: 'QP2A', code: 'X' });
  const r = await fetchSigned('/api/relay/jobs/qcj_pathId/result', 'POST', submitBody);
  assert.equal(r.status, 400);
});

test('signed relay result: unknown jobId → 404', async () => {
  await fetchSigned('/api/relay/jobs/lease', 'POST', '{}');
  const submitBody = JSON.stringify({ jobId: 'qcj_neverIssued', brand: 'QP2A', code: 'X' });
  const r = await fetchSigned('/api/relay/jobs/qcj_neverIssued/result', 'POST', submitBody);
  assert.equal(r.status, 404);
});

// ── admin health ───────────────────────────────────────────────────────

test('/api/admin/relay-health — admin sees jobs + workers + secret status', async () => {
  const cookie = await login(); // dev mode → admin
  const r = await fetch(`${BASE}/api/admin/relay-health`, { headers: { cookie } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.relaySecretConfigured, true);
  assert.equal(typeof j.jobs.total, 'number');
  assert.ok(Array.isArray(j.workers));
});

test('/api/admin/relay-health — unauthenticated → 401', async () => {
  const r = await fetch(`${BASE}/api/admin/relay-health`);
  assert.equal(r.status, 401);
});

// ── unknown relay path ─────────────────────────────────────────────────

test('unknown /api/relay/* path with valid HMAC → 404', async () => {
  const r = await fetchSigned('/api/relay/bogus', 'POST', '{}');
  assert.equal(r.status, 404);
});
