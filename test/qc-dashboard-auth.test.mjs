#!/usr/bin/env node
// Unit tests for src/qc-dashboard/auth.js — validateTokenData().
// No server, no network, no Google. Placeholder emails only.
//
// Run with: node test/qc-dashboard-auth.test.mjs

import { validateTokenData } from '../src/qc-dashboard/auth.js';
import assert from 'node:assert/strict';

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const ADMITTED = new Set(['alice@example.com', 'bob@example.co']);

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

// ── Allowlist normalization + dedup (simulates loading from JSON file) ────
// The same expression admittedEmails() runs on parsed.emails:
function normalizeAllowlist(raw) {
  return new Set(raw.map((e) => String(e).trim().toLowerCase()).filter(Boolean));
}

test('allowlist normalization: whitespace + casing + empties + duplicates', () => {
  const raw = [
    '  Alice@Example.COM  ',
    'alice@example.com',   // duplicate of the above after normalization
    'BOB@example.co',
    '',                    // empty removed
    '   ',                 // whitespace-only removed
  ];
  const set = normalizeAllowlist(raw);
  assert.equal(set.size, 2);              // dedup + empty removal
  assert.ok(set.has('alice@example.com'));
  assert.ok(set.has('bob@example.co'));
});

test('normalized allowlist matches Google response with different casing', () => {
  const set = normalizeAllowlist(['  Alice@Example.COM  ']);
  const user = validateTokenData(
    { email: 'ALICE@EXAMPLE.COM', email_verified: 'true', aud: CLIENT_ID },
    set, CLIENT_ID,
  );
  assert.equal(user.email, 'alice@example.com');
});

// ── Admitted paths ─────────────────────────────────────────────────────────
test('admitted email — exact lowercase → accepted', () => {
  const user = validateTokenData(
    { email: 'alice@example.com', email_verified: 'true', aud: CLIENT_ID, name: 'Alice' },
    ADMITTED, CLIENT_ID,
  );
  assert.equal(user.email, 'alice@example.com');
  assert.equal(user.name, 'Alice');
});

test('admitted email — mixed case in Google response → normalized + accepted', () => {
  const user = validateTokenData(
    { email: 'ALICE@Example.COM', email_verified: 'true', aud: CLIENT_ID },
    ADMITTED, CLIENT_ID,
  );
  assert.equal(user.email, 'alice@example.com');
});

test('admitted email — surrounding whitespace in Google response → trimmed + accepted', () => {
  const user = validateTokenData(
    { email: '  Bob@Example.CO  ', email_verified: 'true', aud: CLIENT_ID },
    ADMITTED, CLIENT_ID,
  );
  assert.equal(user.email, 'bob@example.co');
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
