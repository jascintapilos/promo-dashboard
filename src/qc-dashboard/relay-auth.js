// BO Relay — HMAC-SHA256 request authentication.
//
// Signs the exact raw request bytes: verification runs BEFORE JSON.parse so a
// tampered body cannot bypass the auth layer via a decoder quirk.
//
// Canonical string:
//     METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256(rawBody)_hex
//
// Headers required on every relay request:
//     X-Relay-Timestamp   unix ms (integer, ±60_000 window)
//     X-Relay-Nonce       ≥ 16 hex chars (32-byte random hex recommended)
//     X-Relay-Signature   64 hex chars (SHA-256 HMAC)
//     X-Relay-Worker      opaque worker id (for heartbeat / logs — non-authoritative)
//
// Invariants (per approval brief §2, §4, §7):
//   - Never auto-generate or print the secret.
//   - Server reads RELAY_SECRET from environment only.
//   - Worker reads RELAY_SECRET from environment OR an external file
//     (%USERPROFILE%\.qc-relay\relay-secret).
//   - Missing → callers treat relay as unavailable (no plaintext leak).
//   - Timing-safe comparison, timestamp skew capped, nonces single-use.
//   - No signature failure reason ever leaks to the wire beyond "unauthorized".

import crypto from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readPersistedSecret } from './relay-secret-store.js';

export const MAX_TIMESTAMP_SKEW_MS = 60_000;
export const NONCE_TTL_MS = 5 * 60_000;
export const NONCE_LRU_SIZE = 10_000;
export const MIN_SECRET_BYTES = 32;
export const MAX_BODY_BYTES = 64 * 1024;
// Raised cap for the ONE promo report-build route (a rebuilt report.json is ~1.4MB
// today; 8MB gives headroom). Chosen per-path by the server; every other relay
// message stays on the 64KB DoS guard above.
export const MAX_REPORT_BUILD_BYTES = 8 * 1024 * 1024;

// ── Secret readers (never log the value) ─────────────────────────────────

// Server-side: env-var first, admin-managed file second. Returns
// { present, secret, reason }. Value never leaks in `reason`.
export function readServerRelaySecret(env = process.env) {
  const raw = env.RELAY_SECRET;
  if (raw) return _validateSecret(raw, 'RELAY_SECRET environment variable');
  const persisted = readPersistedSecret();
  if (persisted.present) return { present: true, secret: persisted.secret, reason: null };
  return { present: false, secret: null, reason: 'RELAY_SECRET env not set and data/relay-secret.local.json missing — rotate a key from the admin panel' };
}

// Worker-side: env var OR external file. Never prints the value.
// External file path is deliberately outside the repo (user profile) so it
// cannot be picked up by `git add`.
export function readWorkerRelaySecret({ env = process.env, home = os.homedir() } = {}) {
  const fromEnv = env.RELAY_SECRET;
  if (fromEnv) return _validateSecret(fromEnv, 'RELAY_SECRET environment variable');
  const file = path.join(home, '.qc-relay', 'relay-secret');
  if (existsSync(file)) {
    let raw = '';
    try { raw = readFileSync(file, 'utf8').trim(); } catch (e) {
      return { present: false, secret: null, reason: `unable to read ${file}` };
    }
    return _validateSecret(raw, file);
  }
  return { present: false, secret: null, reason: 'RELAY_SECRET not set and no ~/.qc-relay/relay-secret file present' };
}

function _validateSecret(raw, sourceLabel) {
  if (!raw) return { present: false, secret: null, reason: `${sourceLabel} is empty` };
  // Accept either raw base64/hex or arbitrary printable strings. Enforce a
  // minimum of MIN_SECRET_BYTES worth of entropy: for hex, that's 64 chars;
  // for base64, that's ceil(32*4/3)=44 chars; for arbitrary, count bytes.
  const buf = Buffer.from(raw, 'utf8');
  if (buf.length < MIN_SECRET_BYTES) {
    return { present: false, secret: null, reason: `${sourceLabel} shorter than ${MIN_SECRET_BYTES} bytes` };
  }
  return { present: true, secret: raw, reason: null };
}

// ── Canonical string + signature ─────────────────────────────────────────

export function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function canonicalString({ method, path: p, timestamp, nonce, bodyHash }) {
  return `${String(method).toUpperCase()}\n${p}\n${timestamp}\n${nonce}\n${bodyHash}`;
}

export function sign({ secret, method, path, timestamp, nonce, bodyBuffer }) {
  if (!secret) throw new Error('sign: secret is required');
  const buf = Buffer.isBuffer(bodyBuffer) ? bodyBuffer : Buffer.from(bodyBuffer || '', 'utf8');
  const bodyHash = sha256Hex(buf);
  const cstr = canonicalString({ method, path, timestamp, nonce, bodyHash });
  return crypto.createHmac('sha256', secret).update(cstr, 'utf8').digest('hex');
}

// Timing-safe comparison of two hex signatures. Returns true only when both
// sides are 64 hex chars AND bytes match. Any short-circuit on length would
// leak length info, but pre-checking length is fine because the ATTACKER's
// input is what varies — the server-computed length is constant.
export function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== 64 || b.length !== 64) return false;
  // Node's Buffer.from(_, 'hex') silently truncates at the first non-hex
  // char, so bufA/bufB would both come out empty for garbage like "zz...".
  // Enforce strict hex first so length-32-byte comparisons are honest.
  if (!/^[0-9a-fA-F]{64}$/.test(a) || !/^[0-9a-fA-F]{64}$/.test(b)) return false;
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return crypto.timingSafeEqual(bufA, bufB);
}

// ── Nonce replay guard (LRU with TTL) ────────────────────────────────────
//
// Kept in-memory on the server. Restart clears it, which is safe: the
// timestamp-skew guard means a replay after > MAX_TIMESTAMP_SKEW_MS is
// already rejected on freshness grounds, and MAX_TIMESTAMP_SKEW_MS <
// NONCE_TTL_MS so restart cannot let an old nonce succeed.

function _makeNonceCache() {
  const cache = new Map(); // nonce → seenAt (unix ms)
  return {
    _cache: cache,
    seen(nonce, now = Date.now()) {
      // Evict expired first.
      if (cache.size > 0) {
        for (const [k, v] of cache) {
          if (now - v > NONCE_TTL_MS) cache.delete(k);
          else break; // Map is insertion-ordered; first non-expired ends the sweep
        }
      }
      if (cache.has(nonce)) return true;
      cache.set(nonce, now);
      if (cache.size > NONCE_LRU_SIZE) {
        const first = cache.keys().next().value;
        cache.delete(first);
      }
      return false;
    },
    _clear() { cache.clear(); },
    _size() { return cache.size; },
  };
}
const _defaultNonces = _makeNonceCache();
export function _clearNonceCacheForTest() { _defaultNonces._clear(); }
export function _nonceCacheSizeForTest() { return _defaultNonces._size(); }

// ── Verifier ─────────────────────────────────────────────────────────────
//
// Input:
//   { method, path, headers, bodyBuffer, secret }
// Returns:
//   { ok: true }
//   { ok: false, code, status }        (status is a suggested HTTP code)
// code: MISSING_HEADERS | BAD_TIMESTAMP | TIMESTAMP_SKEW |
//       BAD_NONCE | REPLAYED_NONCE | BAD_SIGNATURE | NO_SECRET

export function verifySignedRequest({ method, path, headers = {}, bodyBuffer, secret, now = Date.now(), nonces = _defaultNonces } = {}) {
  if (!secret) return { ok: false, code: 'NO_SECRET', status: 503 };
  const h = _lowerHeaders(headers);
  const ts = h['x-relay-timestamp'];
  const nonce = h['x-relay-nonce'];
  const signature = h['x-relay-signature'];
  if (!ts || !nonce || !signature) {
    return { ok: false, code: 'MISSING_HEADERS', status: 401 };
  }
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || !Number.isInteger(tsNum) || tsNum <= 0) {
    return { ok: false, code: 'BAD_TIMESTAMP', status: 401 };
  }
  if (Math.abs(now - tsNum) > MAX_TIMESTAMP_SKEW_MS) {
    return { ok: false, code: 'TIMESTAMP_SKEW', status: 401 };
  }
  if (typeof nonce !== 'string' || nonce.length < 16 || nonce.length > 128 || !/^[A-Za-z0-9_-]+$/.test(nonce)) {
    return { ok: false, code: 'BAD_NONCE', status: 401 };
  }
  // Compute the expected signature BEFORE the replay check so an attacker
  // can't distinguish REPLAY from BAD_SIGNATURE via timing.
  const expected = sign({ secret, method, path, timestamp: tsNum, nonce, bodyBuffer });
  const sigOk = timingSafeEqualHex(expected, String(signature));
  if (!sigOk) return { ok: false, code: 'BAD_SIGNATURE', status: 401 };
  if (nonces.seen(nonce, now)) return { ok: false, code: 'REPLAYED_NONCE', status: 401 };
  return { ok: true };
}

function _lowerHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
  return out;
}

// ── Raw-body reader for Node HTTP handlers ───────────────────────────────

export function readRawBodyBounded(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      total += chunk.length;
      if (total > limit) {
        done = true;
        const err = new Error('body too large');
        err.code = 'BODY_TOO_LARGE';
        err.status = 413;
        // Do NOT destroy the socket — pause reading so send(413) can flush
        // a proper response before the connection closes. Discarding tail
        // chunks means the write path won't queue extra bytes.
        try { req.pause(); } catch {}
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}

// ── Signed-request helper for the VDI worker ─────────────────────────────
//
// Returns { headers, bodyBuffer } — caller does the fetch. Never returns the
// secret. Caps the body at MAX_BODY_BYTES unless the caller explicitly opts into
// a higher `maxBytes` (bulk server-to-server pushes, e.g. promo player data — the
// signing is size-agnostic; the cap is only a client-side sanity guard, and the
// receiving endpoint bounds its own read independently).

export function buildSignedHeaders({ method, path, bodyBuffer, secret, workerId, now = Date.now(), maxBytes = MAX_BODY_BYTES }) {
  if (!secret) throw new Error('buildSignedHeaders: secret required');
  const buf = Buffer.isBuffer(bodyBuffer) ? bodyBuffer : Buffer.from(bodyBuffer || '', 'utf8');
  if (buf.length > maxBytes) throw new Error(`buildSignedHeaders: body exceeds ${maxBytes}`);
  const timestamp = now;
  const nonce = crypto.randomBytes(16).toString('hex');
  const signature = sign({ secret, method, path, timestamp, nonce, bodyBuffer: buf });
  const headers = {
    'content-type': 'application/json',
    'x-relay-timestamp': String(timestamp),
    'x-relay-nonce': nonce,
    'x-relay-signature': signature,
  };
  if (workerId) headers['x-relay-worker'] = String(workerId).slice(0, 64);
  return { headers, bodyBuffer: buf };
}
