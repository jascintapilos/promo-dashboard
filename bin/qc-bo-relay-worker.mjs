#!/usr/bin/env node
// BO Relay worker — runs on the whitelisted VDI. Long-poll loop that leases
// pending jobs from the company Hub, retrieves live BO evidence through the
// existing readonly BO clients, and returns the normalized canonicals
// (never raw cookies, tokens, paths, or auth error bodies).
//
// Correction brief compliance:
//   §2  RELAY_SECRET read from env or ~/.qc-relay/relay-secret. Never printed.
//   §3  Job identity + owner are enforced by the company server; the worker
//       never learns requestedBy.
//   §4  Every request is HMAC-signed over raw bytes (relay-auth.js).
//   §5  Batches up to 5 jobs per lease. Idempotent result submission.
//   §6  Only sanitized canonicals + safe source metadata leave the VDI.
//   §7  Graceful shutdown (SIGINT/SIGTERM). Bounded backoff. Structured
//       logs contain only jobId + brand + status — never promo secrets.

import { readWorkerRelaySecret, buildSignedHeaders } from '../src/qc-dashboard/relay-auth.js';
import { fetchPromoSnapshot } from '../src/qc-dashboard/fetch-promo.js';
import { resolveExpectedSource } from '../src/qc-dashboard/expected-source.js';
import { snapshotToLiveState } from '../src/qc-dashboard/compare-flow.js';
import { expectedFromSource, liveFromPlatform } from '../src/qc-dashboard/canonical/index.js';
import { sanitizeCanonical, sanitizeExpectedSourceMeta } from '../src/qc-dashboard/relay-result.js';

const HUB_URL = process.env.QC_HUB_URL || 'http://localhost:4321';
const WORKER_ID = process.env.QC_RELAY_WORKER_ID || `vdi-${process.pid}`;
const WORKER_VERSION = 'qc-bo-relay/1.0';
const POLL_MIN_MS = Number(process.env.QC_RELAY_POLL_MIN_MS || 2000);
const POLL_MAX_MS = Number(process.env.QC_RELAY_POLL_MAX_MS || 10_000);
const MAX_JOBS_PER_LEASE = 5;

// ── Structured logger: jobId + brand + status only, no promo secrets ────
function log(level, event, extra = {}) {
  const safe = { ts: new Date().toISOString(), level, event, workerId: WORKER_ID };
  for (const k of ['jobId', 'brand', 'code', 'status', 'reason', 'httpStatus', 'nextDelayMs']) {
    if (extra[k] != null) safe[k] = String(extra[k]).slice(0, 128);
  }
  try { console.log(JSON.stringify(safe)); } catch { /* stdio closed on shutdown */ }
}

// ── Poll loop with bounded backoff ─────────────────────────────────────

let shuttingDown = false;
let inFlight = false;
let currentDelay = POLL_MIN_MS;

function scheduleNext(delayMs) {
  if (shuttingDown) return;
  const d = Math.min(POLL_MAX_MS, Math.max(POLL_MIN_MS, delayMs));
  currentDelay = d;
  setTimeout(tick, d);
}

async function tick({ deps = defaultDeps, noSchedule = false } = {}) {
  if (shuttingDown || inFlight) return;
  inFlight = true;
  try {
    const leased = await deps.leaseJobs();
    if (!leased || leased.length === 0) {
      // Idle: back off up to POLL_MAX_MS.
      const nextDelay = Math.min(POLL_MAX_MS, Math.floor(currentDelay * 1.5));
      if (noSchedule) currentDelay = Math.min(POLL_MAX_MS, Math.max(POLL_MIN_MS, nextDelay));
      else scheduleNext(nextDelay);
      return;
    }
    // Active: process each job serially so we don't overwhelm BO. Reset the
    // backoff so the next poll happens quickly when work resumes.
    for (const job of leased) {
      if (shuttingDown) break;
      await processJob(job, deps);
    }
    if (noSchedule) currentDelay = POLL_MIN_MS;
    else scheduleNext(POLL_MIN_MS);
  } catch (e) {
    // Never crash the loop on a transient hub / network hiccup.
    log('warn', 'poll-error', { reason: sanitizeError(e) });
    const nextDelay = Math.min(POLL_MAX_MS, Math.floor(currentDelay * 2));
    if (noSchedule) currentDelay = Math.min(POLL_MAX_MS, Math.max(POLL_MIN_MS, nextDelay));
    else scheduleNext(nextDelay);
  } finally {
    inFlight = false;
  }
}

async function processJob(job, deps) {
  const { jobId, brand, code, handle } = job;
  log('info', 'job-start', { jobId, brand, code, status: 'leased' });
  const result = await buildResultForJob({ jobId, brand, code, handle, deps });
  const submit = await deps.submitResult({ jobId, brand, code, handle, result });
  log('info', 'job-submit', { jobId, brand, code, httpStatus: submit.status, status: 'submitted' });
}

// buildResultForJob is exported for tests; it never touches the network.
export async function buildResultForJob({ jobId, brand, code, handle, deps = defaultDeps }) {
  // 1. Live BO fetch.
  let snapshot;
  try {
    snapshot = await deps.fetchPromoSnapshot({ brand, code });
  } catch (e) {
    return _errorPayload({ jobId, brand, code, handle, workerError: { code: 'INTERNAL', message: sanitizeError(e) } });
  }
  if (snapshot?.error === 'BO unreachable') {
    return _errorPayload({ jobId, brand, code, handle, workerError: { code: 'BO_UNREACHABLE', message: 'live BO probe failed' } });
  }
  if (snapshot?.notFound) {
    return _errorPayload({ jobId, brand, code, handle, workerError: { code: 'CODE_NOT_FOUND', message: 'promo code not present on live BO' } });
  }
  // 2. Expected source.
  let expSrc;
  try {
    expSrc = deps.resolveExpectedSource({ brand, code, handle });
  } catch (e) {
    return _errorPayload({ jobId, brand, code, handle, workerError: { code: 'INTERNAL', message: sanitizeError(e) } });
  }
  if (!expSrc || !expSrc.source) {
    const errCode = expSrc?.sourceType === 'ambiguous' ? 'EXPECTED_SOURCE_AMBIGUOUS' : 'EXPECTED_SOURCE_MISSING';
    return _errorPayload({ jobId, brand, code, handle, workerError: { code: errCode, message: expSrc?.reason || 'expected source could not be resolved unambiguously' } });
  }
  // 3. Normalize both sides.
  const platform = snapshot?.runtime?.platform || null;
  const siteId = snapshot?.runtime?.siteId || null;
  let expectedCanonical, actualCanonical;
  try {
    expectedCanonical = deps.expectedFromSource(expSrc.source, {
      brand,
      promoCode: expSrc.promoCode || code,
      promotionId: expSrc.promotionId || null,
      platform,
      siteId,
    });
    const liveState = deps.snapshotToLiveState(snapshot, platform);
    if (!liveState) throw new Error('unable to project live snapshot');
    actualCanonical = deps.liveFromPlatform(platform, liveState, { brand, promoCode: code, siteId });
  } catch (e) {
    return _errorPayload({ jobId, brand, code, handle, workerError: { code: 'INTERNAL', message: sanitizeError(e) } });
  }
  // 4. Return sanitized shape. sanitize* is defense-in-depth even though we
  //    just built these ourselves — filters against future adapter drift.
  return {
    jobId, brand, code, handle,
    platform, siteId,
    expectedCanonical: sanitizeCanonical(expectedCanonical),
    actualCanonical: sanitizeCanonical(actualCanonical),
    expectedSourceMeta: sanitizeExpectedSourceMeta({
      sourceType: expSrc.sourceType, sourceId: expSrc.sourceId,
      sourceTs: expSrc.sourceTs, approvalStatus: expSrc.approvalStatus,
      handle: expSrc.handle, promoCode: expSrc.promoCode, brand: expSrc.brand,
    }),
    workerError: null,
  };
}

function _errorPayload({ jobId, brand, code, handle, workerError }) {
  return {
    jobId, brand, code, handle,
    expectedCanonical: null, actualCanonical: null, expectedSourceMeta: null,
    workerError,
  };
}

// ── HTTP helpers (signed) ──────────────────────────────────────────────

async function httpSignedRequest({ method, path, body = '', secret, workerId }) {
  const buf = Buffer.from(body, 'utf8');
  const { headers } = buildSignedHeaders({ method, path, bodyBuffer: buf, secret, workerId });
  const resp = await fetch(`${HUB_URL}${path}`, {
    method, headers, body: buf.length ? buf : undefined,
  });
  const text = await resp.text().catch(() => '');
  return { status: resp.status, text };
}

// Default deps: real network + real modules. Tests override each.
const defaultDeps = {
  leaseJobs: async () => {
    const body = JSON.stringify({ workerVersion: WORKER_VERSION, limit: MAX_JOBS_PER_LEASE });
    const r = await httpSignedRequest({ method: 'POST', path: '/api/relay/jobs/lease', body, secret: RELAY_SECRET, workerId: WORKER_ID });
    if (r.status !== 200) { log('warn', 'lease-non-200', { httpStatus: r.status }); return []; }
    try { return JSON.parse(r.text).jobs || []; } catch { return []; }
  },
  submitResult: async ({ jobId, result }) => {
    const body = JSON.stringify(result);
    return httpSignedRequest({ method: 'POST', path: `/api/relay/jobs/${jobId}/result`, body, secret: RELAY_SECRET, workerId: WORKER_ID });
  },
  fetchPromoSnapshot,
  resolveExpectedSource,
  snapshotToLiveState,
  expectedFromSource,
  liveFromPlatform,
};

// Scrub any exception message before it leaves this process.
export function sanitizeError(e) {
  const msg = String(e?.message || e || 'unknown error');
  return msg
    .replace(/[A-Z]:\\\S+/g, '<server-path>')
    .replace(/(?:\/var|\/etc|\/opt|\/home|\/root|\/tmp)\/\S+/g, '<server-path>')
    .replace(/(?:cookie|authorization|set-cookie)\s*[:=]\s*[^;\s]+/gi, '<auth-header>')
    .replace(/\b[A-Fa-f0-9]{40,}\b/g, '<token>')
    .slice(0, 200);
}

// ── Bootstrap (only when invoked as a script) ──────────────────────────

let RELAY_SECRET = null;

function bootstrap() {
  const secretStatus = readWorkerRelaySecret();
  if (!secretStatus.present) {
    log('error', 'startup', { reason: secretStatus.reason });
    process.exit(2);
  }
  RELAY_SECRET = secretStatus.secret;
  log('info', 'startup', { status: 'listening', reason: `polling ${HUB_URL} every ${POLL_MIN_MS}-${POLL_MAX_MS}ms` });

  const shutdown = (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'shutdown', { reason: sig });
    // Give any in-flight submit up to 3s to finish.
    setTimeout(() => process.exit(0), inFlight ? 3000 : 100);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  scheduleNext(POLL_MIN_MS);
}

// Only bootstrap when this file is the CLI entry point. Tests import the
// module without triggering the poll loop.
const isCli = import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/') || '');
if (isCli) bootstrap();

// Test-only exports (used by qc-dashboard-relay-worker.test.mjs).
export const _internals = {
  tick,
  scheduleNext,
  get shuttingDown() { return shuttingDown; },
  reset() { shuttingDown = false; inFlight = false; currentDelay = POLL_MIN_MS; },
  setSecret(s) { RELAY_SECRET = s; },
  getCurrentDelay() { return currentDelay; },
};
