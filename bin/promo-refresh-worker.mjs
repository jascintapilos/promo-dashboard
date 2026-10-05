#!/usr/bin/env node
// Promo report refresh worker — runs on the whitelisted VDI (the only host that can
// reach the warehouse). Long-poll loop: lease a refresh job from the Hub, run the
// OUTER report pipeline via child_process (heartbeating while it runs), then POST the
// rebuilt report.json back to the Hub, which atomic-swaps it into report.live.json.
//
// Clones bin/qc-bo-relay-worker.mjs conventions (same auth/secret/backoff/shutdown).
// Key deltas: pass maxBytes for the ~1.4MB report POST; a long-running build needs a
// heartbeat; lease one at a time (a refresh is not batchable).
//
// Run (VDI):  QC_HUB_URL=https://qc-dashboard.zoom66.xyz QC_RELAY_WORKER_ID=vdi-refresh \
//             node bin/promo-refresh-worker.mjs
//   secret:   %USERPROFILE%\.qc-relay\relay-secret  (or env RELAY_SECRET)
//   warehouse creds + PROMO_OUTER_DIR as the pipeline needs.

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readWorkerRelaySecret, buildSignedHeaders, MAX_BODY_BYTES, MAX_REPORT_BUILD_BYTES } from '../src/qc-dashboard/relay-auth.js';

const HUB_URL = process.env.QC_HUB_URL || 'http://localhost:4321';
const WORKER_ID = process.env.QC_RELAY_WORKER_ID || `vdi-refresh-${process.pid}`;
const WORKER_VERSION = 'promo-refresh/1.0';
const POLL_MIN_MS = Number(process.env.QC_RELAY_POLL_MIN_MS || 2000);
const POLL_MAX_MS = Number(process.env.QC_RELAY_POLL_MAX_MS || 10_000);
const HEARTBEAT_MS = Number(process.env.QC_RELAY_HEARTBEAT_MS || 15_000);
// Where the OUTER pipeline repo lives (the build-driver runs with this as cwd).
const OUTER = process.env.PROMO_OUTER_DIR || 'C:/Users/vdiuser/Downloads/promo-automation';
// The build-driver command (Task 2.1). It must honour PROMO_MARKET + write the rebuilt
// report.json to PROMO_REFRESH_OUT, and print "STAGE:<name>" lines for progress.
const BUILD_ARGS = (process.env.PROMO_BUILD_CMD || 'bin/promo-refresh-build.mjs').split(' ');
const BASE_ROUTE = '/api/relay/promo/ws1';

// ── Structured logger — jobId + status only, never secrets/paths ─────────
function log(level, event, extra = {}) {
  const safe = { ts: new Date().toISOString(), level, event, workerId: WORKER_ID };
  for (const k of ['jobId', 'status', 'reason', 'httpStatus', 'nextDelayMs', 'phase', 'market']) {
    if (extra[k] != null) safe[k] = String(extra[k]).slice(0, 128);
  }
  try { console.log(JSON.stringify(safe)); } catch { /* stdio closed on shutdown */ }
}

export function sanitizeError(e) {
  const msg = String((e && e.message) || e || 'unknown error');
  return msg
    .replace(/[A-Z]:\\\S+/g, '<server-path>')
    .replace(/(?:\/var|\/etc|\/opt|\/home|\/root|\/tmp|\/Users)\/\S+/g, '<server-path>')
    .replace(/(?:cookie|authorization|set-cookie)\s*[:=]\s*[^;\s]+/gi, '<auth-header>')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '<token>')
    .slice(0, 200);
}

// ── Poll loop with bounded backoff ───────────────────────────────────────
let shuttingDown = false;
let inFlight = false;
let currentDelay = POLL_MIN_MS;
let RELAY_SECRET = null;

function scheduleNext(delayMs) {
  if (shuttingDown) return;
  currentDelay = Math.min(POLL_MAX_MS, Math.max(POLL_MIN_MS, delayMs));
  setTimeout(tick, currentDelay);
}

async function tick({ deps = defaultDeps, noSchedule = false } = {}) {
  if (shuttingDown || inFlight) return;
  inFlight = true;
  try {
    const { job } = await deps.lease();
    if (!job) {
      const next = Math.min(POLL_MAX_MS, Math.floor(currentDelay * 1.5));
      if (noSchedule) currentDelay = next; else scheduleNext(next);
      return;
    }
    await processJob(job, deps);
    if (noSchedule) currentDelay = POLL_MIN_MS; else scheduleNext(POLL_MIN_MS);
  } catch (e) {
    log('warn', 'poll-error', { reason: sanitizeError(e) });
    const next = Math.min(POLL_MAX_MS, Math.floor(currentDelay * 2));
    if (noSchedule) currentDelay = next; else scheduleNext(next);
  } finally {
    inFlight = false;
  }
}

async function processJob(job, deps) {
  const { jobId, market } = job;
  log('info', 'job-start', { jobId, market, status: 'leased' });
  let stage = 'starting';
  const hb = setInterval(() => { deps.heartbeat({ jobId, progress: stage }).catch(() => {}); }, HEARTBEAT_MS);
  try {
    const run = await deps.runPipeline({ jobId, market, onProgress: (s) => { stage = s; } });
    if (run.code !== 0) {
      await deps.fail({ jobId, error: `PIPELINE_FAILED: ${sanitizeError(run.stderrTail)}` });
      log('warn', 'job-failed', { jobId, reason: 'pipeline' });
      return;
    }
    const reportText = await deps.readReport(run.outFile);
    const submit = await deps.submitReport({ jobId, reportText });
    log('info', 'job-submit', { jobId, httpStatus: submit.status, status: submit.status === 200 ? 'published' : 'rejected' });
    if (submit.status !== 200) await deps.fail({ jobId, error: `publish rejected (${submit.status})` });
  } catch (e) {
    await deps.fail({ jobId, error: sanitizeError(e) });
    log('warn', 'job-failed', { jobId, reason: 'exception' });
  } finally {
    clearInterval(hb);
  }
}

// ── Signed HTTP to the Hub ───────────────────────────────────────────────
async function httpSignedRequest({ method, path: p, body = '', secret, workerId, maxBytes = MAX_BODY_BYTES, extraHeaders = {} }) {
  const buf = Buffer.from(body, 'utf8');
  const { headers } = buildSignedHeaders({ method, path: p, bodyBuffer: buf, secret, workerId, maxBytes });
  const resp = await fetch(`${HUB_URL}${p}`, { method, headers: { ...headers, ...extraHeaders }, body: buf.length ? buf : undefined });
  const text = await resp.text().catch(() => '');
  return { status: resp.status, text };
}

const defaultDeps = {
  lease: async () => {
    const body = JSON.stringify({ workerVersion: WORKER_VERSION });
    const r = await httpSignedRequest({ method: 'POST', path: `${BASE_ROUTE}/refresh-lease`, body, secret: RELAY_SECRET, workerId: WORKER_ID });
    if (r.status !== 200) { log('warn', 'lease-non-200', { httpStatus: r.status }); return { job: null }; }
    try { return JSON.parse(r.text); } catch { return { job: null }; }
  },
  heartbeat: async ({ jobId, progress }) => {
    const body = JSON.stringify({ jobId, progress });
    return httpSignedRequest({ method: 'POST', path: `${BASE_ROUTE}/refresh-heartbeat`, body, secret: RELAY_SECRET, workerId: WORKER_ID });
  },
  fail: async ({ jobId, error }) => {
    const body = JSON.stringify({ jobId, error: String(error).slice(0, 300) });
    return httpSignedRequest({ method: 'POST', path: `${BASE_ROUTE}/refresh-heartbeat`, body, secret: RELAY_SECRET, workerId: WORKER_ID });
  },
  submitReport: async ({ jobId, reportText }) => {
    return httpSignedRequest({
      method: 'POST', path: `${BASE_ROUTE}/report-build`, body: reportText,
      secret: RELAY_SECRET, workerId: WORKER_ID,
      maxBytes: MAX_REPORT_BUILD_BYTES, extraHeaders: { 'x-refresh-job': jobId },
    });
  },
  runPipeline: ({ jobId, market, onProgress }) => new Promise((resolve) => {
    const outFile = path.join(os.tmpdir(), `promo-refresh-${jobId}.json`);
    const child = spawn(process.execPath, BUILD_ARGS, {
      cwd: OUTER,
      env: { ...process.env, PROMO_MARKET: market, PROMO_REFRESH_OUT: outFile },
    });
    let stderrTail = '';
    child.stdout.on('data', (c) => {
      const m = String(c).match(/STAGE:([\w .-]{1,60})/);
      if (m && onProgress) onProgress(m[1].trim());
    });
    child.stderr.on('data', (c) => { stderrTail = (stderrTail + c).slice(-2000); });
    child.on('close', (code) => resolve({ code, stderrTail, outFile }));
    child.on('error', (e) => resolve({ code: -1, stderrTail: String((e && e.message) || e), outFile }));
  }),
  readReport: async (outFile) => readFile(outFile, 'utf8'),
};

// ── Bootstrap (only when invoked as a script) ────────────────────────────
function bootstrap() {
  const secretStatus = readWorkerRelaySecret();
  if (!secretStatus.present) {
    log('error', 'startup', { reason: secretStatus.reason });
    process.exit(2);
  }
  RELAY_SECRET = secretStatus.secret;
  log('info', 'startup', { status: 'listening', reason: `polling ${HUB_URL}${BASE_ROUTE}` });

  const shutdown = (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'shutdown', { reason: sig });
    setTimeout(() => process.exit(0), inFlight ? 3000 : 100);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  scheduleNext(POLL_MIN_MS);
}

const isCli = import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/') || '');
if (isCli) bootstrap();

export { tick, processJob, defaultDeps };
export const _internals = {
  tick, scheduleNext,
  get shuttingDown() { return shuttingDown; },
  reset() { shuttingDown = false; inFlight = false; currentDelay = POLL_MIN_MS; },
  setSecret(s) { RELAY_SECRET = s; },
  getCurrentDelay() { return currentDelay; },
};
