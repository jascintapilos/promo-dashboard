import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  isLocalhost,
  isSessionExpired,
  makeSessionCookie,
  readSession,
  SESSION_MAX_AGE_MS,
  validateTokenData,
} from '../src/qc-dashboard/auth.js';
import { buildBrandList } from '../src/qc-dashboard/brand-config.js';

// ── validateTokenData ────────────────────────────────────────────────────────

test('wrong Google token audience is rejected', () => {
  const allow = new Set(['user@thebrandingpeople.co']);
  const data = {
    email: 'user@thebrandingpeople.co',
    email_verified: 'true',
    aud: 'wrong-oauth-client-id.apps.googleusercontent.com',
    name: 'User',
  };
  assert.throws(
    () => validateTokenData(data, allow, 'correct-oauth-client-id.apps.googleusercontent.com'),
    /audience mismatch/i,
  );
});

test('correct Google token audience is accepted', () => {
  const allow = new Set(['user@thebrandingpeople.co']);
  const data = {
    email: 'user@thebrandingpeople.co',
    email_verified: 'true',
    aud: 'my-client-id.apps.googleusercontent.com',
    name: 'User',
  };
  const result = validateTokenData(data, allow, 'my-client-id.apps.googleusercontent.com');
  assert.equal(result.email, 'user@thebrandingpeople.co');
});

test('email outside admitted domain is rejected', () => {
  const allow = new Set(['user@thebrandingpeople.co']);
  const data = { email: 'user@gmail.com', email_verified: 'true', aud: 'cid', name: 'U' };
  assert.throws(() => validateTokenData(data, allow, null), /domain/i);
});

test('email not in allowlist is rejected', () => {
  const allow = new Set(['other@thebrandingpeople.co']);
  const data = { email: 'user@thebrandingpeople.co', email_verified: 'true', aud: 'cid', name: 'U' };
  assert.throws(() => validateTokenData(data, allow, null), /allowlist/i);
});

// ── Session expiry ────────────────────────────────────────────────────────────

test('fresh session is not expired', () => {
  const session = { email: 'x@thebrandingpeople.co', iat: Date.now() };
  assert.equal(isSessionExpired(session), false);
});

test('session older than MAX_AGE is expired', () => {
  const oldIat = Date.now() - (SESSION_MAX_AGE_MS + 1000);
  const session = { email: 'x@thebrandingpeople.co', iat: oldIat };
  assert.equal(isSessionExpired(session), true);
});

test('session without iat is treated as expired', () => {
  assert.equal(isSessionExpired({ email: 'x@thebrandingpeople.co' }), true);
  assert.equal(isSessionExpired(null), true);
});

test('readSession returns null for an expired session cookie', () => {
  // Forge a valid HMAC-signed cookie that carries an old iat.
  const origMode = process.env.AUTH_MODE;
  process.env.AUTH_MODE = 'dev';
  const oldUser = { email: 'x@thebrandingpeople.co', iat: Date.now() - (SESSION_MAX_AGE_MS + 5000) };
  const secret = 'dev-only-qc-hub-secret';
  const payload = Buffer.from(JSON.stringify(oldUser)).toString('base64url');
  const mac = createHmac('sha256', secret).update(payload).digest('base64url');
  const cookieVal = `${payload}.${mac}`;
  const req = { headers: { cookie: `qc_hub_session=${cookieVal}` } };
  const result = readSession(req);
  process.env.AUTH_MODE = origMode;
  assert.equal(result, null);
});

// ── Cookie flags ──────────────────────────────────────────────────────────────

test('production cookie includes Secure and SameSite=Strict', () => {
  const origMode = process.env.AUTH_MODE;
  process.env.AUTH_MODE = 'dev'; // need dev secret available
  const cookie = makeSessionCookie({ email: 'x@thebrandingpeople.co' }, { secure: true });
  process.env.AUTH_MODE = origMode;
  assert.match(cookie, /\bSecure\b/);
  assert.match(cookie, /SameSite=Strict/);
});

test('development cookie omits Secure and uses SameSite=Lax', () => {
  const origMode = process.env.AUTH_MODE;
  process.env.AUTH_MODE = 'dev';
  const cookie = makeSessionCookie({ email: 'x@thebrandingpeople.co' }, { secure: false });
  process.env.AUTH_MODE = origMode;
  assert.doesNotMatch(cookie, /\bSecure\b/);
  assert.match(cookie, /SameSite=Lax/);
});

// ── Dev-bypass localhost restriction ─────────────────────────────────────────

test('isLocalhost accepts loopback addresses', () => {
  for (const [host, remote] of [
    ['localhost', '127.0.0.1'],
    ['127.0.0.1', '::1'],
    ['::1', '::ffff:127.0.0.1'],
  ]) {
    const req = { headers: { host }, socket: { remoteAddress: remote } };
    assert.equal(isLocalhost(req), true, `expected localhost for host=${host} remote=${remote}`);
  }
});

test('isLocalhost rejects external IPs and hostnames', () => {
  const req = { headers: { host: 'hub.internal:4321' }, socket: { remoteAddress: '10.0.0.5' } };
  assert.equal(isLocalhost(req), false);
});

// ── Disabled brands ───────────────────────────────────────────────────────────

test('MVP brands are enabled, non-MVP brands are disabled', () => {
  const brands = buildBrandList();
  const mvp = ['QP2A', 'QPRO1', 'QPRO5', 'WS1_MY'];
  for (const id of mvp) {
    const b = brands.find((x) => x.id === id);
    assert.ok(b, `${id} missing from brand list`);
    assert.equal(b.enabled, true, `${id} should be enabled`);
  }
  const nonMvp = brands.filter((b) => !mvp.includes(b.id));
  assert.ok(nonMvp.length > 0, 'expected at least one non-MVP brand');
  for (const b of nonMvp) {
    assert.equal(b.enabled, false, `${b.id} should be disabled`);
  }
});
