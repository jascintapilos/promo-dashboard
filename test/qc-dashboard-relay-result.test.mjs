// BO Relay Increment 3 — result sanitizer + compare-flow relay entry tests.
// Covers correction brief §4 (server re-derives verdict), §6 (evidence
// scrubbing + allowlists), §5 (relay-incomplete → MANUAL_REQUIRED).

import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCanonical, sanitizeExpectedSourceMeta, sanitizeResultPayload, payloadCarriesEvidence } from '../src/qc-dashboard/relay-result.js';
import { runComparisonFromRelay } from '../src/qc-dashboard/compare-flow.js';
import { expectedFromSource, liveFromQpro, liveFromQp2 } from '../src/qc-dashboard/canonical/index.js';

// ── sanitizeCanonical ──────────────────────────────────────────────────

test('sanitize: unknown top-level keys dropped, allowed shape preserved', () => {
  const dirty = {
    identity: { promoCode: 'X', platform: 'qp2', ATTACKER_FIELD: 'evil' },
    schedule: { validityDays: 7, SECRET: 'no' },
    currencies: [{ code: 'MYR', minDeposit: 100, hax: 'no' }],
    scope: { categories: ['SLOTS'] },
    __proto__: { polluted: true },
  };
  const c = sanitizeCanonical(dirty);
  assert.equal(c.identity.promoCode, 'X');
  assert.equal(c.identity.platform, 'qp2');
  assert.equal(Object.prototype.hasOwnProperty.call(c.identity, 'ATTACKER_FIELD'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(c.schedule, 'SECRET'), false);
  assert.equal(c.currencies[0].minDeposit, 100);
  assert.equal(Object.prototype.hasOwnProperty.call(c.currencies[0], 'hax'), false);
});

test('sanitize: scrubs absolute Windows paths inside string values', () => {
  const c = sanitizeCanonical({
    content: { names: { EN: 'saw error at C:\\Users\\vdiuser\\secret\\creds.json today' } },
  });
  assert.match(c.content.names.EN, /<server-path>/);
  assert.doesNotMatch(c.content.names.EN, /vdiuser/);
});

test('sanitize: scrubs POSIX absolute paths', () => {
  const c = sanitizeCanonical({
    content: { names: { EN: 'read /var/lib/qc/creds and /etc/shadow' } },
  });
  assert.doesNotMatch(c.content.names.EN, /shadow|qc\/creds/);
});

test('sanitize: scrubs cookie / authorization header strings', () => {
  const c = sanitizeCanonical({
    content: { names: { EN: 'Cookie: qc_hub_session=abc123 sensitive stuff' } },
  });
  assert.match(c.content.names.EN, /<auth-header>/);
  assert.doesNotMatch(c.content.names.EN, /qc_hub_session/);
});

test('sanitize: scrubs long random-looking hex tokens', () => {
  const bigHex = 'a'.repeat(64);
  const c = sanitizeCanonical({
    content: { names: { EN: `session token: ${bigHex} something` } },
  });
  assert.match(c.content.names.EN, /<token>/);
  assert.doesNotMatch(c.content.names.EN, /aaaaaaaaaaaaaaaa/);
});

test('sanitize: strings truncated to MAX_STRING to prevent oversized payloads', () => {
  const c = sanitizeCanonical({
    content: { names: { EN: 'x'.repeat(20_000) } },
  });
  assert.ok(c.content.names.EN.length <= 4000);
});

test('sanitize: currency array truncated to MAX_ARRAY', () => {
  const arr = Array.from({ length: 500 }, (_, i) => ({ code: 'MYR', minDeposit: i }));
  const c = sanitizeCanonical({ currencies: arr });
  assert.ok(c.currencies.length <= 200);
});

test('sanitize: rejects nested-object at leaf position', () => {
  const c = sanitizeCanonical({
    identity: { promoCode: { evil: { nested: true } } },
  });
  assert.equal(c.identity.promoCode, null);
});

// ── sanitizeExpectedSourceMeta ─────────────────────────────────────────

test('sanitizeExpectedSourceMeta: drops sourcePath even if present', () => {
  const m = sanitizeExpectedSourceMeta({
    sourceType: 'bundle', sourceId: 'P100__QP2A.json',
    sourcePath: 'C:\\attacker\\controlled\\path.json',
  });
  assert.equal(m.sourceType, 'bundle');
  assert.equal(m.sourceId, 'P100__QP2A.json');
  assert.equal(Object.prototype.hasOwnProperty.call(m, 'sourcePath'), false, 'sourcePath must be filtered');
});

// ── sanitizeResultPayload (raw JSON string entrypoint) ─────────────────

test('sanitizeResultPayload: rejects oversized JSON before parse', () => {
  const big = JSON.stringify({ payload: 'x'.repeat(40_000) });
  const r = sanitizeResultPayload(big);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'TOO_LARGE');
});

test('sanitizeResultPayload: rejects invalid JSON', () => {
  const r = sanitizeResultPayload('{not valid');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'INVALID_JSON');
});

test('sanitizeResultPayload: rejects non-object top-level (array, string)', () => {
  assert.equal(sanitizeResultPayload('[]').ok, false);
  assert.equal(sanitizeResultPayload('"hi"').ok, false);
});

test('sanitizeResultPayload: happy path — brand/code uppercased, canonical passed through sanitizer', () => {
  const r = sanitizeResultPayload(JSON.stringify({
    jobId: 'qcj_abc123',
    brand: 'qp2a',
    code: 'code1',
    platform: 'QP2',
    handle: 'p100',
    expectedCanonical: { identity: { promoCode: 'code1', platform: 'qp2' }, currencies: [] },
    actualCanonical: { identity: { promoCode: 'code1', platform: 'qp2' }, currencies: [] },
    expectedSourceMeta: { sourceType: 'bundle', sourceId: 'x', sourcePath: 'ATTACK' },
    workerError: null,
  }));
  assert.equal(r.ok, true);
  assert.equal(r.payload.brand, 'QP2A');
  assert.equal(r.payload.code, 'CODE1');
  assert.equal(r.payload.platform, 'qp2');
  assert.equal(r.payload.expectedSourceMeta.sourceType, 'bundle');
  assert.equal(Object.prototype.hasOwnProperty.call(r.payload.expectedSourceMeta, 'sourcePath'), false);
});

test('sanitizeResultPayload: workerError.code constrained to allowlist', () => {
  const r = sanitizeResultPayload(JSON.stringify({
    jobId: 'x', brand: 'QP2A', code: 'C', workerError: { code: 'RM_-RF_/', message: 'oops' },
  }));
  assert.equal(r.payload.workerError.code, 'INTERNAL', 'unknown code falls back to INTERNAL');
});

// ── payloadCarriesEvidence ─────────────────────────────────────────────

test('payloadCarriesEvidence: false when workerError present, true when both canonicals present', () => {
  assert.equal(payloadCarriesEvidence({ workerError: { code: 'BO_UNREACHABLE' }, expectedCanonical: {}, actualCanonical: {} }), false);
  assert.equal(payloadCarriesEvidence({ expectedCanonical: null, actualCanonical: {} }), false);
  assert.equal(payloadCarriesEvidence({ expectedCanonical: {}, actualCanonical: {} }), true);
});

// ── runComparisonFromRelay (compare-flow entry) ────────────────────────

const HAPPY_EXP = expectedFromSource({
  promo_code: 'REL_FS', brands: ['QP2A'], regions: ['MY'], currencies: ['MYR'],
  bonus_type: 'Free Spin',
  parsed: { spin_count: 5, value_per_spin: 5, min_deposit: 50, to_multiplier: 8 },
}, { brand: 'QP2A', platform: 'qp2' });

const HAPPY_ACT = liveFromQp2({
  list_row: { id: 1, code: 'REL_FS', bonus_type: 'Free Spin', status: 1, merchant_ids: [1], message_template_id: 1, dialog_popup_list: [{ popup_id: 100 }] },
  detail: {
    free_spin_game_code: 'vs20olympgate',
    to_multiplier: 8, auto_reward_activation: true,
    promotion_currency_list: [{ currency: 'MYR', currency_id: 1, status: 1, amount_per_line: 0.25, lines: 0, min_transfer: 50, rounds: 5 }],
  },
}, { brand: 'QP2A' });

test('relay-flow: happy path — server re-derives PASS from clean evidence', () => {
  const r = runComparisonFromRelay({
    brand: 'QP2A', code: 'REL_FS', handle: 'P123',
    expectedCanonical: HAPPY_EXP, actualCanonical: HAPPY_ACT,
    expectedSourceMeta: { sourceType: 'bundle', sourceId: 'P123__QP2A.json' },
    platform: 'qp2',
  });
  assert.equal(r.status, 'ok');
  assert.equal(r.verdict, 'SAFE');
});

test('relay-flow: incomplete evidence → MANUAL_REQUIRED, never SAFE', () => {
  const r = runComparisonFromRelay({
    brand: 'QP2A', code: 'REL_FS',
    expectedCanonical: null, actualCanonical: HAPPY_ACT, // missing expected
    platform: 'qp2',
  });
  assert.equal(r.verdict, 'MANUAL_REQUIRED');
  assert.equal(r.findings[0].check, 'relay-incomplete-evidence');
});

test('relay-flow: compare-engine crash on relay payload → MANUAL_REQUIRED, not SAFE', () => {
  const r = runComparisonFromRelay({
    brand: 'QP2A', code: 'REL_FS',
    expectedCanonical: HAPPY_EXP, actualCanonical: HAPPY_ACT,
    platform: 'qp2',
    deps: { compare: () => { throw new Error('C:\\Users\\vdiuser\\stack.trace here'); } },
  });
  assert.equal(r.verdict, 'MANUAL_REQUIRED');
  assert.equal(r.findings[0].check, 'compare-engine-error');
  assert.doesNotMatch(r.findings[0].message, /vdiuser/, 'stack trace paths must be scrubbed');
});

test('relay-flow: server never trusts client verdict — re-derives from evidence', () => {
  // Craft a "would-be-FAIL" evidence pair but the caller thinks it's SAFE.
  // The server MUST return FAIL (or whatever the real compare says), not SAFE.
  const badLive = liveFromQp2({
    list_row: { id: 1, code: 'REL_FS', bonus_type: 'Free Spin', status: 1, merchant_ids: [1] },
    detail: {
      free_spin_game_code: 'vs20olympgate',
      to_multiplier: 999, auto_reward_activation: true,   // to_multiplier MISMATCH
      promotion_currency_list: [{ currency: 'MYR', currency_id: 1, status: 1, amount_per_line: 0.25, lines: 0, min_transfer: 50, rounds: 5 }],
    },
  }, { brand: 'QP2A' });
  const r = runComparisonFromRelay({
    brand: 'QP2A', code: 'REL_FS',
    expectedCanonical: HAPPY_EXP, actualCanonical: badLive,
    platform: 'qp2',
  });
  assert.equal(r.verdict, 'NOT_SAFE', 'server compare must catch the mismatch regardless of what the client claims');
});

test('relay-flow: expectedSource block never carries sourcePath even if worker sent it', () => {
  const r = runComparisonFromRelay({
    brand: 'QP2A', code: 'REL_FS',
    expectedCanonical: HAPPY_EXP, actualCanonical: HAPPY_ACT,
    expectedSourceMeta: { sourceType: 'bundle', sourceId: 'x', sourcePath: '/attacker/leak.json' },
    platform: 'qp2',
  });
  assert.equal(Object.prototype.hasOwnProperty.call(r.expectedSource, 'sourcePath'), false);
});

test('relay-flow: unsupported platform returns skip, does not fall through to SAFE', () => {
  const r = runComparisonFromRelay({
    brand: 'QP2A', code: 'REL_FS',
    expectedCanonical: HAPPY_EXP, actualCanonical: HAPPY_ACT,
    platform: 'nintendo',
  });
  assert.equal(r.status, 'skip');
});
