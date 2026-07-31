// BO Relay Increment 1 — HMAC auth tests.
//
// Covers correction brief §4 (raw-byte HMAC, timing-safe, timestamp limits,
// replay protection) and §2 (secret validation, no auto-generation).

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  sign, verifySignedRequest, buildSignedHeaders,
  timingSafeEqualHex, canonicalString, sha256Hex,
  readServerRelaySecret, readWorkerRelaySecret,
  _clearNonceCacheForTest,
  MAX_TIMESTAMP_SKEW_MS, MIN_SECRET_BYTES,
} from '../src/qc-dashboard/relay-auth.js';

const SECRET = 'a'.repeat(64); // 64 bytes — well above the 32-byte floor
const BODY = Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8');

function signedHeaders({ method = 'POST', path = '/api/relay/jobs/lease', body = BODY, now = Date.now(), overrideNonce, overrideSig, overrideTs, secret = SECRET } = {}) {
  const { headers } = buildSignedHeaders({ method, path, bodyBuffer: body, secret, workerId: 'test-worker', now });
  if (overrideNonce) headers['x-relay-nonce'] = overrideNonce;
  if (overrideSig != null) headers['x-relay-signature'] = overrideSig;
  if (overrideTs != null) headers['x-relay-timestamp'] = String(overrideTs);
  return { headers, body };
}

test.beforeEach(() => _clearNonceCacheForTest());

// ── Canonical string / signature basics ─────────────────────────────────

test('canonicalString: uses uppercase method, joined by \\n', () => {
  const c = canonicalString({ method: 'post', path: '/x', timestamp: 123, nonce: 'nnn', bodyHash: 'hhh' });
  assert.equal(c, 'POST\n/x\n123\nnnn\nhhh');
});

test('sign: is deterministic for identical inputs and changes when body changes', () => {
  const s1 = sign({ secret: SECRET, method: 'POST', path: '/x', timestamp: 1, nonce: 'nn', bodyBuffer: Buffer.from('a') });
  const s2 = sign({ secret: SECRET, method: 'POST', path: '/x', timestamp: 1, nonce: 'nn', bodyBuffer: Buffer.from('a') });
  const s3 = sign({ secret: SECRET, method: 'POST', path: '/x', timestamp: 1, nonce: 'nn', bodyBuffer: Buffer.from('b') });
  assert.equal(s1, s2);
  assert.notEqual(s1, s3);
});

test('sign: changes when ANY canonical component changes (path, ts, nonce)', () => {
  const base = { secret: SECRET, method: 'POST', path: '/x', timestamp: 1, nonce: 'nn', bodyBuffer: BODY };
  const baseSig = sign(base);
  assert.notEqual(sign({ ...base, path: '/y' }), baseSig);
  assert.notEqual(sign({ ...base, timestamp: 2 }), baseSig);
  assert.notEqual(sign({ ...base, nonce: 'oo' }), baseSig);
});

test('timingSafeEqualHex: rejects wrong length, non-hex, and differing bytes', () => {
  assert.equal(timingSafeEqualHex('a'.repeat(64), 'a'.repeat(64)), true);
  assert.equal(timingSafeEqualHex('a'.repeat(64), 'b'.repeat(64)), false);
  assert.equal(timingSafeEqualHex('a'.repeat(64), 'a'.repeat(63)), false, 'length mismatch');
  assert.equal(timingSafeEqualHex('zz'.repeat(32), 'zz'.repeat(32)), false, 'non-hex');
});

// ── verifySignedRequest ─────────────────────────────────────────────────

test('verify: happy path — freshly signed request accepts', () => {
  const { headers } = signedHeaders();
  const r = verifySignedRequest({
    method: 'POST', path: '/api/relay/jobs/lease',
    headers, bodyBuffer: BODY, secret: SECRET, now: Number(headers['x-relay-timestamp']),
  });
  assert.equal(r.ok, true);
});

test('verify: NO_SECRET when server has none configured', () => {
  const { headers } = signedHeaders();
  const r = verifySignedRequest({
    method: 'POST', path: '/api/relay/jobs/lease',
    headers, bodyBuffer: BODY, secret: null,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NO_SECRET');
  assert.equal(r.status, 503);
});

test('attack: missing any of the three required headers → MISSING_HEADERS 401', () => {
  const { headers } = signedHeaders();
  for (const h of ['x-relay-timestamp', 'x-relay-nonce', 'x-relay-signature']) {
    const copy = { ...headers };
    delete copy[h];
    const r = verifySignedRequest({
      method: 'POST', path: '/api/relay/jobs/lease',
      headers: copy, bodyBuffer: BODY, secret: SECRET,
    });
    assert.equal(r.ok, false, `missing ${h} should reject`);
    assert.equal(r.code, 'MISSING_HEADERS');
    assert.equal(r.status, 401);
  }
});

test('attack: non-numeric or negative timestamp → BAD_TIMESTAMP', () => {
  for (const bad of ['abc', '-1', '1.5', '0', '']) {
    const { headers } = signedHeaders({ overrideTs: bad });
    const r = verifySignedRequest({
      method: 'POST', path: '/api/relay/jobs/lease',
      headers, bodyBuffer: BODY, secret: SECRET,
    });
    assert.equal(r.ok, false);
    assert.match(r.code, /BAD_TIMESTAMP|MISSING_HEADERS/);
  }
});

test('attack: timestamp older than skew window → TIMESTAMP_SKEW', () => {
  const now = 1_800_000_000_000;
  const stale = now - MAX_TIMESTAMP_SKEW_MS - 1;
  const { headers } = signedHeaders({ now: stale });
  const r = verifySignedRequest({
    method: 'POST', path: '/api/relay/jobs/lease',
    headers, bodyBuffer: BODY, secret: SECRET, now,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'TIMESTAMP_SKEW');
});

test('attack: timestamp too far in the future → TIMESTAMP_SKEW', () => {
  const now = 1_800_000_000_000;
  const ahead = now + MAX_TIMESTAMP_SKEW_MS + 1;
  const { headers } = signedHeaders({ now: ahead });
  const r = verifySignedRequest({
    method: 'POST', path: '/api/relay/jobs/lease',
    headers, bodyBuffer: BODY, secret: SECRET, now,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'TIMESTAMP_SKEW');
});

test('attack: malformed nonce (too short, wrong charset) → BAD_NONCE', () => {
  for (const bad of ['short', '///// spaces //////////////', 'a'.repeat(200)]) {
    const { headers } = signedHeaders({ overrideNonce: bad });
    // Recompute signature with the tampered nonce so we isolate BAD_NONCE
    // from BAD_SIGNATURE.
    const ts = Number(headers['x-relay-timestamp']);
    headers['x-relay-signature'] = sign({ secret: SECRET, method: 'POST', path: '/api/relay/jobs/lease', timestamp: ts, nonce: bad, bodyBuffer: BODY });
    const r = verifySignedRequest({
      method: 'POST', path: '/api/relay/jobs/lease',
      headers, bodyBuffer: BODY, secret: SECRET, now: ts,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'BAD_NONCE', `nonce "${bad.slice(0, 20)}…" should be rejected`);
  }
});

test('attack: tampered path → BAD_SIGNATURE (raw-bytes canonicalization)', () => {
  const { headers } = signedHeaders({ path: '/api/relay/jobs/lease' });
  const ts = Number(headers['x-relay-timestamp']);
  const r = verifySignedRequest({
    method: 'POST', path: '/api/relay/jobs/lease/../result', // path attackers
    headers, bodyBuffer: BODY, secret: SECRET, now: ts,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'BAD_SIGNATURE');
});

test('attack: tampered body (single byte) → BAD_SIGNATURE (raw-bytes)', () => {
  const { headers } = signedHeaders({ body: BODY });
  const ts = Number(headers['x-relay-timestamp']);
  const tampered = Buffer.concat([BODY, Buffer.from('X')]);
  const r = verifySignedRequest({
    method: 'POST', path: '/api/relay/jobs/lease',
    headers, bodyBuffer: tampered, secret: SECRET, now: ts,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'BAD_SIGNATURE');
});

test('attack: tampered method → BAD_SIGNATURE', () => {
  const { headers } = signedHeaders({ method: 'POST' });
  const ts = Number(headers['x-relay-timestamp']);
  const r = verifySignedRequest({
    method: 'GET',
    path: '/api/relay/jobs/lease',
    headers, bodyBuffer: BODY, secret: SECRET, now: ts,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'BAD_SIGNATURE');
});

test('attack: replay — same headers reused within TTL → REPLAYED_NONCE', () => {
  const now = 1_800_000_000_000;
  const { headers } = signedHeaders({ now });
  const first = verifySignedRequest({
    method: 'POST', path: '/api/relay/jobs/lease',
    headers, bodyBuffer: BODY, secret: SECRET, now,
  });
  assert.equal(first.ok, true);
  const second = verifySignedRequest({
    method: 'POST', path: '/api/relay/jobs/lease',
    headers, bodyBuffer: BODY, secret: SECRET, now: now + 1000,
  });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'REPLAYED_NONCE');
});

test('attack: replay guard runs AFTER signature (so timing does not distinguish REPLAY vs BAD_SIG)', () => {
  const now = 1_800_000_000_000;
  const { headers } = signedHeaders({ now });
  // First accept.
  assert.equal(verifySignedRequest({
    method: 'POST', path: '/api/relay/jobs/lease',
    headers, bodyBuffer: BODY, secret: SECRET, now,
  }).ok, true);
  // Second: same nonce but wrong signature — must fail with BAD_SIGNATURE,
  // not REPLAYED_NONCE (otherwise attacker learns the nonce was accepted).
  const tampered = { ...headers, 'x-relay-signature': 'f'.repeat(64) };
  const r = verifySignedRequest({
    method: 'POST', path: '/api/relay/jobs/lease',
    headers: tampered, bodyBuffer: BODY, secret: SECRET, now: now + 1000,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'BAD_SIGNATURE');
});

// ── Secret validation ──────────────────────────────────────────────────

test('secret: server env absent AND no persisted file → { present: false, admin-path reason, no value }', () => {
  // Point the store at a nonexistent file for this test so the "file
  // fallback" branch cleanly resolves to not-present.
  process.env.QC_RELAY_SECRET_FILE = '/definitely/not/a/real/relay-secret.json';
  try {
    const r = readServerRelaySecret({});
    assert.equal(r.present, false);
    assert.equal(r.secret, null);
    assert.match(r.reason, /rotate a key from the admin panel/);
    // Never echo the env var value (attackers shouldn't learn its shape from an error msg)
    assert.doesNotMatch(r.reason, /RELAY_SECRET=/);
  } finally {
    delete process.env.QC_RELAY_SECRET_FILE;
  }
});

test('secret: server env too short → rejected, byte length not echoed', () => {
  const r = readServerRelaySecret({ RELAY_SECRET: 'a'.repeat(MIN_SECRET_BYTES - 1) });
  assert.equal(r.present, false);
  assert.match(r.reason, new RegExp(`shorter than ${MIN_SECRET_BYTES}`));
  assert.doesNotMatch(r.reason, /aaaaa/i, 'reason must not echo the secret value');
});

test('secret: server env ≥ 32 bytes → accepted', () => {
  const r = readServerRelaySecret({ RELAY_SECRET: 'x'.repeat(MIN_SECRET_BYTES) });
  assert.equal(r.present, true);
  assert.equal(r.secret.length, MIN_SECRET_BYTES);
});

test('secret: worker prefers env, falls back to ~/.qc-relay/relay-secret', () => {
  // Env path
  const envHit = readWorkerRelaySecret({ env: { RELAY_SECRET: 'e'.repeat(64) }, home: '/nonexistent-home' });
  assert.equal(envHit.present, true);

  // Missing env + missing file
  const nothing = readWorkerRelaySecret({ env: {}, home: '/nonexistent-home' });
  assert.equal(nothing.present, false);
  assert.match(nothing.reason, /not set/);
});

test('secret: reader never throws on unreadable file (returns present:false)', () => {
  // Passing a non-existent home path exercises the "no file" branch.
  const r = readWorkerRelaySecret({ env: {}, home: '/definitely/not/a/dir/xyz' });
  assert.equal(r.present, false);
});
