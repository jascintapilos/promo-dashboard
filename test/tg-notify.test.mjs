// Regression tests for src/tg-notify.js — sendTelegramMessage().
// All tests use injected fetch — no live Telegram API calls.
//
// Critical property: token, URL, chatId, and external body.description
// must NEVER appear in thrown error messages.
//
// Run: node test/tg-notify.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendTelegramMessage } from '../src/tg-notify.js';

const VALID_CONFIG = { token: 'secret-bot-token', chatId: '-1234567890' };

// ── Fake fetch builders ────────────────────────────────────────────────────

function okFetch() {
  return (_url, _opts) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: { message_id: 1 } }) });
}

function connectErrorFetch(msg = 'ECONNREFUSED') {
  return (_url, _opts) => Promise.reject(new Error(msg));
}

function httpFailFetch(status = 400) {
  return (_url, _opts) =>
    Promise.resolve({ ok: false, status, json: () => Promise.resolve({}) });
}

function nonJsonFetch() {
  return (_url, _opts) =>
    Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError('Unexpected token')) });
}

function tgFailFetch(description = '') {
  return (_url, _opts) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false, description }) });
}

// ── Success ────────────────────────────────────────────────────────────────

test('sendTelegramMessage — success resolves without throwing', async () => {
  const result = await sendTelegramMessage('hello', { fetch: okFetch(), botConfig: VALID_CONFIG });
  assert.equal(result, undefined, 'should resolve to undefined on success');
});

// ── Config validation ─────────────────────────────────────────────────────

test('null botConfig throws CONFIG_ERROR', async () => {
  await assert.rejects(
    () => sendTelegramMessage('x', { fetch: okFetch(), botConfig: null }),
    /CONFIG_ERROR/,
  );
});

test('missing token throws CONFIG_ERROR', async () => {
  await assert.rejects(
    () => sendTelegramMessage('x', { fetch: okFetch(), botConfig: { chatId: '-1' } }),
    /CONFIG_ERROR/,
  );
});

test('missing chatId throws CONFIG_ERROR', async () => {
  await assert.rejects(
    () => sendTelegramMessage('x', { fetch: okFetch(), botConfig: { token: 't' } }),
    /CONFIG_ERROR/,
  );
});

// ── Network & HTTP failures ────────────────────────────────────────────────

test('network error throws SEND_FAILED', async () => {
  await assert.rejects(
    () => sendTelegramMessage('x', { fetch: connectErrorFetch(), botConfig: VALID_CONFIG }),
    /SEND_FAILED/,
  );
});

test('HTTP 400 throws HTTP_ERROR', async () => {
  await assert.rejects(
    () => sendTelegramMessage('x', { fetch: httpFailFetch(400), botConfig: VALID_CONFIG }),
    /HTTP_ERROR/,
  );
});

test('HTTP 500 throws HTTP_ERROR', async () => {
  await assert.rejects(
    () => sendTelegramMessage('x', { fetch: httpFailFetch(500), botConfig: VALID_CONFIG }),
    /HTTP_ERROR/,
  );
});

test('non-JSON response throws PARSE_ERROR', async () => {
  await assert.rejects(
    () => sendTelegramMessage('x', { fetch: nonJsonFetch(), botConfig: VALID_CONFIG }),
    /PARSE_ERROR/,
  );
});

test('Telegram ok:false throws SEND_FAILED', async () => {
  await assert.rejects(
    () => sendTelegramMessage('x', { fetch: tgFailFetch(), botConfig: VALID_CONFIG }),
    /SEND_FAILED/,
  );
});

// ── Secret leakage guards ──────────────────────────────────────────────────

test('bot token does NOT appear in SEND_FAILED error message', async () => {
  const token = 'very-secret-bot-token-12345';
  let caught;
  try {
    await sendTelegramMessage('x', { fetch: connectErrorFetch(), botConfig: { token, chatId: '-1' } });
  } catch (e) { caught = e; }
  assert.ok(caught, 'should have thrown');
  assert.ok(!caught.message.includes(token), `token must not appear in: "${caught.message}"`);
});

test('bot token does NOT appear in HTTP_ERROR message', async () => {
  const token = 'another-secret-token-67890';
  let caught;
  try {
    await sendTelegramMessage('x', { fetch: httpFailFetch(403), botConfig: { token, chatId: '-1' } });
  } catch (e) { caught = e; }
  assert.ok(caught, 'should have thrown');
  assert.ok(!caught.message.includes(token), `token must not appear in: "${caught.message}"`);
});

test('Telegram body.description does NOT appear in SEND_FAILED error', async () => {
  const secretDescription = 'chat_not_found with token xyz987';
  let caught;
  try {
    await sendTelegramMessage('x', { fetch: tgFailFetch(secretDescription), botConfig: VALID_CONFIG });
  } catch (e) { caught = e; }
  assert.ok(caught, 'should have thrown');
  assert.ok(!caught.message.includes(secretDescription), `description must not appear in: "${caught.message}"`);
});

test('api.telegram.org URL does NOT appear in any error message', async () => {
  let caught;
  try {
    await sendTelegramMessage('x', { fetch: connectErrorFetch(), botConfig: VALID_CONFIG });
  } catch (e) { caught = e; }
  assert.ok(caught, 'should have thrown');
  assert.ok(!caught.message.includes('api.telegram.org'), `URL host must not appear in: "${caught.message}"`);
  assert.ok(!caught.message.includes('https://'), `URL scheme must not appear in: "${caught.message}"`);
});
