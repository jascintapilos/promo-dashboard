// Promo Codes feed key — a dedicated, admin-managed secret for the ONE route
// POST /api/promo-codes/snapshot (the VDI's daily code-list upload).
//
// Deliberately separate from the QC relay secret (relay-secret-store.js): that
// one can lease QC jobs and submit QC verdicts; this one can only replace the
// Promo Codes snapshot. Rotating this key cuts off the uploader and touches
// nothing QC (no job-store / heartbeat / nonce invalidation hooks).
//
// Server side (precedence, same shape as the relay store):
//   1. PROMO_CODES_FEED_SECRET environment variable  (IT-managed override)
//   2. data/promo-codes-feed-secret.local.json:secret  (admin-managed, gitignored)
// Uploader side: PROMO_CODES_FEED_SECRET env, else %USERPROFILE%\.qc-relay\promo-codes-secret.
// It never reads the relay-secret file.
//
// The value is generated with crypto.randomBytes(32) (64 hex chars), written
// atomically with 0600 where the FS honours it, returned to the admin ONCE by
// the rotate route, and never logged or returned by any status call.
// See docs/plans/promo-codes-feed-key.md.

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { readServerRelaySecret } from './relay-auth.js';

const MIN_BYTES = 32;
const ENV_KEY = 'PROMO_CODES_FEED_SECRET';
const defaultFile = (env = process.env) => env.PROMO_CODES_FEED_SECRET_FILE || path.resolve('data', 'promo-codes-feed-secret.local.json');
const longEnough = (s) => typeof s === 'string' && Buffer.byteLength(s, 'utf8') >= MIN_BYTES;

// The feed key must never equal the QC relay secret — if it somehow does, the
// feed fails closed (treated as not configured) rather than sharing a key.
function sameAsRelaySecret(secret, env) {
  const relay = readServerRelaySecret(env);
  if (!relay.present) return false;
  const a = Buffer.from(String(secret), 'utf8');
  const b = Buffer.from(String(relay.secret), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readPersisted(file) {
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!longEnough(parsed?.secret)) return null;
    return { secret: parsed.secret, rotatedAt: parsed.rotatedAt || null, rotatedBy: parsed.rotatedBy || null };
  } catch { return null; }
}

// The value the snapshot route verifies against, or null (→ 503).
export function readEffectiveFeedSecret({ env = process.env, file = defaultFile(env) } = {}) {
  const secret = longEnough(env[ENV_KEY]) ? env[ENV_KEY] : readPersisted(file)?.secret || null;
  if (!secret || sameAsRelaySecret(secret, env)) return null;
  return secret;
}

// Public status — never carries the value.
export function readFeedStatus({ env = process.env, file = defaultFile(env) } = {}) {
  const fromEnv = longEnough(env[ENV_KEY]);
  const persisted = fromEnv ? null : readPersisted(file);
  const secret = fromEnv ? env[ENV_KEY] : persisted?.secret;
  if (!secret) return { configured: false, source: null, lastRotatedAt: null, lastRotatedBy: null };
  if (sameAsRelaySecret(secret, env)) {
    return { configured: false, source: fromEnv ? 'env' : 'file', lastRotatedAt: null, lastRotatedBy: null, problem: 'matches the QC relay secret — rotate it' };
  }
  return { configured: true, source: fromEnv ? 'env' : 'file', lastRotatedAt: persisted?.rotatedAt || null, lastRotatedBy: persisted?.rotatedBy || null };
}

// Generates a fresh key, writes it atomically, returns it ONCE. The caller must
// send cache-control: no-store and never log the value.
export function rotateFeedSecret({ actorEmail, env = process.env, file = defaultFile(env), now = new Date() } = {}) {
  if (!actorEmail || typeof actorEmail !== 'string') throw new Error('rotateFeedSecret: actorEmail required');
  if (longEnough(env[ENV_KEY])) {
    const err = new Error(`${ENV_KEY} is externally managed via environment; rotate at the source (or unset it to switch to admin-managed).`);
    err.code = 'EXTERNALLY_MANAGED';
    throw err;
  }
  let secret;
  do { secret = crypto.randomBytes(32).toString('hex'); } while (sameAsRelaySecret(secret, env));
  const payload = { secret, rotatedAt: now.toISOString(), rotatedBy: String(actorEmail).slice(0, 200) };
  const dir = path.dirname(file);
  try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); } catch {}
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmp, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { chmodSync(tmp, 0o600); } catch {}
    renameSync(tmp, file);
    try { chmodSync(file, 0o600); } catch {}
  } catch (e) {
    try { unlinkSync(tmp); } catch {}
    throw e;
  }
  return payload;
}

// Uploader (VDI) side. Returns { present, secret, reason } — reason never carries the value.
export function readUploaderFeedSecret({ env = process.env, home = os.homedir() } = {}) {
  if (env[ENV_KEY]) {
    return longEnough(env[ENV_KEY]) ? { present: true, secret: env[ENV_KEY], reason: null }
      : { present: false, secret: null, reason: `${ENV_KEY} shorter than ${MIN_BYTES} bytes` };
  }
  const file = path.join(home, '.qc-relay', 'promo-codes-secret');
  if (!existsSync(file)) return { present: false, secret: null, reason: `no ${file} — an admin generates it at /admin/promo-codes-key` };
  let raw = '';
  try { raw = readFileSync(file, 'utf8').trim(); } catch { return { present: false, secret: null, reason: `unable to read ${file}` }; }
  return longEnough(raw) ? { present: true, secret: raw, reason: null }
    : { present: false, secret: null, reason: `${file} shorter than ${MIN_BYTES} bytes` };
}
