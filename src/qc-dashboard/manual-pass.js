// Increment 7 (real-QC upgrade): MANUAL_PASS override — D5 says this is
// deliberately distinct from an automated PASS:
//
//   "Add a distinct MANUAL_PASS override button only for MANUAL_REQUIRED.
//    Require reason, evidence and checker identity, and store it separately
//    from automated PASS."
//
// This module owns the validation. The bin/ dispatcher just enforces the
// session gate and hands the payload here; the qc-log then persists the
// record with qc_result: MANUAL_PASS + the override object attached.
//
// Invariants:
// - Overrides are ONLY valid when the prior automated verdict was
//   MANUAL_REQUIRED. Any other prior state is a client-side bug and MUST
//   be rejected server-side (D5 is emphatic about this — a MANUAL_PASS
//   applied over a FAIL or REVIEW would silently launder a real finding).
// - Reason must be substantive (≥ 10 chars) so operators can't tab-through
//   with "ok" and treat it as a rubber-stamp.
// - Evidence must be non-empty. A URL, a screenshot path, or free-text
//   citing where the operator confirmed the state manually are all valid;
//   whichever the operator uses is captured verbatim.
// - Checker identity comes from the authenticated session — never a form
//   field. Overrides recorded under someone else's identity would defeat
//   the audit trail's purpose.

import crypto from 'node:crypto';
import { lookupRun as _defaultLookup } from './run-store.js';

const MIN_REASON_LEN = 10;
const MAX_REASON_LEN = 2000;
const MAX_EVIDENCE_LEN = 1000;

// Compact JSON hash of the compare payload — lets us prove later that the
// override was recorded against a specific expected/live snapshot. Kept
// deterministic (sorted keys, no timestamps in the input).
export function hashComparePayload(compare) {
  if (!compare || typeof compare !== 'object') return null;
  const canonical = _canonicalJson({
    expected: compare.expected || null,
    actual: compare.actual || null,
    fields: (compare.fields || []).map((f) => ({
      name: f.name, verdict: f.verdict, severity: f.severity,
      expected: f.expected == null ? null : f.expected,
      actual: f.actual == null ? null : f.actual,
    })),
  });
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

function _canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(_canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${_canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

// Pure validator — returns either { ok: true, record } or { ok: false, status, error }.
// The bin/ dispatcher wraps this in the HTTP layer; kept here so tests can hit it
// without spinning up the server.
//
// deps.lookupRun is dependency-injected so tests can stub out the run-store.
// Default resolver reads from the in-memory store populated by /api/run-qc.
export function validateManualPassOverride({ body, user, deps = {} } = {}) {
  if (!user?.email) return { ok: false, status: 401, error: 'session required' };
  const b = body || {};
  const brand = String(b.brand || '').trim().toUpperCase();
  const code = String(b.code || '').trim().toUpperCase();
  if (!brand || !code) return { ok: false, status: 400, error: 'brand and code are required' };
  // Blocker 1 fix: verify server-side that this override targets a real,
  // recent /api/run-qc result that actually produced MANUAL_REQUIRED. Do NOT
  // trust priorVerdict from the body — a crafted request would otherwise
  // unlock the override endpoint against any prior verdict (FAIL / REVIEW /
  // SAFE included). The runId is issued by the server per-result and stored
  // with the true verdict + compare hash.
  const runId = String(b.runId || '').trim();
  if (!runId) {
    return { ok: false, status: 400, error: 'runId is required — MANUAL_PASS override must reference the /api/run-qc result that produced MANUAL_REQUIRED (server-issued in the run-qc response)' };
  }
  const lookupRun = deps.lookupRun || _defaultLookup;
  const claimedCompareHash = b.compare ? hashComparePayload(b.compare) : null;
  const runLookup = lookupRun(runId, {
    brand, code,
    expectedVerdict: 'MANUAL_REQUIRED',
    compareHash: claimedCompareHash,
  });
  if (!runLookup.ok) {
    const reason = ({
      UNKNOWN_RUN_ID: 'runId does not match any recent /api/run-qc result — the run may have expired (30-minute TTL) or the server restarted; re-run QC and try again',
      EXPIRED: 'the referenced /api/run-qc result has expired (30-minute TTL) — re-run QC and try again',
      BRAND_MISMATCH: `runId belongs to a different brand — cannot override across brands`,
      CODE_MISMATCH: `runId belongs to a different promo code — cannot override across codes`,
      VERDICT_MISMATCH: `MANUAL_PASS override is only valid when the prior verdict is MANUAL_REQUIRED (server-recorded verdict was "${runLookup.actual}") — a crafted body cannot bypass this`,
      COMPARE_HASH_MISMATCH: `compare payload hash does not match the recorded run — the client is trying to override against a different snapshot`,
    })[runLookup.code] || `runId validation failed: ${runLookup.code}`;
    return { ok: false, status: 400, error: reason };
  }
  const reason = String(b.reason || '').trim();
  if (reason.length < MIN_REASON_LEN) {
    return { ok: false, status: 400, error: `reason must be at least ${MIN_REASON_LEN} characters describing why live BO evidence was unavailable and how you verified the promo manually` };
  }
  if (reason.length > MAX_REASON_LEN) {
    return { ok: false, status: 400, error: `reason must be at most ${MAX_REASON_LEN} characters` };
  }
  const evidence = String(b.evidence || '').trim();
  if (!evidence) return { ok: false, status: 400, error: 'evidence is required — link a screenshot, ticket, or a short manual verification note' };
  if (evidence.length > MAX_EVIDENCE_LEN) {
    return { ok: false, status: 400, error: `evidence must be at most ${MAX_EVIDENCE_LEN} characters` };
  }
  // Compare block is optional (non-MVP brand runs have no compare); when
  // present, hash it so we can prove later that the override was recorded
  // against a specific expected/live snapshot. We already computed this above
  // for the run-store lookup; reuse it.
  const compareHash = claimedCompareHash;

  const now = new Date().toISOString();
  const record = {
    brand, code,
    platform: String(b.platform || '').trim(),
    region: String(b.region || '').trim(),
    promo_type: String(b.promoType || '').trim(),
    // qc_result is the *new* verdict for this row. Do NOT overwrite the
    // MANUAL_REQUIRED row that came from the automated run — this is a
    // separate audit entry so the trail shows both.
    qc_result: 'MANUAL_PASS',
    checked_by: user.email,
    findings: Array.isArray(b.findings) ? b.findings : [],
    error_category: 'manual-pass-override',
    // description doubles as the operator-facing "why" and lands in the
    // sheet's Description column so reviewers can scan it in-line.
    description: reason,
    expected: 'MANUAL_REQUIRED (live BO evidence unavailable)',
    actual: 'MANUAL_PASS override — verified by operator',
    action_required: '',
    person_responsible: user.email,
    evidence_link: evidence,
    bo_link: String(b.boLink || '').trim(),
    fetch_snapshot: String(b.fetchSnapshot || '').trim(),
    duration_s: b.durationS ?? '',
    // Extra fields — captured in JSONL, not surfaced in the current sheet
    // header. When the sheet template is later widened, these become
    // dedicated columns without a data migration.
    override: {
      prior_verdict: 'MANUAL_REQUIRED',        // now server-verified (not client-claimed)
      run_id: runLookup.entry.runId,
      run_recorded_at: new Date(runLookup.entry.createdAt).toISOString(),
      reason,
      evidence,
      overridden_by: user.email,
      overridden_at: now,
      compare_hash: compareHash,
    },
  };
  return { ok: true, record };
}
