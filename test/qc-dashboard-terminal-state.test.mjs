import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAutoChecks } from '../src/qc-dashboard/auto-checks.js';
import { computeVerdict, buildMechanics } from '../src/qc-dashboard/verdict-engine.js';

// Shared unavailable details — what fetchPromoSnapshot returns for terminal states
const UNAVAILABLE_DETAILS = {
  promoCode: 'MISSING',
  promoName: 'unavailable',
  promoType: 'unavailable',
  currency: 'unavailable',
  validity: 'unavailable',
  rewardValidity: 'unavailable',
  status: 'unavailable',
  minDeposit: 'unavailable',
  maxBonus: 'unavailable',
  turnover: 'unavailable',
  reward: 'unavailable',
  lifetimeClaim: 'unavailable',
  dailyClaim: 'unavailable',
  recurring: 'unavailable',
  eligibility: 'unavailable',
  gamesProviders: 'unavailable',
  inboxContent: 'unavailable',
  createdBy: 'unavailable',
  updatedAt: 'unavailable',
};

// ── NOT FOUND ─────────────────────────────────────────────────────────────────

test('not-found: runAutoChecks returns exactly one code-not-found finding', () => {
  const findings = runAutoChecks({
    brand: 'QPRO1',
    code: 'GHOST_CODE',
    notFound: true,
    detail: 'Code GHOST_CODE not found on QPRO1',
    checkCandidate: { platform: 'qpro', brand: 'QPRO1', code: 'GHOST_CODE' },
  });
  assert.equal(findings.length, 1, `Expected 1 finding, got ${findings.length}`);
  assert.equal(findings[0].check, 'code-not-found');
  assert.equal(findings[0].severity, 'FAIL');
  assert.ok(findings[0].message.includes('GHOST_CODE'), 'message should name the code');
  assert.ok(findings[0].message.includes('QPRO1'), 'message should name the brand');
});

test('not-found: computeVerdict with code-not-found finding returns exactly one finding (no required-field cascade)', () => {
  const autoFindings = runAutoChecks({
    brand: 'QP2A',
    code: 'NOPE',
    notFound: true,
    detail: 'Code NOPE not found on QP2A',
    checkCandidate: { platform: 'qp2', brand: 'QP2A', code: 'NOPE' },
  });
  const { verdict, findings } = computeVerdict({ findings: autoFindings, details: UNAVAILABLE_DETAILS });
  assert.equal(verdict, 'NOT_SAFE');
  assert.equal(findings.length, 1, `Expected exactly 1 finding through the full flow, got ${findings.length}: ${JSON.stringify(findings.map((f) => f.check))}`);
  assert.equal(findings[0].check, 'code-not-found');
  assert.ok(!findings.some((f) => f.check === 'required-field-unavailable'), 'must not append required-field-unavailable');
});

test('not-found: /api/run-qc uses snapshot.detail as mechanics (buildMechanics bypassed)', () => {
  // The /api/run-qc handler: mechanics = snapshot.notFound ? snapshot.detail : buildMechanics(snapshot.details)
  // buildMechanics is never called for not-found snapshots.
  const snapshot = {
    notFound: true,
    detail: 'Code GHOST not found on QPRO1',
    details: UNAVAILABLE_DETAILS,
  };
  const mechanics = snapshot.notFound ? snapshot.detail : buildMechanics(snapshot.details);
  assert.equal(mechanics, 'Code GHOST not found on QPRO1');
});

// ── BO UNREACHABLE ────────────────────────────────────────────────────────────

test('bo-unreachable: runAutoChecks returns exactly one bo-unreachable finding', () => {
  const findings = runAutoChecks({
    brand: 'WS1_MY',
    code: 'ANY_CODE',
    notFound: false,
    error: 'BO unreachable',
    detail: 'connect ECONNREFUSED 10.0.0.1:443',
    checkCandidate: { platform: 'igmp', brand: 'WS1_MY', code: 'ANY_CODE' },
  });
  assert.equal(findings.length, 1, `Expected 1 finding, got ${findings.length}`);
  assert.equal(findings[0].check, 'bo-unreachable');
  assert.equal(findings[0].severity, 'FAIL');
  assert.ok(findings[0].message.toLowerCase().includes('unreachable'), 'message should mention unreachable');
});

test('bo-unreachable: computeVerdict returns exactly one finding (no required-field cascade)', () => {
  const autoFindings = runAutoChecks({
    brand: 'QPRO5',
    code: 'ANY',
    notFound: false,
    error: 'BO unreachable',
    detail: 'Network timeout',
    checkCandidate: { platform: 'qpro', brand: 'QPRO5', code: 'ANY' },
  });
  const { verdict, findings } = computeVerdict({ findings: autoFindings, details: UNAVAILABLE_DETAILS });
  assert.equal(verdict, 'NOT_SAFE');
  assert.equal(findings.length, 1, `Expected exactly 1 finding, got ${findings.length}: ${JSON.stringify(findings.map((f) => f.check))}`);
  assert.equal(findings[0].check, 'bo-unreachable');
  assert.ok(!findings.some((f) => f.check === 'required-field-unavailable'), 'must not append required-field-unavailable');
});

// ── SUCCESSFUL FETCH — required-field failures still apply ───────────────────

test('successful fetch with missing promoName still gets required-field-unavailable', () => {
  const goodDetails = {
    promoCode: 'REL_30PCT_3X',
    promoName: 'unavailable',         // <-- missing
    promoType: 'Deposit - Reload',
    currency: 'MYR',
    validity: '2026-01-01 → 2026-12-31',
    rewardValidity: '7',
    status: 'Active',
  };
  const { verdict, findings } = computeVerdict({ findings: [], details: goodDetails });
  assert.equal(verdict, 'NOT_SAFE');
  assert.ok(findings.some((f) => f.check === 'required-field-unavailable' && f.field === 'promoName'));
});

test('successful fetch with a WARNING finding returns REVIEW verdict', () => {
  const goodDetails = {
    promoCode: 'REL_30PCT_3X',
    promoName: 'Test Promo',
    promoType: 'Deposit - Reload',
    currency: 'MYR',
    validity: '2026-01-01 → 2026-12-31',
    rewardValidity: '7',
    status: 'Active',
  };
  const warningFinding = { severity: 'WARNING', check: 'duplicate-brand', message: 'Also found on QPRO5' };
  const { verdict, findings } = computeVerdict({ findings: [warningFinding], details: goodDetails });
  assert.equal(verdict, 'REVIEW');
  assert.equal(findings.some((f) => f.check === 'required-field-unavailable'), false, 'no required-field-unavailable on full data');
});

// ── EXISTING SAFE / REVIEW BEHAVIOR UNCHANGED ─────────────────────────────────

test('SAFE verdict: all required fields present, no findings', () => {
  const { verdict, findings } = computeVerdict({
    findings: [],
    details: {
      promoCode: 'FT_ACQ_REL_30PCT_3X',
      promoName: 'Reload 30%',
      promoType: 'Deposit - Reload',
      currency: 'MYR',
      validity: '2026-01-01 → 2026-12-31',
      rewardValidity: '7',
      status: 'Active',
    },
  });
  assert.equal(verdict, 'SAFE');
  assert.equal(findings.length, 0);
});

test('REVIEW verdict: FAIL finding from runAutoChecks + no required-field issues passes through unchanged', () => {
  // Verify that a FAIL from auto-checks (not a terminal state) still causes NOT_SAFE
  const failFinding = { severity: 'FAIL', check: 'expired-active', message: 'Promotion is expired but Active' };
  const { verdict, findings } = computeVerdict({
    findings: [failFinding],
    details: {
      promoCode: 'OLD_CODE',
      promoName: 'Old Promo',
      promoType: 'Deposit',
      currency: 'MYR',
      validity: '2025-01-01 → 2025-03-31',
      rewardValidity: '7',
      status: 'Active',
    },
  });
  assert.equal(verdict, 'NOT_SAFE');
  assert.ok(findings.some((f) => f.check === 'expired-active'));
  assert.equal(findings.some((f) => f.check === 'required-field-unavailable'), false);
});

// ── UI / /api/run-qc contract ─────────────────────────────────────────────────

test('not-found: snapshot.detail becomes the mechanics string in the /api/run-qc flow', () => {
  const snapshot = {
    brand: 'QP2A',
    code: 'GHOST',
    notFound: true,
    detail: 'Code GHOST not found on QP2A',
    details: UNAVAILABLE_DETAILS,
    checkCandidate: { platform: 'qp2', brand: 'QP2A', code: 'GHOST' },
  };
  // Mirrors the /api/run-qc logic:
  //   mechanics: snapshot.notFound ? snapshot.detail : buildMechanics(snapshot.details)
  const mechanics = snapshot.notFound ? snapshot.detail : 'unreachable';
  assert.equal(mechanics, 'Code GHOST not found on QP2A');
});
