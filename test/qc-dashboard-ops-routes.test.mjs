// Ops Dashboard data routes — relay push (HMAC) + session-gated read.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSignedHeaders, MAX_REPORT_BUILD_BYTES } from '../src/qc-dashboard/relay-auth.js';

const SECRET = 'O'.repeat(64);
const DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'ops-routes-'));
const servers = [];

async function startServer(port, extraEnv = {}) {
  let stderr = '';
  const server = spawn(process.execPath, ['bin/qc-dashboard.mjs'], {
    env: { ...process.env, PORT: String(port), AUTH_MODE: 'dev', DEV_USER_EMAIL: 'ops@test.local', RELAY_SECRET: SECRET, OPS_DATA_DIR: DATA_DIR, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => (stderr += d.toString()));
  servers.push(server);
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/config`)).ok) return `http://127.0.0.1:${port}`; } catch {}
    await sleep(150);
  }
  throw new Error(`Server not ready. stderr:\n${stderr}`);
}

let BASE, REPORT_BASE;
test.before(async () => {
  BASE = await startServer(4411);
  REPORT_BASE = await startServer(4412, { DEV_USER_ROLE: 'promo-report' });
});
test.after(() => {
  for (const s of servers) if (!s.killed) s.kill();
  rmSync(DATA_DIR, { recursive: true, force: true });
});

async function cookieFor(base) {
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  return r.headers.get('set-cookie').split(';')[0];
}

function signedPush(key, payload, { tamper = false } = {}) {
  const relPath = `/api/relay/ops/dataset/${key}`;
  const gz = Buffer.isBuffer(payload) ? payload : gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
  const { headers, bodyBuffer } = buildSignedHeaders({ method: 'POST', path: relPath, bodyBuffer: gz, secret: SECRET, workerId: 'ops-test', maxBytes: MAX_REPORT_BUILD_BYTES });
  headers['content-type'] = 'application/gzip';
  if (tamper) headers['x-relay-signature'] = 'f'.repeat(64);
  return { url: `${BASE}${relPath}`, init: { method: 'POST', headers, body: bodyBuffer } };
}

const promoPush = (rows, extra = {}) => ({
  key: 'promos', pulledAt: '2026-10-07T10:00:00.000Z', ok: true,
  headers: ['Date', 'Code', 'Brand', 'Region', 'Created By', 'Type', 'Status'], rows, ...extra,
});

test('signed push stores the dataset and GET /api/ops/data returns it', async () => {
  const { url, init } = signedPush('promos', promoPush([['06/10/2026', 'RET_CRM_REL_X', 'QP2A', 'MY', 'bot', 'Deposit', 'Active']]));
  const r = await fetch(url, init);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.status.rowCount, 1);
  assert.equal(body.status.newestRowDate, '2026-10-06');

  const cookie = await cookieFor(BASE);
  const g = await fetch(`${BASE}/api/ops/data`, { headers: { cookie } });
  assert.equal(g.status, 200);
  const data = await g.json();
  assert.deepEqual(data.datasets.promos.rows, [['06/10/2026', 'RET_CRM_REL_X', 'QP2A', 'MY', 'bot', 'Deposit', 'Active']]);
  assert.equal(data.status.promos.ok, true);
});

test('GET /api/ops/data is gzip-encoded when the client accepts it', async () => {
  const cookie = await cookieFor(BASE);
  const res = await new Promise((resolve, reject) => {
    import('node:http').then(({ default: http }) => {
      http.get(`${BASE}/api/ops/data`, { headers: { cookie, 'accept-encoding': 'gzip' } }, (resp) => {
        const chunks = []; resp.on('data', (c) => chunks.push(c)); resp.on('end', () => resolve({ resp, buf: Buffer.concat(chunks) }));
      }).on('error', reject);
    });
  });
  assert.equal(res.resp.headers['content-encoding'], 'gzip');
  assert.ok(JSON.parse(gunzipSync(res.buf).toString('utf8')).datasets);
});

test('a bad signature is rejected 401 and nothing is stored', async () => {
  const { url, init } = signedPush('games', { key: 'games', pulledAt: '2026-10-07T10:00:00.000Z', ok: false, detail: 'x' }, { tamper: true });
  const r = await fetch(url, init);
  assert.equal(r.status, 401);
  const data = await (await fetch(`${BASE}/api/ops/data`, { headers: { cookie: await cookieFor(BASE) } })).json();
  assert.equal(data.status.games, undefined);
});

test('a replayed request (same nonce) is rejected 401', async () => {
  const { url, init } = signedPush('adhoc', { key: 'adhoc', pulledAt: '2026-10-07T10:00:00.000Z', ok: false, detail: 'x' });
  assert.equal((await fetch(url, init)).status, 200);
  assert.equal((await fetch(url, init)).status, 401);
});

test('unknown dataset, bad gzip and missing columns are rejected 400', async () => {
  let p = signedPush('nope', { key: 'nope', pulledAt: '2026-10-07T10:00:00.000Z', ok: false });
  assert.equal((await fetch(p.url, p.init)).status, 400);
  p = signedPush('promos', Buffer.from('not gzip'));
  assert.equal((await fetch(p.url, p.init)).status, 400);
  p = signedPush('promos', promoPush([], { headers: ['Date', 'Code'] }));
  const r = await fetch(p.url, p.init);
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /missing columns/);
});

test('an oversize body is rejected before auth', async () => {
  const relPath = '/api/relay/ops/dataset/promos';
  const r = await fetch(`${BASE}${relPath}`, { method: 'POST', headers: { 'content-type': 'application/gzip' }, body: Buffer.alloc(MAX_REPORT_BUILD_BYTES + 1024) });
  assert.equal(r.status, 413);
});

test('unauthenticated GET /api/ops/data is 401', async () => {
  assert.equal((await fetch(`${BASE}/api/ops/data`)).status, 401);
});

test('a report-only account gets 403 on /api/ops/data', async () => {
  const cookie = await cookieFor(REPORT_BASE);
  assert.equal((await fetch(`${REPORT_BASE}/api/ops/data`, { headers: { cookie } })).status, 403);
});

test('crmSmartico is a valid split-feed dataset (direct push lands + reads back)', async () => {
  const push = {
    key: 'crmSmartico', pulledAt: '2026-10-07T12:00:00.000Z', ok: true,
    headers: ['Date', 'Brand', 'Region', 'CRM Tool', 'Segment Name', 'Created By'],
    rows: [['2026-10-06', 'QPRO16', 'MY', 'Smartico', 'QPRO16 Deposit Boost', 'Alysa']],
  };
  const relPath = '/api/relay/ops/dataset/crmSmartico';
  const gz = gzipSync(Buffer.from(JSON.stringify(push), 'utf8'));
  const { headers, bodyBuffer } = buildSignedHeaders({ method: 'POST', path: relPath, bodyBuffer: gz, secret: SECRET, workerId: 'smartico-test', maxBytes: MAX_REPORT_BUILD_BYTES });
  headers['content-type'] = 'application/gzip';
  const r = await fetch(`${BASE}${relPath}`, { method: 'POST', headers, body: bodyBuffer });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).status.rowCount, 1);
  const data = await (await fetch(`${BASE}/api/ops/data`, { headers: { cookie: await cookieFor(BASE) } })).json();
  assert.equal(data.datasets.crmSmartico.rows[0][5], 'Alysa');
});

test('crmFt is a valid split-feed dataset (FastTrack direct push lands + reads back)', async () => {
  const push = {
    key: 'crmFt', pulledAt: '2026-10-08T12:00:00.000Z', ok: true,
    headers: ['Date', 'Brand', 'Region', 'CRM Tool', 'Segment Name', 'Created By'],
    rows: [['2026-10-07', 'MB8', 'MY', 'FastTrack WS1', 'Reactivation D4', 'Ridwan']],
  };
  const relPath = '/api/relay/ops/dataset/crmFt';
  const gz = gzipSync(Buffer.from(JSON.stringify(push), 'utf8'));
  const { headers, bodyBuffer } = buildSignedHeaders({ method: 'POST', path: relPath, bodyBuffer: gz, secret: SECRET, workerId: 'ft-test', maxBytes: MAX_REPORT_BUILD_BYTES });
  headers['content-type'] = 'application/gzip';
  const r = await fetch(`${BASE}${relPath}`, { method: 'POST', headers, body: bodyBuffer });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).status.rowCount, 1);
  const data = await (await fetch(`${BASE}/api/ops/data`, { headers: { cookie: await cookieFor(BASE) } })).json();
  assert.equal(data.datasets.crmFt.rows[0][5], 'Ridwan');
});
