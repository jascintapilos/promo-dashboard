// Promo Codes feed key — route separation from the QC relay, rotate, revoke.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSignedHeaders, MAX_REPORT_BUILD_BYTES } from '../src/qc-dashboard/relay-auth.js';

const RELAY = 'R'.repeat(64);
const TMP = mkdtempSync(path.join(os.tmpdir(), 'pc-feed-routes-'));
const VIEWERS = path.join(TMP, 'viewers.json');
writeFileSync(VIEWERS, JSON.stringify({ emails: ['boss@test.local'] }));
const servers = [];

async function startServer(port, { role, feedFile }) {
  let stderr = '';
  const server = spawn(process.execPath, ['bin/qc-dashboard.mjs'], {
    env: {
      ...process.env, PORT: String(port), AUTH_MODE: 'dev', DEV_USER_EMAIL: 'boss@test.local', DEV_USER_ROLE: role,
      RELAY_SECRET: RELAY, PROMO_CODES_FEED_SECRET: '', PROMO_CODES_FEED_SECRET_FILE: feedFile,
      PROMO_CODES_DATA_DIR: path.join(TMP, `data-${port}`), PROMO_CODES_VIEWERS_PATH: VIEWERS, OPS_DATA_DIR: path.join(TMP, `ops-${port}`),
    },
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

let ADMIN, TEAM;
test.before(async () => {
  [ADMIN, TEAM] = await Promise.all([
    startServer(4431, { role: 'admin', feedFile: path.join(TMP, 'feed-admin.local.json') }),
    startServer(4432, { role: 'promo-team', feedFile: path.join(TMP, 'feed-team.local.json') }),
  ]);
});
test.after(() => {
  for (const s of servers) if (!s.killed) s.kill();
  rmSync(TMP, { recursive: true, force: true });
});

async function cookieFor(base) {
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  return r.headers.get('set-cookie').split(';')[0];
}
function signed(base, relPath, payload, secret) {
  const gz = gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
  const { headers, bodyBuffer } = buildSignedHeaders({ method: 'POST', path: relPath, bodyBuffer: gz, secret, workerId: 'feed-test', maxBytes: MAX_REPORT_BUILD_BYTES });
  headers['content-type'] = 'application/gzip';
  return fetch(`${base}${relPath}`, { method: 'POST', headers, body: bodyBuffer });
}
async function rotate(base, { origin = base } = {}) {
  return fetch(`${base}/api/admin/promo-codes-key/rotate`, {
    method: 'POST', headers: { cookie: await cookieFor(base), origin, 'content-type': 'application/json' }, body: '{}',
  });
}

const SNAP = {
  ok: true, pulledAt: '2026-10-16T01:00:00.000Z', boCheckedAt: '2026-10-16T01:05:00.000Z', sources: { CEE: 1 }, siteErrors: [],
  rows: [{ source: 'CEE', code: 'REL_A', brands: ['QP2A'], regions: ['SG'], bo: { QP2A: 'active' }, mismatch: [] }],
};
const OPS = { key: 'promos', pulledAt: '2026-10-16T01:00:00.000Z', ok: true, headers: ['Date', 'Code', 'Brand', 'Region', 'Created By', 'Type'], rows: [] };

test('no feed key configured → snapshot 503 (even with a valid QC relay signature)', async () => {
  assert.equal((await signed(TEAM, '/api/promo-codes/snapshot', SNAP, RELAY)).status, 503);
});

test('rotate is admin-only and same-origin-checked', async () => {
  assert.equal((await rotate(TEAM)).status, 403);
  assert.equal((await rotate(ADMIN, { origin: 'https://evil.example' })).status, 403);
  const st = await fetch(`${TEAM}/api/admin/promo-codes-key`, { headers: { cookie: await cookieFor(TEAM) } });
  assert.equal(st.status, 403);
});

test('admin page is admin-only', async () => {
  assert.equal((await fetch(`${TEAM}/admin/promo-codes-key`, { headers: { cookie: await cookieFor(TEAM) }, redirect: 'manual' })).status, 403);
  const ok = await fetch(`${ADMIN}/admin/promo-codes-key`, { headers: { cookie: await cookieFor(ADMIN) } });
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /Promo Codes upload key/);
});

test('rotate → feed key uploads; keys are strictly separated; re-rotate revokes the old key', async () => {
  const r = await rotate(ADMIN);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const { secret: k1 } = await r.json();
  assert.match(k1, /^[0-9a-f]{64}$/);

  // Status never shows the value.
  const st = await (await fetch(`${ADMIN}/api/admin/promo-codes-key`, { headers: { cookie: await cookieFor(ADMIN) } })).json();
  assert.equal(st.key.configured, true);
  assert.ok(!JSON.stringify(st).includes(k1));

  // Feed key → snapshot OK; response carries no code data.
  const ok = await signed(ADMIN, '/api/promo-codes/snapshot', SNAP, k1);
  assert.equal(ok.status, 200);
  const okBody = await ok.json();
  assert.equal(okBody.status.rowCount, 1);
  assert.ok(!JSON.stringify(okBody).includes('REL_A'));

  // QC relay secret is REJECTED on the snapshot route.
  assert.equal((await signed(ADMIN, '/api/promo-codes/snapshot', SNAP, RELAY)).status, 401);

  // Feed key is REJECTED on every QC relay route.
  for (const p of ['/api/relay/jobs/lease', '/api/relay/jobs/job123/result', '/api/relay/ops/dataset/promos', '/api/relay/promo-codes/dataset']) {
    assert.equal((await signed(ADMIN, p, p.includes('ops') ? OPS : {}, k1)).status, 401, p);
  }
  // The old relay-signed Promo Codes route is gone: a valid relay signature stores nothing there.
  const old = await signed(ADMIN, '/api/relay/promo-codes/dataset', { ...SNAP, rows: [{ ...SNAP.rows[0], code: 'VIA_RELAY' }] }, RELAY);
  assert.notEqual(old.status, 200);
  const view = await (await fetch(`${ADMIN}/api/promo-codes`, { headers: { cookie: await cookieFor(ADMIN) } })).json();
  assert.equal(view.data.rows[0].code, 'REL_A');

  // Rotating again revokes k1 immediately; the QC relay keeps working.
  const { secret: k2 } = await (await rotate(ADMIN)).json();
  assert.notEqual(k2, k1);
  assert.equal((await signed(ADMIN, '/api/promo-codes/snapshot', SNAP, k1)).status, 401);
  assert.equal((await signed(ADMIN, '/api/promo-codes/snapshot', SNAP, k2)).status, 200);
  assert.equal((await signed(ADMIN, '/api/relay/ops/dataset/promos', OPS, RELAY)).status, 200);
});

test('snapshot rejects tampered bodies, replays and GET', async () => {
  const { secret } = await (await rotate(ADMIN)).json();
  const relPath = '/api/promo-codes/snapshot';
  const gz = gzipSync(Buffer.from(JSON.stringify(SNAP), 'utf8'));
  const { headers, bodyBuffer } = buildSignedHeaders({ method: 'POST', path: relPath, bodyBuffer: gz, secret, workerId: 'feed-test', maxBytes: MAX_REPORT_BUILD_BYTES });
  const tampered = Buffer.from(bodyBuffer); tampered[tampered.length - 1] ^= 1;
  assert.equal((await fetch(`${ADMIN}${relPath}`, { method: 'POST', headers, body: tampered })).status, 401);
  assert.equal((await fetch(`${ADMIN}${relPath}`, { method: 'POST', headers, body: bodyBuffer })).status, 200);
  assert.equal((await fetch(`${ADMIN}${relPath}`, { method: 'POST', headers, body: bodyBuffer })).status, 401); // replayed nonce
  assert.equal((await fetch(`${ADMIN}${relPath}`)).status, 405);
});
