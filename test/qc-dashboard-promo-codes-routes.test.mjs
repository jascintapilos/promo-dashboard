// Promo Codes tab routes — list read from the Ops sheet (fixture here), allowlist-gated
// read, no upload route, and the `promo-codes` role being kept to its one page.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { buildSignedHeaders, MAX_REPORT_BUILD_BYTES } from '../src/qc-dashboard/relay-auth.js';
import { DATA_HEADERS, rowToSheet, statusToSheet } from '../src/qc-dashboard/promo-codes-sheet.js';

const RELAY = 'P'.repeat(64);
const TMP = mkdtempSync(path.join(os.tmpdir(), 'promo-codes-routes-'));
// Stands in for the "Promo Codes" / "Promo Codes Status" tabs of the Ops sheet.
const FIXTURE = path.join(TMP, 'sheet.json');
writeFileSync(FIXTURE, JSON.stringify({
  data: [DATA_HEADERS.slice(), rowToSheet({ source: 'CEE', code: 'REL_BASE_12PCT_5X', brands: ['QP2A'], regions: ['SG'], bo: { QP2A: 'active' }, mismatch: [] })],
  status: statusToSheet({ pulledAt: '2026-10-16T01:00:00.000Z', ok: true, lastGoodAt: '2026-10-16T01:00:00.000Z', boCheckedAt: '2026-10-16T01:05:00.000Z', sources: { CEE: 1, Sales: 0, CRM: 0 }, siteErrors: [] }),
}));
const VIEWERS = path.join(TMP, 'viewers.json');
writeFileSync(VIEWERS, JSON.stringify({ emails: ['viewer@test.local', 'codes-only@test.local'] }));
const servers = [];

async function startServer(port, email, role) {
  let stderr = '';
  const server = spawn(process.execPath, ['bin/qc-dashboard.mjs'], {
    env: {
      ...process.env, PORT: String(port), AUTH_MODE: 'dev', DEV_USER_EMAIL: email, DEV_USER_ROLE: role,
      RELAY_SECRET: RELAY, PROMO_CODES_SHEET_FIXTURE: FIXTURE, PROMO_CODES_VIEWERS_PATH: VIEWERS, OPS_DATA_DIR: path.join(TMP, 'ops'),
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

let VIEWER, OUTSIDER, CODES_ONLY, ADMIN;
test.before(async () => {
  [VIEWER, OUTSIDER, CODES_ONLY, ADMIN] = await Promise.all([
    startServer(4421, 'viewer@test.local', 'promo-team'),
    startServer(4422, 'outsider@test.local', 'promo-team'),
    startServer(4423, 'codes-only@test.local', 'promo-codes'),
    startServer(4424, 'boss@test.local', 'admin'),
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
const get = async (base, p, { auth = true } = {}) => fetch(`${base}${p}`, {
  redirect: 'manual', headers: auth ? { cookie: await cookieFor(base) } : {},
});

test('an allowlisted user reads the list from the sheet', async () => {
  const g = await get(VIEWER, '/api/promo-codes');
  assert.equal(g.status, 200);
  const body = await g.json();
  assert.equal(body.data.rows[0].code, 'REL_BASE_12PCT_5X');
  assert.deepEqual(body.data.rows[0].bo, { QP2A: 'active' });
  assert.equal(body.status.ok, true);
});

test('there is no upload route any more — not with a session, not with the QC relay key', async () => {
  const gz = gzipSync(Buffer.from('{}', 'utf8'));
  for (const p of ['/api/promo-codes/snapshot', '/api/relay/promo-codes/dataset']) {
    const { headers, bodyBuffer } = buildSignedHeaders({ method: 'POST', path: p, bodyBuffer: gz, secret: RELAY, workerId: 't', maxBytes: MAX_REPORT_BUILD_BYTES });
    const r = await fetch(`${VIEWER}${p}`, { method: 'POST', headers: { ...headers, cookie: await cookieFor(VIEWER) }, body: bodyBuffer });
    assert.notEqual(r.status, 200, p);
  }
  for (const p of ['/admin/promo-codes-key', '/api/admin/promo-codes-key']) {
    assert.ok([404, 200].includes((await get(ADMIN, p)).status) && !(await (await get(ADMIN, p)).text()).includes('Generate new key'), p);
  }
});

test('signed-out requests get 401 (API) / sign-in redirect (page)', async () => {
  assert.equal((await get(VIEWER, '/api/promo-codes', { auth: false })).status, 401);
  const p = await get(VIEWER, '/promo-codes', { auth: false });
  assert.equal(p.status, 302);
  assert.equal(p.headers.get('location'), '/?return=%2Fpromo-codes');
});

test('signed-in users NOT on the list are refused — admins included', async () => {
  for (const base of [OUTSIDER, ADMIN]) {
    assert.equal((await get(base, '/api/promo-codes')).status, 403);
    assert.equal((await get(base, '/promo-codes')).status, 403);
    const me = await (await get(base, '/api/me')).json();
    assert.equal(me.canViewPromoCodes, false);
  }
  // …and they keep the rest of the hub as before.
  assert.equal((await get(OUTSIDER, '/dashboard')).status, 200);
});

test('an allowlisted promo-team user gets the page and the tab flag', async () => {
  const p = await get(VIEWER, '/promo-codes');
  assert.equal(p.status, 200);
  assert.match(await p.text(), /<title>Promo Codes<\/title>/);
  assert.equal((await (await get(VIEWER, '/api/me')).json()).canViewPromoCodes, true);
  assert.equal((await get(VIEWER, '/dashboard')).status, 200);
});

test('promo-codes role: only the Promo Codes page and its data', async () => {
  assert.equal((await get(CODES_ONLY, '/promo-codes')).status, 200);
  assert.equal((await get(CODES_ONLY, '/api/promo-codes')).status, 200);
  for (const p of ['/', '/dashboard']) {
    const r = await get(CODES_ONLY, p);
    assert.equal(r.status, 302, p);
    assert.equal(r.headers.get('location'), '/promo-codes');
  }
  for (const p of ['/api/ops/data', '/api/brands', '/api/history', '/api/leave']) {
    assert.equal((await get(CODES_ONLY, p)).status, 403, p);
  }
  assert.equal((await get(CODES_ONLY, '/leave-board.html')).status, 403);
  assert.equal((await get(CODES_ONLY, '/admin/users')).status, 403);
  // The promo report stays closed to this role too.
  const promo = await get(CODES_ONLY, '/api/promo/ws1/MY/X.json');
  assert.ok([401, 403, 404].includes(promo.status), `promo report status ${promo.status}`);
});

test('POST /api/promo-codes is not allowed', async () => {
  const r = await fetch(`${VIEWER}/api/promo-codes`, { method: 'POST', headers: { cookie: await cookieFor(VIEWER) } });
  assert.equal(r.status, 405);
});
