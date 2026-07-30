import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  isLocalhost,
  isSessionExpired,
  makeSessionCookie,
  readSession,
  SESSION_MAX_AGE_MS,
  validateProductionConfig,
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

test('null clientId is always rejected (fail-closed)', () => {
  const allow = new Set(['user@thebrandingpeople.co']);
  const data = { email: 'user@thebrandingpeople.co', email_verified: 'true', aud: 'any', name: 'U' };
  assert.throws(() => validateTokenData(data, allow, null), /GOOGLE_CLIENT_ID/i);
});

test('email from outside domain is rejected (relies on explicit allowlist, not domain suffix)', () => {
  const allow = new Set(['user@thebrandingpeople.co']);
  const data = { email: 'user@gmail.com', email_verified: 'true', aud: 'cid', name: 'U' };
  assert.throws(() => validateTokenData(data, allow, 'cid'), /allowlist/i);
});

test('email not in allowlist is rejected', () => {
  const allow = new Set(['other@thebrandingpeople.co']);
  const data = { email: 'user@thebrandingpeople.co', email_verified: 'true', aud: 'cid', name: 'U' };
  assert.throws(() => validateTokenData(data, allow, 'cid'), /allowlist/i);
});

test('validateProductionConfig throws when no client ID is available (env + config both absent)', () => {
  // Run in an isolated tempdir so no qc-hub-config.json is discoverable.
  // Never touches the real project config file. Safe under parallel runs
  // and process interruption — worst case leaves an empty tempdir.
  const tmp = mkdtempSync(path.join(tmpdir(), 'qc-hub-config-test-'));
  try {
    const authUrl = pathToFileURL(path.resolve('src/qc-dashboard/auth.js')).href;
    const script = `
      import(${JSON.stringify(authUrl)}).then(({ validateProductionConfig }) => {
        try { validateProductionConfig(); process.exit(2); }
        catch (e) {
          if (/GOOGLE_CLIENT_ID/i.test(e.message)) process.exit(0);
          process.stderr.write('WRONG_MESSAGE:' + e.message);
          process.exit(3);
        }
      }).catch((e) => { process.stderr.write('IMPORT_ERR:' + e.message); process.exit(4); });
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: tmp,
      env: { ...process.env, AUTH_MODE: 'production', GOOGLE_CLIENT_ID: '' },
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status, 0, `expected validateProductionConfig to throw with /GOOGLE_CLIENT_ID/i. exit=${result.status} stderr=${result.stderr}`);
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

test('validateProductionConfig passes in dev mode without GOOGLE_CLIENT_ID', () => {
  const origClientId = process.env.GOOGLE_CLIENT_ID;
  const origMode = process.env.AUTH_MODE;
  process.env.AUTH_MODE = 'dev';
  process.env.GOOGLE_CLIENT_ID = '';
  try {
    assert.doesNotThrow(() => validateProductionConfig());
  } finally {
    if (origClientId != null) process.env.GOOGLE_CLIENT_ID = origClientId;
    else process.env.GOOGLE_CLIENT_ID = '';
    process.env.AUTH_MODE = origMode || '';
  }
});

// ── validateAllowlist — fail-closed at startup ────────────────────────────────

function spawnAllowlistCheck({ tmp, allowlistContent, expectExitCode = 0, expectMessage }) {
  const authUrl = pathToFileURL(path.resolve('src/qc-dashboard/auth.js')).href;
  const configPath = path.join(tmp, 'qc-hub-config.json');
  // Provide a valid client ID so we're testing the allowlist step specifically
  writeFileSync(configPath, JSON.stringify({ googleClientId: 'x.apps.googleusercontent.com' }));
  if (allowlistContent !== undefined) {
    writeFileSync(path.join(tmp, 'admitted-users.json'), allowlistContent);
  }
  const script = `
    import(${JSON.stringify(authUrl)}).then(({ validateAllowlist }) => {
      try { validateAllowlist(); process.exit(0); }
      catch (e) {
        process.stderr.write(e.message);
        process.exit(1);
      }
    }).catch((e) => { process.stderr.write('IMPORT_ERR:' + e.message); process.exit(4); });
  `;
  return spawnSync(process.execPath, ['-e', script], {
    cwd: tmp,
    env: { ...process.env, AUTH_MODE: 'production', GOOGLE_CLIENT_ID: '' },
    encoding: 'utf8',
    timeout: 10000,
  });
}

test('validateAllowlist throws when admitted-users.json is missing (fail-closed)', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'allowlist-missing-'));
  try {
    const result = spawnAllowlistCheck({ tmp }); // no file written
    assert.equal(result.status, 1);
    assert.match(result.stderr, /admitted-users\.json is required/i);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('validateAllowlist throws when file is malformed JSON', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'allowlist-malformed-'));
  try {
    const result = spawnAllowlistCheck({ tmp, allowlistContent: '{not json' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /malformed JSON/i);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('validateAllowlist throws when emails and users arrays are both missing', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'allowlist-noarray-'));
  try {
    const result = spawnAllowlistCheck({ tmp, allowlistContent: JSON.stringify({ allowed: [] }) });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /"emails" array or "users" array/i);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('validateAllowlist throws when emails array is empty (all filtered out)', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'allowlist-empty-'));
  try {
    const result = spawnAllowlistCheck({ tmp, allowlistContent: JSON.stringify({ emails: ['', '  '] }) });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /empty admitted users list/i);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('validateAllowlist accepts users shape with role', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'allowlist-users-ok-'));
  try {
    const result = spawnAllowlistCheck({
      tmp,
      allowlistContent: JSON.stringify({ users: [{ email: 'admin@example.com', role: 'admin' }] }),
    });
    assert.equal(result.status, 0, `expected pass, got exit=${result.status} stderr=${result.stderr}`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('validateAllowlist throws when users array is empty', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'allowlist-users-empty-'));
  try {
    const result = spawnAllowlistCheck({ tmp, allowlistContent: JSON.stringify({ users: [] }) });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /empty admitted users list/i);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('validateAllowlist filters malformed users and fails cleanly when none remain', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'allowlist-users-malformed-'));
  try {
    const result = spawnAllowlistCheck({ tmp, allowlistContent: JSON.stringify({ users: ['bad', {}, { role: 'admin' }] }) });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /empty admitted users list/i);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('validateAllowlist passes with a valid single-entry allowlist', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'allowlist-ok-'));
  try {
    const result = spawnAllowlistCheck({ tmp, allowlistContent: JSON.stringify({ emails: ['someone@example.com'] }) });
    assert.equal(result.status, 0, `expected pass, got exit=${result.status} stderr=${result.stderr}`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('validateAllowlist skipped in dev mode', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'allowlist-dev-'));
  try {
    const authUrl = pathToFileURL(path.resolve('src/qc-dashboard/auth.js')).href;
    // No allowlist file, but dev mode should skip the check
    const script = `
      import(${JSON.stringify(authUrl)}).then(({ validateAllowlist }) => {
        try { validateAllowlist(); process.exit(0); }
        catch (e) { process.stderr.write(e.message); process.exit(1); }
      });
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: tmp,
      env: { ...process.env, AUTH_MODE: 'dev' },
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status, 0, `dev mode should skip. stderr=${result.stderr}`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
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
