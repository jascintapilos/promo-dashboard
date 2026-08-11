// Self-service rotation — unit tests for the secret store.
// Covers the correction brief §1: crypto strength, one-time visibility,
// persistence + reload, log redaction (via return-value scoping), env vs
// file precedence, invalidation hooks fire on rotate.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readPersistedSecret, readStatus, readEffectiveSecret, rotateSecret, registerRotationInvalidation, _clearInvalidationHooksForTest } from '../src/qc-dashboard/relay-secret-store.js';

function scratchFile() {
  const dir = path.join(os.tmpdir(), `qc-relay-store-test-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return path.join(dir, 'relay-secret.local.json');
}

test.beforeEach(() => _clearInvalidationHooksForTest());

// ── rotate ────────────────────────────────────────────────────────────

test('rotate: generates ≥ 32-byte hex (64 chars)', () => {
  const file = scratchFile();
  const r = rotateSecret({ actorEmail: 'admin@x', file });
  assert.equal(r.secret.length, 64, 'must be 64 hex chars = 32 bytes');
  assert.match(r.secret, /^[0-9a-f]{64}$/);
  rmSync(path.dirname(file), { recursive: true, force: true });
});

test('rotate: two calls produce different secrets (entropy check)', () => {
  const file = scratchFile();
  const a = rotateSecret({ actorEmail: 'admin@x', file });
  const b = rotateSecret({ actorEmail: 'admin@x', file });
  assert.notEqual(a.secret, b.secret);
  rmSync(path.dirname(file), { recursive: true, force: true });
});

test('rotate: requires actorEmail', () => {
  const file = scratchFile();
  assert.throws(() => rotateSecret({ file }), /actorEmail required/);
  rmSync(path.dirname(file), { recursive: true, force: true });
});

test('rotate: persists {secret, rotatedAt, rotatedBy} to the file', () => {
  const file = scratchFile();
  rotateSecret({ actorEmail: 'jascinta@example.com', file });
  const raw = readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.secret.length, 64);
  assert.equal(parsed.rotatedBy, 'jascinta@example.com');
  assert.ok(parsed.rotatedAt);
  rmSync(path.dirname(file), { recursive: true, force: true });
});

test('rotate: fires registered invalidation hook exactly once', () => {
  const file = scratchFile();
  let calls = 0;
  registerRotationInvalidation(() => { calls++; });
  rotateSecret({ actorEmail: 'admin@x', file });
  assert.equal(calls, 1);
  rotateSecret({ actorEmail: 'admin@x', file });
  assert.equal(calls, 2, 'each rotate must fire again');
  rmSync(path.dirname(file), { recursive: true, force: true });
});

// ── readPersistedSecret ───────────────────────────────────────────────

test('read: absent file → { present: false }', () => {
  const r = readPersistedSecret({ file: '/nonexistent/relay-secret.local.json' });
  assert.equal(r.present, false);
  assert.equal(r.secret, null);
});

test('read: invalid JSON → { present: false }, no throw', () => {
  const file = scratchFile();
  writeFileSync(file, '{not json');
  const r = readPersistedSecret({ file });
  assert.equal(r.present, false);
  rmSync(path.dirname(file), { recursive: true, force: true });
});

test('read: JSON with short secret → { present: false }', () => {
  const file = scratchFile();
  writeFileSync(file, JSON.stringify({ secret: 'short' })); // nosecret — test fixture, not a real credential
  const r = readPersistedSecret({ file });
  assert.equal(r.present, false);
  rmSync(path.dirname(file), { recursive: true, force: true });
});

test('read: valid file → present + meta', () => {
  const file = scratchFile();
  rotateSecret({ actorEmail: 'admin@x', file });
  const r = readPersistedSecret({ file });
  assert.equal(r.present, true);
  assert.equal(r.secret.length, 64);
  assert.ok(r.meta.rotatedAt);
  assert.equal(r.meta.rotatedBy, 'admin@x');
  rmSync(path.dirname(file), { recursive: true, force: true });
});

// ── readStatus (never exposes value) ──────────────────────────────────

test('status: reports env source, never returns value', () => {
  const status = readStatus({ file: '/nonexistent', env: { RELAY_SECRET: 'x'.repeat(64) } });
  assert.equal(status.configured, true);
  assert.equal(status.source, 'env');
  assert.equal(Object.prototype.hasOwnProperty.call(status, 'secret'), false);
});

test('status: reports file source when env is missing', () => {
  const file = scratchFile();
  rotateSecret({ actorEmail: 'admin@x', file });
  const status = readStatus({ file, env: {} });
  assert.equal(status.configured, true);
  assert.equal(status.source, 'file');
  assert.equal(Object.prototype.hasOwnProperty.call(status, 'secret'), false);
  rmSync(path.dirname(file), { recursive: true, force: true });
});

test('status: reports not-configured when neither present', () => {
  const status = readStatus({ file: '/nonexistent', env: {} });
  assert.equal(status.configured, false);
  assert.equal(status.source, null);
});

// ── readEffectiveSecret (env wins) ────────────────────────────────────

test('effective: env RELAY_SECRET takes precedence over file', () => {
  const file = scratchFile();
  rotateSecret({ actorEmail: 'admin@x', file });          // writes 32-byte hex
  const envSecret = 'e'.repeat(64);
  const eff = readEffectiveSecret({ file, env: { RELAY_SECRET: envSecret } });
  assert.equal(eff, envSecret, 'env overrides file');
  rmSync(path.dirname(file), { recursive: true, force: true });
});

test('effective: file used when env is unset', () => {
  const file = scratchFile();
  const { secret } = rotateSecret({ actorEmail: 'admin@x', file });
  const eff = readEffectiveSecret({ file, env: {} });
  assert.equal(eff, secret);
  rmSync(path.dirname(file), { recursive: true, force: true });
});

test('effective: too-short env fallback to file', () => {
  const file = scratchFile();
  const { secret } = rotateSecret({ actorEmail: 'admin@x', file });
  const eff = readEffectiveSecret({ file, env: { RELAY_SECRET: 'short' } }); // nosecret — test fixture, not a real credential
  assert.equal(eff, secret, 'short env value must not defeat the persisted secret');
  rmSync(path.dirname(file), { recursive: true, force: true });
});

// ── §3: env-precedence — rotate throws when RELAY_SECRET is env-set ────

test('rotate: refuses when RELAY_SECRET env is set (EXTERNALLY_MANAGED)', () => {
  const file = scratchFile();
  let caught = null;
  try {
    rotateSecret({ actorEmail: 'admin@x', file, env: { RELAY_SECRET: 'e'.repeat(64) } });
  } catch (e) {
    caught = e;
  }
  assert.ok(caught, 'must throw');
  assert.equal(caught.code, 'EXTERNALLY_MANAGED');
  assert.match(caught.message, /externally managed via environment/);
  // Ensure the file was not written despite the throw (would create the
  // illusion of successful rotation).
  assert.equal(existsSync(file), false, 'rotate must NOT create the file when env wins');
  rmSync(path.dirname(file), { recursive: true, force: true });
});

test('rotate: escape hatch — allowEnvOverride:true rotates even when env is set (for tests/migration)', () => {
  const file = scratchFile();
  const r = rotateSecret({
    actorEmail: 'admin@x', file,
    env: { RELAY_SECRET: 'e'.repeat(64) },
    allowEnvOverride: true,
  });
  assert.equal(r.secret.length, 64);
  rmSync(path.dirname(file), { recursive: true, force: true });
});

// ── Atomic write (survives simulated mid-write crash) ─────────────────

test('rotate: uses atomic rename (a partial write from a previous crash does NOT stay live)', () => {
  const file = scratchFile();
  // Simulate a stale .tmp from a prior crashed rotate — the current
  // rotate must NOT accidentally pick it up as the effective secret.
  writeFileSync(`${file}.tmp-stale`, '{"secret":"stale-nope"}'); // nosecret — test fixture, not a real credential
  const { secret } = rotateSecret({ actorEmail: 'admin@x', file });
  const eff = readEffectiveSecret({ file, env: {} });
  assert.equal(eff, secret, 'effective secret must come from the final file, not a stale sibling');
  rmSync(path.dirname(file), { recursive: true, force: true });
});
