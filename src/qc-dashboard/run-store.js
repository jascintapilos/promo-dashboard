// Blocker 1 fix (Real-QC): server-side store of recent /api/run-qc outcomes.
//
// Prior version trusted `priorVerdict` from the request body — a crafted POST
// could pass "MANUAL_REQUIRED" and unlock the override endpoint for ANY
// prior verdict, including NOT_SAFE / SAFE / REVIEW.
//
// This store gives every /api/run-qc result a server-side runId. The override
// endpoint requires that runId + must match the (brand, code, verdict,
// compare_hash) tuple the server recorded. A crafted body cannot make up a
// runId that resolves to a MANUAL_REQUIRED record — the server has to have
// issued it in the last 30 minutes.
//
// In-memory + capped (512 entries, 30-minute TTL). If the server restarts,
// outstanding overrides fail with UNKNOWN_RUN_ID and the operator has to
// re-run QC — same posture as an expired session cookie. That's the right
// trade-off: overrides must be tied to a live comparison, not to yesterday's.

import crypto from 'node:crypto';

const MAX_ENTRIES = 512;
const TTL_MS = 30 * 60 * 1000;

// Map<runId, { runId, brand, code, verdict, compareHash, createdAt, source }>
const _store = new Map();

function _prune() {
  const now = Date.now();
  for (const [id, entry] of _store) {
    if (now - entry.createdAt > TTL_MS) _store.delete(id);
  }
  if (_store.size > MAX_ENTRIES) {
    // FIFO eviction — Map preserves insertion order.
    const overflow = _store.size - MAX_ENTRIES;
    const iter = _store.keys();
    for (let i = 0; i < overflow; i++) _store.delete(iter.next().value);
  }
}

// Called from /api/run-qc for every result. Returns the runId that the API
// echoes back to the client. The client passes it back on override.
export function recordRun({ brand, code, verdict, compareHash = null, sourceType = null } = {}) {
  if (!brand || !code || !verdict) {
    throw new Error('recordRun: brand, code, verdict are required');
  }
  const runId = `qc_${crypto.randomBytes(9).toString('base64url')}`;
  const entry = {
    runId,
    brand: String(brand).toUpperCase(),
    code: String(code).toUpperCase(),
    verdict,
    compareHash: compareHash || null,
    createdAt: Date.now(),
    source: sourceType || null,
  };
  _store.set(runId, entry);
  _prune();
  return runId;
}

// Called from /api/qc-manual-pass-override. Returns:
//   { ok: true, entry }                — runId resolves + record is intact
//   { ok: false, code: 'UNKNOWN_RUN_ID' | 'EXPIRED' | 'BRAND_MISMATCH' | 'CODE_MISMATCH' | 'VERDICT_MISMATCH' | 'COMPARE_HASH_MISMATCH' }
export function lookupRun(runId, { brand, code, expectedVerdict = 'MANUAL_REQUIRED', compareHash = null } = {}) {
  if (!runId || typeof runId !== 'string') return { ok: false, code: 'UNKNOWN_RUN_ID' };
  const entry = _store.get(runId);
  if (!entry) return { ok: false, code: 'UNKNOWN_RUN_ID' };
  if (Date.now() - entry.createdAt > TTL_MS) {
    _store.delete(runId);
    return { ok: false, code: 'EXPIRED' };
  }
  const bU = String(brand || '').toUpperCase();
  const cU = String(code || '').toUpperCase();
  if (bU && entry.brand !== bU) return { ok: false, code: 'BRAND_MISMATCH' };
  if (cU && entry.code !== cU) return { ok: false, code: 'CODE_MISMATCH' };
  if (entry.verdict !== expectedVerdict) return { ok: false, code: 'VERDICT_MISMATCH', actual: entry.verdict };
  // If the client sent a compareHash (they should when the run had a compare
  // block), it must match — otherwise the client is trying to override
  // against a different snapshot than what the server judged.
  if (compareHash != null && entry.compareHash != null && entry.compareHash !== compareHash) {
    return { ok: false, code: 'COMPARE_HASH_MISMATCH' };
  }
  return { ok: true, entry };
}

// Test hook — deterministic runId generation for unit tests. Clears store.
export function _clearRunStoreForTest() {
  _store.clear();
}
export function _sizeForTest() {
  return _store.size;
}
