import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkHealth } from '../src/qc-hub-health.js';

// ── Fake fetch builders ────────────────────────────────────────────────────

const HEALTHY_BODY = { devMode: false, googleClientId: 'cid.apps.googleusercontent.com' };

function okFetch(body = HEALTHY_BODY) {
  return (_url, _opts) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

function httpFailFetch(status = 503) {
  return (_url, _opts) =>
    Promise.resolve({ ok: false, status, json: () => Promise.resolve({}) });
}

function connectErrorFetch() {
  return (_url, _opts) => Promise.reject(new Error('ECONNREFUSED'));
}

function abortErrorFetch() {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return (_url, _opts) => Promise.reject(err);
}

function nonJsonFetch() {
  return (_url, _opts) =>
    Promise.resolve({
      ok: true,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    });
}

// ── Success ────────────────────────────────────────────────────────────────

test('returns true when hub is healthy', async () => {
  const result = await checkHealth({ fetch: okFetch(), timeoutMs: 100 });
  assert.equal(result, true);
});

// ── Connection failures ────────────────────────────────────────────────────

test('rejects with CONNECT_ERROR when hub is unreachable', async () => {
  await assert.rejects(
    () => checkHealth({ fetch: connectErrorFetch(), timeoutMs: 100 }),
    /CONNECT_ERROR/,
  );
});

test('rejects with TIMEOUT on AbortError', async () => {
  await assert.rejects(
    () => checkHealth({ fetch: abortErrorFetch(), timeoutMs: 100 }),
    /TIMEOUT/,
  );
});

// ── HTTP failures ─────────────────────────────────────────────────────────

test('rejects with HTTP_ERROR on non-2xx response', async () => {
  await assert.rejects(
    () => checkHealth({ fetch: httpFailFetch(503), timeoutMs: 100 }),
    /HTTP_ERROR/,
  );
});

// ── Bad response body ──────────────────────────────────────────────────────

test('rejects with PARSE_ERROR on non-JSON response', async () => {
  await assert.rejects(
    () => checkHealth({ fetch: nonJsonFetch(), timeoutMs: 100 }),
    /PARSE_ERROR/,
  );
});

// ── Configuration checks ──────────────────────────────────────────────────

test('rejects with DEV_MODE when devMode is true', async () => {
  await assert.rejects(
    () => checkHealth({
      fetch: okFetch({ devMode: true, googleClientId: 'cid' }),
      timeoutMs: 100,
    }),
    /DEV_MODE/,
  );
});

test('rejects with NO_CLIENT_ID when googleClientId is empty string', async () => {
  await assert.rejects(
    () => checkHealth({
      fetch: okFetch({ devMode: false, googleClientId: '' }),
      timeoutMs: 100,
    }),
    /NO_CLIENT_ID/,
  );
});

test('rejects with NO_CLIENT_ID when googleClientId is null', async () => {
  await assert.rejects(
    () => checkHealth({
      fetch: okFetch({ devMode: false, googleClientId: null }),
      timeoutMs: 100,
    }),
    /NO_CLIENT_ID/,
  );
});

test('rejects with NO_CLIENT_ID when googleClientId is absent', async () => {
  await assert.rejects(
    () => checkHealth({
      fetch: okFetch({ devMode: false }),
      timeoutMs: 100,
    }),
    /NO_CLIENT_ID/,
  );
});
