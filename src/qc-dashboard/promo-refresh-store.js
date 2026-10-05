// Promo report refresh — durable single-flight job store (Phase 2 of the WS1
// Promo Effectiveness refresh button).
//
// ONE active refresh at a time (single-flight). File-backed so it survives a
// server restart; crash-safe via atomic temp->rename writes and a parse-guarded
// reader (a corrupt/truncated file reads as "no active job" and self-heals, never
// throws). WS1 only for now.
//
// Decision D3 (verified best): a DEDICATED store, NOT the QC relay job store —
// that one is in-memory (lost on restart), has a 2-min TTL (would expire mid-pull),
// and is wiped by the relay-secret rotation hook.
//
// Persistence file: data/promo/promo-refresh-state.local.json — the *.local.json
// pattern is already gitignored, so the requester's email never lands in the repo.
//
// TOCTOU: request() is fully synchronous (readFileSync -> writeFileSync/rename),
// so two near-simultaneous clicks are serialized by the single-threaded event loop
// — the second read sees the first's write and returns the same job. The on-disk
// file is the sole source of truth (authoritative across restarts).

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_FILE = process.env.PROMO_REFRESH_STATE_FILE
  || path.resolve('data', 'promo', 'promo-refresh-state.local.json');

export const LEASE_TTL_MS = 3 * 60 * 1000;      // worker must heartbeat within 3 min or the lease is reclaimable
export const HARD_TIMEOUT_MS = 20 * 60 * 1000;  // a job older than this is force-failed so single-flight can't wedge
const ACTIVE = new Set(['QUEUED', 'LEASED', 'BUILDING']);

// Strip filesystem paths and long hex tokens/ids from any error string before it
// is persisted or shown — no server paths, no secrets, no member ids.
export function sanitizeError(e) {
  let m = (e && e.message) ? String(e.message) : String(e == null ? 'unknown error' : e);
  m = m.replace(/[A-Za-z]:\\[^\s'"]+/g, '<path>');     // windows paths
  m = m.replace(/(?:\/[^\s/'"]+){2,}/g, '<path>');      // posix paths
  m = m.replace(/[0-9a-f]{24,}/gi, '<redacted>');       // hex secrets / long ids
  return m.slice(0, 300);
}

// Guarded read — a missing/corrupt/truncated file is "no active job", never a throw.
function readState(file) {
  if (!existsSync(file)) return null;
  let raw; try { raw = readFileSync(file, 'utf8'); } catch { return null; }
  let j;   try { j = JSON.parse(raw); } catch { return null; }
  return (j && typeof j === 'object') ? j : null;
}

// Atomic write — temp file then rename, so a crash mid-write can never truncate
// the live state file (clones relay-secret-store.js).
function writeState(file, job) {
  const dir = path.dirname(file);
  try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); } catch {}
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmp, JSON.stringify(job, null, 2), 'utf8');
    renameSync(tmp, file);
  } catch (e) { try { unlinkSync(tmp); } catch {} throw e; }
}

// Is this persisted job still "live" for single-flight? A job past the hard
// timeout is treated as dead (frees the slot) even if its status still says active.
function isLive(job, nowMs) {
  if (!job || !ACTIVE.has(job.status)) return false;
  const created = Date.parse(job.createdAt || '') || 0;
  return (nowMs - created) <= HARD_TIMEOUT_MS;
}

// Safe projection for a status reader — never carries another requester's email.
function safe(job) {
  return {
    jobId: job.jobId, status: job.status, progress: job.progress || null,
    builtAt: job.builtAt || null, error: job.error || null, market: job.market,
  };
}

export function makeStore({ file = DEFAULT_FILE } = {}) {
  return {
    // Single-flight: return the live job if one exists, else create a QUEUED one.
    request({ market, requestedBy, requestedRole, now = new Date() } = {}) {
      const nowMs = now.getTime();
      const cur = readState(file);
      if (isLive(cur, nowMs)) return { job: safe(cur), created: false };
      const job = {
        jobId: crypto.randomUUID(),
        brand: 'WS1', market: market || 'MY',
        status: 'QUEUED',
        requestedBy: requestedBy || null,
        requestedRole: requestedRole || null,
        createdAt: now.toISOString(),
        leasedAt: null, leaseExpiresAt: null, heartbeatAt: null, workerId: null,
        progress: null, asOf: null, builtAt: null, error: null, failedAt: null,
        // carry forward the last completion so the UI can still show "last built"
        lastCompletedAt: (cur && cur.lastCompletedAt) || null,
        lastBuiltAt: (cur && cur.lastBuiltAt) || null,
      };
      writeState(file, job);
      return { job: safe(job), created: true };
    },

    // Worker claims a QUEUED job, or re-claims one whose lease expired (dead worker).
    lease({ workerId, now = new Date() } = {}) {
      const nowMs = now.getTime();
      const cur = readState(file);
      if (!isLive(cur, nowMs)) return { job: null };
      if (cur.status === 'LEASED' || cur.status === 'BUILDING') {
        const exp = Date.parse(cur.leaseExpiresAt || '') || 0;
        if (nowMs < exp) return { job: null };   // a fresh lease is held by a live worker
      }
      cur.status = 'LEASED';
      cur.workerId = workerId || null;
      cur.leasedAt = now.toISOString();
      cur.leaseExpiresAt = new Date(nowMs + LEASE_TTL_MS).toISOString();
      writeState(file, cur);
      return { job: { jobId: cur.jobId, market: cur.market } };
    },

    heartbeat({ jobId, progress, now = new Date() } = {}) {
      const nowMs = now.getTime();
      const cur = readState(file);
      if (!cur || cur.jobId !== jobId) return { ok: false };
      cur.status = 'BUILDING';
      cur.heartbeatAt = now.toISOString();
      cur.leaseExpiresAt = new Date(nowMs + LEASE_TTL_MS).toISOString();
      if (progress != null) cur.progress = String(progress).slice(0, 200);
      writeState(file, cur);
      return { ok: true };
    },

    complete({ jobId, asOf = null, builtAt = null, now = new Date() } = {}) {
      const cur = readState(file);
      if (!cur || cur.jobId !== jobId) return { ok: false };
      cur.status = 'COMPLETED';
      cur.asOf = asOf;
      cur.builtAt = builtAt || now.toISOString();
      cur.progress = 'done';
      cur.lastCompletedAt = now.toISOString();
      cur.lastBuiltAt = cur.builtAt;
      writeState(file, cur);
      return { ok: true };
    },

    fail({ jobId, error, now = new Date() } = {}) {
      const cur = readState(file);
      if (!cur || cur.jobId !== jobId) return { ok: false };
      cur.status = 'FAILED';
      cur.error = sanitizeError(error);
      cur.failedAt = now.toISOString();
      writeState(file, cur);
      return { ok: true };
    },

    // Safe status for a signed-in viewer. A timed-out active job reads as FAILED.
    getForUser({ user, now = new Date() } = {}) {
      const cur = readState(file);
      if (!cur) return { status: 'IDLE', progress: null, builtAt: null, error: null, lastBuiltAt: null, lastCompletedAt: null, mine: false };
      const nowMs = now.getTime();
      const timedOut = ACTIVE.has(cur.status) && !isLive(cur, nowMs);
      return {
        jobId: cur.jobId,
        status: timedOut ? 'FAILED' : cur.status,
        progress: cur.progress || null,
        builtAt: cur.builtAt || null,
        error: timedOut ? 'refresh timed out' : (cur.error || null),
        lastBuiltAt: cur.lastBuiltAt || null,
        lastCompletedAt: cur.lastCompletedAt || null,
        mine: !!(user && cur.requestedBy && user === cur.requestedBy),
      };
    },

    // Epoch ms of the last COMPLETED build (for the staleness gate), or null.
    lastCompletedAt() {
      const cur = readState(file);
      return (cur && cur.lastCompletedAt) ? (Date.parse(cur.lastCompletedAt) || null) : null;
    },

    _readRaw() { return readState(file); },   // test helper only
  };
}

export const promoRefreshStore = makeStore();
export default promoRefreshStore;
