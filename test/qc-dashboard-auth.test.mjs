#!/usr/bin/env node
// Unit tests for src/qc-dashboard/auth.js — validateTokenData().
// No server, no network, no Google. Placeholder emails only.
//
// Run with: node test/qc-dashboard-auth.test.mjs

import { loadAdmittedUsers, validateTokenData } from '../src/qc-dashboard/auth.js';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const ADMITTED = new Set(['alice@example.com', 'bob@example.co']);

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

function withAllowlist(raw, fn) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'qc-auth-allowlist-'));
  const cwd = process.cwd();
  try {
    writeFileSync(path.join(tmp, 'admitted-users.json'), JSON.stringify(raw));
    process.chdir(tmp);
    return fn();
  } finally {
    process.chdir(cwd);
    rmSync(tmp, { recursive: true, force: true });
  }
}

test('loadAdmittedUsers parses emails shape with promo-team role', () => {
  const users = withAllowlist({ emails: ['  Alice@Example.COM  ', 'BOB@example.co'] }, () => loadAdmittedUsers());
  assert.deepEqual(users, [
    { email: 'alice@example.com', role: 'promo-team' },
    { email: 'bob@example.co', role: 'promo-team' },
  ]);
});

test('loadAdmittedUsers parses users shape and preserves valid roles', () => {
  const users = withAllowlist({
    users: [
      { email: 'Admin@Example.COM', role: ' ADMIN ' },
      { email: 'hod@example.com', role: 'hod-view' },
      { email: 'guest@example.com', role: 'guest' },
    ],
  }, () => loadAdmittedUsers());
  assert.deepEqual(users, [
    { email: 'admin@example.com', role: 'admin' },
    { email: 'hod@example.com', role: 'hod-view' },
    { email: 'guest@example.com', role: 'guest' },
  ]);
});

test('loadAdmittedUsers defaults missing and invalid roles to promo-team', () => {
  const origWarn = console.warn;
  const warnings = [];
  console.warn = (msg) => warnings.push(msg);
  try {
    const users = withAllowlist({
      users: [
        { email: 'missing@example.com' },
        { email: 'bad@example.com', role: 'ROOT' },
        { email: 'also-bad@example.com', role: 'superuser' },
      ],
    }, () => loadAdmittedUsers());
    assert.deepEqual(users, [
      { email: 'missing@example.com', role: 'promo-team' },
      { email: 'bad@example.com', role: 'promo-team' },
      { email: 'also-bad@example.com', role: 'promo-team' },
    ]);
    assert.equal(warnings.length, 2);
  } finally {
    console.warn = origWarn;
  }
});

test('loadAdmittedUsers trims, lowercases, filters empties, and dedupes with last role winning', () => {
  const users = withAllowlist({
    users: [
      { email: '  Alice@Example.COM  ', role: 'promo-team' },
      { email: 'alice@example.com', role: 'admin' },
      { email: '' },
      { email: '   ' },
      { email: ' BOB@Example.co ', role: ' GUEST ' },
    ],
  }, () => loadAdmittedUsers());
  assert.deepEqual(users, [
    { email: 'alice@example.com', role: 'admin' },
    { email: 'bob@example.co', role: 'guest' },
  ]);
});

test('loadAdmittedUsers throws when normalization leaves no users', () => {
  assert.throws(
    () => withAllowlist({ users: [{ email: '' }, 'not-object'] }, () => loadAdmittedUsers()),
    /empty admitted users list/i,
  );
});

test('normalized allowlist matches Google response with different casing', () => {
  const allow = new Map(withAllowlist({ emails: ['  Alice@Example.COM  '] }, () => loadAdmittedUsers()).map((user) => [user.email, user]));
  const user = validateTokenData(
    { email: 'ALICE@EXAMPLE.COM', email_verified: 'true', aud: CLIENT_ID },
    allow, CLIENT_ID,
  );
  assert.equal(user.email, 'alice@example.com');
  assert.equal(user.role, 'promo-team');
});

// ── Admitted paths ─────────────────────────────────────────────────────────
test('admitted email — exact lowercase → accepted', () => {
  const user = validateTokenData(
    { email: 'alice@example.com', email_verified: 'true', aud: CLIENT_ID, name: 'Alice' },
    ADMITTED, CLIENT_ID,
  );
  assert.equal(user.email, 'alice@example.com');
  assert.equal(user.name, 'Alice');
  assert.equal(user.role, 'promo-team');
});

test('admitted email — mixed case in Google response → normalized + accepted', () => {
  const user = validateTokenData(
    { email: 'ALICE@Example.COM', email_verified: 'true', aud: CLIENT_ID },
    ADMITTED, CLIENT_ID,
  );
  assert.equal(user.email, 'alice@example.com');
  assert.equal(user.role, 'promo-team');
});

test('admitted email — surrounding whitespace in Google response → trimmed + accepted', () => {
  const user = validateTokenData(
    { email: '  Bob@Example.CO  ', email_verified: 'true', aud: CLIENT_ID },
    ADMITTED, CLIENT_ID,
  );
  assert.equal(user.email, 'bob@example.co');
  assert.equal(user.role, 'promo-team');
});

test('validateTokenData returns role from admitted users map', () => {
  const allow = new Map([['alice@example.com', { email: 'alice@example.com', role: 'admin' }]]);
  const user = validateTokenData(
    { email: 'alice@example.com', email_verified: 'true', aud: CLIENT_ID },
    allow, CLIENT_ID,
  );
  assert.equal(user.role, 'admin');
});

// ── 403 — valid identity, not admitted ─────────────────────────────────────
test('valid Google account NOT in allowlist → err.status === 403', () => {
  assert.throws(
    () => validateTokenData(
      { email: 'stranger@example.com', email_verified: 'true', aud: CLIENT_ID },
      ADMITTED, CLIENT_ID,
    ),
    (err) => err.status === 403 && /allowlist/i.test(err.message),
  );
});

test('403 message contains no configuration details', () => {
  try {
    validateTokenData(
      { email: 'stranger@example.com', email_verified: 'true', aud: CLIENT_ID },
      ADMITTED, CLIENT_ID,
    );
    assert.fail('expected throw');
  } catch (err) {
    assert.doesNotMatch(err.message, /apps\.googleusercontent\.com/, 'must not leak client ID');
    assert.doesNotMatch(err.message, /alice@|bob@/i, 'must not leak allowlist contents');
  }
});

// ── 401 — invalid identity / token ─────────────────────────────────────────
test('unverified email → err.status === 401 (not 500, not 403)', () => {
  assert.throws(
    () => validateTokenData(
      { email: 'alice@example.com', email_verified: 'false', aud: CLIENT_ID },
      ADMITTED, CLIENT_ID,
    ),
    (err) => err.status === 401,
  );
});

test('missing email in token → err.status === 401', () => {
  assert.throws(
    () => validateTokenData(
      { email_verified: 'true', aud: CLIENT_ID },
      ADMITTED, CLIENT_ID,
    ),
    (err) => err.status === 401,
  );
});

test('audience mismatch → err.status === 401 and does NOT leak expected/got IDs', () => {
  try {
    validateTokenData(
      { email: 'alice@example.com', email_verified: 'true', aud: 'wrong-client-id.example' },
      ADMITTED, CLIENT_ID,
    );
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.status, 401);
    assert.doesNotMatch(err.message, /wrong-client-id/, 'must not leak token aud');
    assert.doesNotMatch(err.message, /apps\.googleusercontent\.com/, 'must not leak configured client ID');
  }
});

// ── 500 — server misconfig, not user error ─────────────────────────────────
test('missing server-side client ID → err.status not set → falls through to 500', () => {
  try {
    validateTokenData(
      { email: 'alice@example.com', email_verified: 'true', aud: CLIENT_ID },
      ADMITTED, null,
    );
    assert.fail('expected throw');
  } catch (err) {
    // No .status → outer catch in bin/qc-dashboard.mjs maps to 500 "Internal server error"
    assert.equal(err.status, undefined);
    assert.match(err.message, /GOOGLE_CLIENT_ID/);
  }
});

// ── Runner ────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
for (const { name, fn } of cases) {
  try {
    fn();
    console.log(`  ok ${name}`);
    passed++;
  } catch (e) {
    console.log(`FAIL ${name}\n     ${e.message}`);
    failed++;
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
