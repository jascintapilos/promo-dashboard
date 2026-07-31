// BO Relay — result payload sanitizer.
//
// Correction brief §6 says only normalized expected/live canonical fields,
// safe source metadata, and hashes may cross the wire. Never:
//   - BO cookies, passwords, TOTP, session tokens
//   - Raw authentication error bodies
//   - Absolute filesystem paths (Windows or POSIX)
//   - Unbounded raw payloads
//
// This module is the last checkpoint on the company server before the
// (already-verified-HMAC) worker payload reaches runComparisonFromRelay.
// A defect here is an information-disclosure bug, so belt-and-braces:
// there is an ALLOWLIST per field, and any unknown key is dropped.

// ── Canonical shape allowlists ─────────────────────────────────────────
// Mirrors src/qc-dashboard/canonical/canonical-model.js#newCanonical(). If
// the canonical grows a new field, extend the allowlist deliberately.

const ID_KEYS = new Set(['promoCode', 'promotionId', 'bonusType', 'bonusSubType', 'brand', 'platform']);
const SCHEDULE_KEYS = new Set(['startDate', 'endDate', 'recurring', 'validityDays', 'rewardValidityDays', 'isActive']);
const CURRENCY_KEYS = new Set([
  'code', 'minDeposit', 'maxBonus', 'bonusRatePct', 'freeCreditAmount',
  'spinCount', 'valuePerSpin', 'linesPerSpin', 'valuePerSpinInconclusive',
  'valuePerSpinNote', 'amountPerLine', 'toMultiplier', 'maxTransferOut',
  'withdrawalCap', 'active',
]);
const ELIGIBILITY_KEYS = new Set(['isVip', 'memberTierIds', 'memberGroupIds', 'redemptionType']);
const SCOPE_KEYS = new Set(['categories', 'gameProviderIds', 'gameProviderCodes', 'blacklistId', 'blacklistedProviders']);
const CONTENT_KEYS = new Set(['names', 'mtBody', 'dialogBody']);
const LINKAGE_KEYS = new Set(['templateId', 'dialogPopupId', 'dialogPopupList', 'promotionListIds']);
const AUTO_KEYS = new Set(['autoRewardActivation']);

const MAX_STRING = 4000;
const MAX_ARRAY = 200;
const MAX_OBJECT_KEYS = 40;
const MAX_TOTAL_JSON_BYTES = 32 * 1024;

// Sanitize a canonical bundle. Returns null when the input is unusable.
export function sanitizeCanonical(input) {
  if (!input || typeof input !== 'object') return null;
  const c = {
    canonicalVersion: input.canonicalVersion || 1,
    identity: pickAllow(input.identity, ID_KEYS),
    schedule: pickAllow(input.schedule, SCHEDULE_KEYS),
    currencies: pickCurrencies(input.currencies),
    eligibility: pickAllow(input.eligibility, ELIGIBILITY_KEYS),
    scope: pickAllow(input.scope, SCOPE_KEYS),
    content: pickContent(input.content),
    linkage: pickAllow(input.linkage, LINKAGE_KEYS),
    autoReward: pickAllow(input.autoReward, AUTO_KEYS),
  };
  return c;
}

function pickAllow(obj, allow) {
  if (!obj || typeof obj !== 'object') return {};
  const out = {};
  let n = 0;
  for (const k of Object.keys(obj)) {
    if (!allow.has(k)) continue;
    if (n++ >= MAX_OBJECT_KEYS) break;
    out[k] = _scalarOrArray(obj[k]);
  }
  return out;
}

function pickCurrencies(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (let i = 0; i < Math.min(arr.length, MAX_ARRAY); i++) {
    const row = arr[i];
    if (!row || typeof row !== 'object') continue;
    const cur = {};
    for (const k of Object.keys(row)) {
      if (!CURRENCY_KEYS.has(k)) continue;
      cur[k] = _scalarOrArray(row[k]);
    }
    out.push(cur);
  }
  return out;
}

function pickContent(obj) {
  if (!obj || typeof obj !== 'object') return { names: {}, mtBody: {}, dialogBody: {} };
  const out = { names: {}, mtBody: {}, dialogBody: {} };
  for (const bucket of ['names', 'mtBody', 'dialogBody']) {
    const src = obj[bucket];
    if (!src || typeof src !== 'object') continue;
    let n = 0;
    for (const [locale, val] of Object.entries(src)) {
      if (n++ >= MAX_OBJECT_KEYS) break;
      if (typeof locale !== 'string' || locale.length > 8) continue;
      out[bucket][locale.toUpperCase()] = _scrubString(val);
    }
  }
  return out;
}

function _scalarOrArray(v) {
  if (v === null || v === undefined) return null;
  const t = typeof v;
  if (t === 'string') return _scrubString(v);
  if (t === 'number') return Number.isFinite(v) ? v : null;
  if (t === 'boolean') return v;
  if (Array.isArray(v)) {
    return v.slice(0, MAX_ARRAY).map((x) => _scalarOrArray(x));
  }
  // Objects are not allowed at leaf position — drop.
  return null;
}

// Strip known-bad content: absolute paths, session/auth headers, cookies,
// long tokens. If the string looks like it might carry sensitive data,
// truncate + scrub.
function _scrubString(s) {
  if (typeof s !== 'string') return null;
  let out = s.slice(0, MAX_STRING);
  // Absolute paths (Windows + POSIX)
  out = out.replace(/[A-Z]:\\\S+/g, '<server-path>');
  out = out.replace(/(?:\/var|\/etc|\/opt|\/home|\/root|\/tmp|\/usr)\/\S+/g, '<server-path>');
  // Cookie / Authorization / Set-Cookie headers embedded in text
  out = out.replace(/(?:cookie|authorization|set-cookie)\s*[:=]\s*[^;\s]+/gi, '<auth-header>');
  // Long random-looking tokens (32+ hex or base64ish chars)
  out = out.replace(/\b[A-Fa-f0-9]{40,}\b/g, '<token>');
  out = out.replace(/\b[A-Za-z0-9+/=_-]{40,}\b/g, (m) => m.length > 60 ? '<token>' : m);
  return out;
}

// ── Expected-source metadata (only safe fields) ────────────────────────

const SOURCE_META_KEYS = new Set(['sourceType', 'sourceId', 'sourceTs', 'approvalStatus', 'handle', 'promoCode', 'brand']);

export function sanitizeExpectedSourceMeta(input) {
  if (!input || typeof input !== 'object') return null;
  const out = {};
  for (const k of Object.keys(input)) {
    if (!SOURCE_META_KEYS.has(k)) continue;
    const v = input[k];
    if (v == null) { out[k] = null; continue; }
    if (typeof v === 'string') out[k] = _scrubString(v);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    // Path-carrying / opaque field intentionally dropped.
  }
  return out;
}

// ── Top-level payload sanitize + size check ────────────────────────────

const PAYLOAD_TOP_KEYS = new Set([
  'jobId', 'brand', 'code', 'handle',
  'expectedCanonical', 'actualCanonical', 'expectedSourceMeta',
  'platform', 'siteId',
  // Structured error fields the worker uses to explain WHY it couldn't
  // produce evidence. Never a raw stack trace.
  'workerError',
]);

const WORKER_ERROR_KEYS = new Set(['code', 'message']);
const WORKER_ERROR_CODES = new Set([
  'BO_UNREACHABLE', 'AUTH_EXPIRED', 'CODE_NOT_FOUND',
  'EXPECTED_SOURCE_MISSING', 'EXPECTED_SOURCE_AMBIGUOUS',
  'UNKNOWN_PLATFORM', 'INTERNAL',
]);

export function sanitizeResultPayload(rawJson) {
  if (typeof rawJson !== 'string') return { ok: false, code: 'NOT_A_STRING' };
  if (Buffer.byteLength(rawJson, 'utf8') > MAX_TOTAL_JSON_BYTES) return { ok: false, code: 'TOO_LARGE' };
  let parsed;
  try { parsed = JSON.parse(rawJson); }
  catch { return { ok: false, code: 'INVALID_JSON' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, code: 'NOT_OBJECT' };
  const out = {};
  for (const k of PAYLOAD_TOP_KEYS) {
    if (!(k in parsed)) continue;
    out[k] = parsed[k];
  }
  const jobId = typeof out.jobId === 'string' ? out.jobId.slice(0, 64) : null;
  const brand = typeof out.brand === 'string' ? out.brand.slice(0, 32).toUpperCase() : null;
  const code = typeof out.code === 'string' ? out.code.slice(0, 64).toUpperCase() : null;
  const handle = typeof out.handle === 'string' ? out.handle.slice(0, 40) : (out.handle === null ? null : null);
  const platform = typeof out.platform === 'string' ? out.platform.toLowerCase() : null;
  const siteId = typeof out.siteId === 'string' ? out.siteId.slice(0, 64) : null;
  const expectedCanonical = sanitizeCanonical(out.expectedCanonical);
  const actualCanonical = sanitizeCanonical(out.actualCanonical);
  const expectedSourceMeta = sanitizeExpectedSourceMeta(out.expectedSourceMeta);
  const workerError = _sanitizeWorkerError(out.workerError);
  return {
    ok: true,
    payload: {
      jobId, brand, code, handle, platform, siteId,
      expectedCanonical, actualCanonical, expectedSourceMeta, workerError,
    },
  };
}

function _sanitizeWorkerError(err) {
  if (!err || typeof err !== 'object') return null;
  const out = {};
  for (const k of Object.keys(err)) {
    if (!WORKER_ERROR_KEYS.has(k)) continue;
    if (k === 'code') {
      out.code = WORKER_ERROR_CODES.has(err.code) ? err.code : 'INTERNAL';
    } else {
      out.message = _scrubString(String(err[k] || ''));
    }
  }
  return out;
}

// ── Public helper: does this sanitized payload carry usable evidence? ──

export function payloadCarriesEvidence(payload) {
  if (!payload) return false;
  if (payload.workerError) return false;
  if (!payload.expectedCanonical || !payload.actualCanonical) return false;
  return true;
}
