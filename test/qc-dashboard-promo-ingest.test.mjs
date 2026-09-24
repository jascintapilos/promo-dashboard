#!/usr/bin/env node
// Promo player-data ingest (relay push) — the server write/prune/sanitise logic and
// the relay maxBytes opt-in. Pure/unit against a temp root; no server, no network.
//
//   node --test test/qc-dashboard-promo-ingest.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ingestPromoPlayers } from '../src/qc-dashboard/promo.js';
import { buildSignedHeaders, verifySignedRequest } from '../src/qc-dashboard/relay-auth.js';

const root = mkdtempSync(join(tmpdir(), 'promo-ingest-'));
mkdirSync(join(root, 'data', 'promo', 'ws1', 'players'), { recursive: true });
writeFileSync(join(root, 'data', 'promo', 'promo-brands.json'),
  JSON.stringify({ brands: { ws1: { name: 'WS1', markets: ['MY', 'SG'], emails: [] } } }));

const gz = (obj) => gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'));
const dir = (mk) => join(root, 'data', 'promo', 'ws1', 'players', mk);

test('writes per-code files verbatim', () => {
  const r = ingestPromoPlayers(root, 'ws1', gz({ 'MY/CODE1.json': '[{"member_id":"1"}]', 'MY/CODE2.json': '[{"member_id":"2"}]' }));
  assert.equal(r.written, 2);
  assert.equal(readFileSync(join(dir('MY'), 'CODE1.json'), 'utf8'), '[{"member_id":"1"}]');
  assert.deepEqual(readdirSync(dir('MY')).sort(), ['CODE1.json', 'CODE2.json']);
});

test('clean replace — stale codes pruned, survivors updated', () => {
  const r = ingestPromoPlayers(root, 'ws1', gz({ 'MY/CODE1.json': '[{"member_id":"1b"}]' }));
  assert.equal(r.written, 1);
  assert.equal(r.pruned, 1); // CODE2 dropped from this push
  assert.deepEqual(readdirSync(dir('MY')).sort(), ['CODE1.json']);
  assert.equal(readFileSync(join(dir('MY'), 'CODE1.json'), 'utf8'), '[{"member_id":"1b"}]');
});

test('encoded filenames + multiple markets', () => {
  const r = ingestPromoPlayers(root, 'ws1', gz({ "MY/FT_X%20Y.json": '[]', 'SG/S1.json': '[]' }));
  assert.equal(r.written, 2);
  assert.ok(existsSync(join(dir('MY'), 'FT_X%20Y.json')));
  assert.ok(existsSync(join(dir('SG'), 'S1.json')));
});

test('path traversal + bad entries rejected, safe ones still written', () => {
  const r = ingestPromoPlayers(root, 'ws1', gz({ '../evil.json': 'x', 'MY/../../evil.json': 'x', 'MY/ok.json': '[]' }));
  assert.equal(r.written, 1);
  assert.ok(existsSync(join(dir('MY'), 'ok.json')));
  assert.ok(!existsSync(join(root, 'data', 'promo', 'evil.json')));
});

test('unknown/invalid project + bad gzip throw', () => {
  assert.throws(() => ingestPromoPlayers(root, 'nope', gz({ 'MY/a.json': '[]' })), /unknown project/);
  assert.throws(() => ingestPromoPlayers(root, 'Bad Id', gz({})), /invalid project/);
  assert.throws(() => ingestPromoPlayers(root, 'ws1', Buffer.from('not gzip at all')), /gzip|JSON/i);
});

test('relay maxBytes: default caps at 64KB, opt-in allows a large signed body', () => {
  const secret = 'x'.repeat(64);
  const big = Buffer.alloc(200 * 1024, 7); // 200KB
  assert.throws(() => buildSignedHeaders({ method: 'POST', path: '/p', bodyBuffer: big, secret }), /exceeds/);
  const { headers, bodyBuffer } = buildSignedHeaders({ method: 'POST', path: '/p', bodyBuffer: big, secret, maxBytes: 1 << 20 });
  assert.equal(verifySignedRequest({ method: 'POST', path: '/p', headers, bodyBuffer, secret }).ok, true);
  // tampering the body fails verification
  assert.equal(verifySignedRequest({ method: 'POST', path: '/p', headers, bodyBuffer: Buffer.alloc(200 * 1024, 8), secret }).ok, false);
});
