// Increment 3 (real-QC upgrade): resolve the authoritative approved-request
// source that the comparison engine (Increment 4-5) will diff live BO
// against. Never guess; never grep loosely.
//
// Resolution order per D2:
//   1. `handle` provided:
//      1a. captures/qc-bundles/<handle>__<brand>.json  (post-canary bundle
//          with `source` block + `live_state`; preferred because it IS the
//          same input Sentinel validates against — same schema, same shape)
//      1b. captures/requests/<handle>.json             (raw ingested request)
//      neither → { sourceType: 'not-found' }
//   2. No handle: exact promo_code + brand match.
//      2a. Scan bundles: match on top-level `promo_code === code` AND
//          `brand === brand`. Exact string, case-sensitive.
//      2b. Scan requests: match on top-level `promo_code === code` AND
//          `brands` array includes `brand`.
//      Exactly ONE match across both → return it.
//      Multiple → { sourceType: 'ambiguous', matches: [...] }.
//      Zero → { sourceType: 'not-found' }.
//
// Both files are already read-only by convention (captures/ is gitignored;
// canary writes to it). Never mutate.
//
// Returns { sourceType, sourceId, sourceTs, approvalStatus, source, path }
// where `source` is the raw approved-request blob (the schema shared by
// captures/requests/*.json and captures/qc-bundles/*.source). Canonical
// projection happens in Increment 4 (platform adapters).

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const REQUESTS_DIR = path.resolve(process.env.QC_REQUESTS_DIR || 'captures/requests');
const BUNDLES_DIR = path.resolve(process.env.QC_BUNDLES_DIR || 'captures/qc-bundles');

// Filesystem index cached with a 30s TTL. Real cost per rebuild: ~150ms for
// 750 bundles on this repo — fine for an interactive dashboard, cached so
// bursts of RunQC clicks don't rescan.
const INDEX_TTL_MS = 30_000;
let _indexCache = null;

export function _clearExpectedSourceCache() { _indexCache = null; }

// Sample-safe JSON load — returns null on any parse error so one bad file
// (mid-write, truncated) doesn't kill the whole indexing pass.
function _safeReadJson(filePath) {
  try { return JSON.parse(readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

// Build an index of (promoCode, brand) → { path, kind, handle, promoCode,
// brand, savedAt } across bundles + requests.
function _buildIndex() {
  const bundleIx = new Map(); // key `${brand}::${promoCode}` → entry
  const requestIx = new Map(); // key `${brand}::${promoCode}` → entry
  const bundleByHandleBrand = new Map(); // `${handle}::${brand}` → entry
  const requestByHandle = new Map(); // handle → entry

  if (existsSync(BUNDLES_DIR)) {
    for (const f of readdirSync(BUNDLES_DIR)) {
      if (!f.endsWith('.json')) continue;
      const p = path.join(BUNDLES_DIR, f);
      const bundle = _safeReadJson(p);
      if (!bundle || !bundle.brand || !bundle.promo_code) continue;
      let savedAt = bundle.saved_at || null;
      if (!savedAt) { try { savedAt = new Date(statSync(p).mtimeMs).toISOString(); } catch {} }
      // Derive handle from filename: <handle>__<BRAND>.json — resilient to
      // handles that themselves contain `_` because we split on `__`.
      const base = f.slice(0, -5);
      const parts = base.split('__');
      const handle = parts.length >= 2 ? parts.slice(0, -1).join('__') : bundle.handle || null;
      const entry = { path: p, kind: 'bundle', handle, promoCode: bundle.promo_code, brand: bundle.brand, savedAt, promotionId: bundle.promotion_id || null };
      const codeKey = `${bundle.brand}::${bundle.promo_code}`;
      // Keep the most recently saved bundle per (brand, promoCode)
      const prior = bundleIx.get(codeKey);
      if (!prior || (savedAt && (!prior.savedAt || savedAt > prior.savedAt))) bundleIx.set(codeKey, entry);
      if (handle) bundleByHandleBrand.set(`${handle}::${bundle.brand}`, entry);
    }
  }
  if (existsSync(REQUESTS_DIR)) {
    for (const f of readdirSync(REQUESTS_DIR)) {
      if (!f.endsWith('.json')) continue;
      const p = path.join(REQUESTS_DIR, f);
      const req = _safeReadJson(p);
      if (!req || !req.promo_code || !Array.isArray(req.brands)) continue;
      const handle = req.handle || f.slice(0, -5);
      let savedAt = req.date ? _reqDateToIso(req.date) : null;
      if (!savedAt) { try { savedAt = new Date(statSync(p).mtimeMs).toISOString(); } catch {} }
      for (const brand of req.brands) {
        const entry = { path: p, kind: 'request', handle, promoCode: req.promo_code, brand, savedAt, approvalStatus: req.status || null };
        const codeKey = `${brand}::${req.promo_code}`;
        const prior = requestIx.get(codeKey);
        if (!prior || (savedAt && (!prior.savedAt || savedAt > prior.savedAt))) requestIx.set(codeKey, entry);
      }
      requestByHandle.set(handle, { path: p, kind: 'request', handle, promoCode: req.promo_code, brands: req.brands, savedAt, approvalStatus: req.status || null });
    }
  }
  return { bundleIx, requestIx, bundleByHandleBrand, requestByHandle };
}

function _reqDateToIso(dateStr) {
  // ingest sheet writes strings like "15 May 2026" — parse defensively.
  try { const t = Date.parse(String(dateStr)); return Number.isFinite(t) ? new Date(t).toISOString() : null; }
  catch { return null; }
}

function _getIndex({ skipCache = false } = {}) {
  if (!skipCache && _indexCache && _indexCache.expiresAt > Date.now()) return _indexCache.index;
  const index = _buildIndex();
  _indexCache = { index, expiresAt: Date.now() + INDEX_TTL_MS };
  return index;
}

// Public API — resolve an expected-source for a given (brand, code, handle?).
export function resolveExpectedSource({ brand, code, handle = null, skipCache = false, index = null } = {}) {
  if (!brand) return { sourceType: 'invalid', reason: 'brand required' };
  if (!code && !handle) return { sourceType: 'invalid', reason: 'code or handle required' };
  const ix = index || _getIndex({ skipCache });

  // Path 1a — exact handle match on bundles (preferred: has live_state + source)
  if (handle) {
    const bundleEntry = ix.bundleByHandleBrand.get(`${handle}::${brand}`);
    if (bundleEntry) return _hydrate(bundleEntry, code);
    // Path 1b — request handle
    const reqEntry = ix.requestByHandle.get(handle);
    if (reqEntry && Array.isArray(reqEntry.brands) && reqEntry.brands.includes(brand)) {
      return _hydrate({ ...reqEntry, brand }, code);
    }
    return { sourceType: 'not-found', reason: `no request/bundle found for handle "${handle}" and brand "${brand}"` };
  }

  // Path 2 — exact promo_code + brand match. Never grep, never loose match.
  const codeKey = `${brand}::${code}`;
  const bundleMatch = ix.bundleIx.get(codeKey);
  const requestMatch = ix.requestIx.get(codeKey);
  const matches = [bundleMatch, requestMatch].filter(Boolean);
  if (matches.length === 0) return { sourceType: 'not-found', reason: `no exact-match request/bundle for brand="${brand}" code="${code}"` };
  // If both a bundle and a request point at the SAME handle, prefer the bundle
  // (it carries the source-block, so it's a superset of the request).
  if (matches.length === 2 && bundleMatch.handle && bundleMatch.handle === requestMatch.handle) {
    return _hydrate(bundleMatch, code);
  }
  // Multiple distinct sources for the same (brand, code) — do not guess.
  if (matches.length > 1) {
    return {
      sourceType: 'ambiguous',
      reason: `multiple distinct approved sources match brand="${brand}" code="${code}" — resolve by passing an exact handle`,
      matches: matches.map((m) => ({ kind: m.kind, handle: m.handle, savedAt: m.savedAt, sourceId: _sourceIdFor(m) })),
    };
  }
  return _hydrate(matches[0], code);
}

function _sourceIdFor(entry) {
  return entry.kind === 'bundle' ? `bundle:${entry.handle}::${entry.brand}` : `request:${entry.handle}`;
}

function _hydrate(entry, expectedCode) {
  const raw = _safeReadJson(entry.path);
  if (!raw) return { sourceType: 'not-found', reason: 'source file unreadable at resolve time' };
  // For bundles, the `source` block is the approved-request schema (identical
  // to captures/requests/*.json shape). For requests, the raw object itself
  // is that schema. Either way, downstream compare engine reads one shape.
  const source = entry.kind === 'bundle' ? (raw.source || null) : raw;
  if (!source) return { sourceType: 'not-found', reason: `bundle "${entry.handle}" has no source block` };
  // Reject a source whose promo_code does not match the requested code — a
  // safety net against index drift (should be impossible after _buildIndex
  // groups by code, but let it fail loud rather than silently mis-diff).
  const sourceCode = source.promo_code || raw.promo_code;
  if (expectedCode && sourceCode && sourceCode !== expectedCode) {
    return { sourceType: 'not-found', reason: `resolved source code "${sourceCode}" does not match requested "${expectedCode}"` };
  }
  return {
    sourceType: entry.kind,             // 'bundle' | 'request'
    sourceId: _sourceIdFor(entry),      // stable id operator can quote
    sourcePath: null,                   // never leak an absolute path
    sourceTs: entry.savedAt || null,
    approvalStatus: entry.approvalStatus || raw.status || null,
    handle: entry.handle,
    promoCode: sourceCode,
    brand: entry.brand,
    source,                             // full approved-request blob for compare-engine
    liveStateFromBundle: entry.kind === 'bundle' ? (raw.live_state || null) : null,
    promotionId: entry.promotionId || raw.promotion_id || null,
  };
}
