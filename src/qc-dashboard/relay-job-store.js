// BO Relay — server-side job store.
//
// Job lifecycle (§5 of the correction brief):
//   QUEUED → LEASED (worker holds it) → COMPLETED  (result submitted + verified)
//   QUEUED → EXPIRED                                (TTL passed with no worker)
//   LEASED → EXPIRED                                (lease TTL passed, no result)
//
// Server-restart or lost in-memory job → GET returns "expired-or-lost" so the
// browser resolves to MANUAL_REQUIRED. Never PASS by default.
//
// Ownership binding (§3):
//   Every job carries requestedBy (session email). GET /api/qc-jobs/:jobId
//   verifies session.email === job.requestedBy OR session.role === 'admin'.
//   The store enforces this at the read boundary.
//
// Immutability of job identity (§5): after createJob, brand/code/handle
// cannot change. Result submissions from the relay MUST match those fields
// before the store accepts them.
//
// All timestamps are unix ms. All ids are opaque; treat them as sensitive.

import crypto from 'node:crypto';

export const DEFAULT_JOB_TTL_MS = 2 * 60_000;    // 2 minutes
export const DEFAULT_LEASE_TTL_MS = 60_000;      // 1 minute lease window
export const MAX_JOBS = 4096;

export const JOB_STATUS = Object.freeze({
  QUEUED: 'QUEUED',
  LEASED: 'LEASED',
  COMPLETED: 'COMPLETED',
  EXPIRED: 'EXPIRED',
});

function _newJobStore() {
  const jobs = new Map(); // jobId → job
  return {
    _jobs: jobs,
    createJob({ brand, code, handle = null, requestedBy, now = Date.now(), ttlMs = DEFAULT_JOB_TTL_MS }) {
      if (!brand || !code) throw new Error('createJob: brand and code required');
      if (!requestedBy) throw new Error('createJob: requestedBy required');
      _prune(jobs, now);
      if (jobs.size >= MAX_JOBS) {
        // Evict oldest by insertion order — cheap and safe: an evicted job
        // will just resolve to "expired-or-lost" for the client.
        const first = jobs.keys().next().value;
        if (first) jobs.delete(first);
      }
      const jobId = `qcj_${crypto.randomBytes(12).toString('base64url')}`;
      const job = {
        jobId,
        brand: String(brand).toUpperCase(),
        code: String(code).toUpperCase(),
        handle: handle || null,
        requestedBy: String(requestedBy),
        status: JOB_STATUS.QUEUED,
        createdAt: now,
        expiresAt: now + ttlMs,
        leasedBy: null,
        leasedAt: null,
        leaseExpiresAt: null,
        result: null,       // set on COMPLETED
        finalRunId: null,   // set when the run-store records the verdict
      };
      jobs.set(jobId, job);
      return job;
    },

    // Lease up to `limit` jobs for one worker. Only QUEUED (or LEASED-but-
    // expired-lease) jobs are eligible. Returns *safe* snapshots to the
    // worker: never leaks requestedBy in the leased payload the worker sees.
    leaseJobs({ workerId, limit = 5, now = Date.now(), leaseTtlMs = DEFAULT_LEASE_TTL_MS }) {
      if (!workerId) throw new Error('leaseJobs: workerId required');
      _prune(jobs, now);
      const leased = [];
      for (const job of jobs.values()) {
        if (leased.length >= limit) break;
        const eligible =
          job.status === JOB_STATUS.QUEUED
          || (job.status === JOB_STATUS.LEASED && job.leaseExpiresAt != null && now > job.leaseExpiresAt);
        if (!eligible) continue;
        job.status = JOB_STATUS.LEASED;
        job.leasedBy = String(workerId).slice(0, 64);
        job.leasedAt = now;
        job.leaseExpiresAt = now + leaseTtlMs;
        leased.push({
          jobId: job.jobId,
          brand: job.brand,
          code: job.code,
          handle: job.handle,
          leaseExpiresAt: job.leaseExpiresAt,
          // NOTE: no requestedBy — the worker doesn't need it and shouldn't
          // learn who scheduled the job.
        });
      }
      return leased;
    },

    // Idempotent result submission. Verifies job identity matches (brand,
    // code, handle) so a compromised worker cannot submit a result for a
    // job whose fields it altered.
    submitResult({ jobId, brand, code, handle, workerId, verdictBundle, now = Date.now() }) {
      const job = jobs.get(jobId);
      if (!job) return { ok: false, code: 'UNKNOWN_JOB' };
      if (job.status === JOB_STATUS.COMPLETED) {
        // Idempotent: return the stored result unchanged. Never overwrite.
        return { ok: true, alreadyComplete: true, job };
      }
      if (job.status === JOB_STATUS.EXPIRED || now > job.expiresAt) {
        job.status = JOB_STATUS.EXPIRED;
        return { ok: false, code: 'EXPIRED' };
      }
      if (job.status !== JOB_STATUS.LEASED) {
        return { ok: false, code: 'NOT_LEASED' };
      }
      if (workerId && job.leasedBy && String(workerId) !== job.leasedBy) {
        return { ok: false, code: 'WRONG_LESSEE' };
      }
      const bU = String(brand || '').toUpperCase();
      const cU = String(code || '').toUpperCase();
      const hV = handle || null;
      if (bU !== job.brand) return { ok: false, code: 'BRAND_MISMATCH' };
      if (cU !== job.code) return { ok: false, code: 'CODE_MISMATCH' };
      if ((hV || null) !== (job.handle || null)) return { ok: false, code: 'HANDLE_MISMATCH' };
      job.status = JOB_STATUS.COMPLETED;
      job.result = verdictBundle || null;
      return { ok: true, alreadyComplete: false, job };
    },

    // Attach the runId issued by the run-store after the server derived the
    // official verdict. This is what the MANUAL_PASS override endpoint
    // requires — the browser sees this runId, not any earlier placeholder.
    attachFinalRunId(jobId, runId) {
      const job = jobs.get(jobId);
      if (!job) return false;
      job.finalRunId = runId || null;
      return true;
    },

    // Ownership-checked read. Returns the safe shape the browser sees.
    getForUser({ jobId, user, now = Date.now() }) {
      if (!user?.email) return { ok: false, code: 'UNAUTHORIZED' };
      const job = jobs.get(jobId);
      if (!job) return { ok: false, code: 'NOT_FOUND' };
      const isAdmin = user.role === 'admin';
      if (!isAdmin && job.requestedBy.toLowerCase() !== user.email.toLowerCase()) {
        // Deliberately return NOT_FOUND (not FORBIDDEN) to prevent id-guessing
        // enumeration by a non-admin.
        return { ok: false, code: 'NOT_FOUND' };
      }
      // Materialize expiry lazily on read.
      if (job.status !== JOB_STATUS.COMPLETED && now > job.expiresAt) {
        job.status = JOB_STATUS.EXPIRED;
      }
      return { ok: true, job };
    },

    // Test/admin surfaces. Never expose these to the network.
    _sizeForTest() { return jobs.size; },
    _clearForTest() { jobs.clear(); },
    _peekForTest(jobId) { return jobs.get(jobId) || null; },
    _forceExpireForTest(jobId) { const j = jobs.get(jobId); if (j) { j.expiresAt = 0; j.status = JOB_STATUS.EXPIRED; } },

    // Admin-only view (for the /api/relay/health endpoint). Never returns
    // requestedBy or job payload details; just aggregate counts.
    counts(now = Date.now()) {
      _prune(jobs, now);
      const acc = { total: jobs.size, queued: 0, leased: 0, completed: 0, expired: 0 };
      for (const j of jobs.values()) {
        if (j.status === JOB_STATUS.QUEUED) acc.queued++;
        else if (j.status === JOB_STATUS.LEASED) acc.leased++;
        else if (j.status === JOB_STATUS.COMPLETED) acc.completed++;
        else if (j.status === JOB_STATUS.EXPIRED) acc.expired++;
      }
      return acc;
    },
  };
}

function _prune(jobs, now) {
  for (const [id, j] of jobs) {
    if (j.status === JOB_STATUS.COMPLETED) continue;      // keep for the client's next poll
    if (now > j.expiresAt) j.status = JOB_STATUS.EXPIRED;
    // GC completed/expired only after ~10 min so late polls still see them.
    if ((j.status === JOB_STATUS.COMPLETED || j.status === JOB_STATUS.EXPIRED)
        && now - j.expiresAt > 10 * 60_000) {
      jobs.delete(id);
    }
  }
}

const _defaultStore = _newJobStore();
export const relayJobStore = _defaultStore;
export const _newJobStoreForTest = _newJobStore;

// ── Safe projections ─────────────────────────────────────────────────────
// Never send raw job objects over the wire — always project through one of
// these so no code path accidentally returns internal fields.

export function safeJobForClient(job) {
  if (!job) return null;
  return {
    jobId: job.jobId,
    brand: job.brand,
    code: job.code,
    handle: job.handle,
    status: job.status,
    createdAt: job.createdAt,
    expiresAt: job.expiresAt,
    finalRunId: job.finalRunId,
    // Only include the result when COMPLETED — never the intermediate state.
    result: job.status === JOB_STATUS.COMPLETED ? job.result : null,
  };
}
