import test from 'node:test';
import assert from 'node:assert/strict';
import { runComparison, snapshotToLiveState } from '../src/qc-dashboard/compare-flow.js';

// ---------- snapshotToLiveState mapper ----------

test('Increment 6: snapshotToLiveState maps QPRO raw shape', () => {
  const snap = { raw: {
    listingRow: { code: 'X', id: 42, bonus_type: 'Free Credit' },
    detail: { code: 'X', promotion_currency_list: [{ currency: 'MYR', free_credit_amount: 30 }] },
    currencies: [{ currency: 'MYR', free_credit_amount: 30 }],
  } };
  const ls = snapshotToLiveState(snap, 'qpro');
  assert.ok(ls.list_row);
  assert.equal(ls.list_row.code, 'X');
  assert.equal(ls.detail.promotion_currency_list[0].currency, 'MYR');
  assert.equal(ls.tnc, null);
});

test('Increment 6: snapshotToLiveState folds currencies onto detail when detail lacks the list', () => {
  const snap = { raw: {
    listingRow: { code: 'Y', bonus_type: 'Deposit - Reload' },
    detail: { code: 'Y' }, // detail has no promotion_currency_list
    currencies: [{ currency: 'MYR', min_transfer: 100 }],
  } };
  const ls = snapshotToLiveState(snap, 'qp2');
  assert.equal(ls.detail.promotion_currency_list[0].min_transfer, 100);
});

test('Increment 6: snapshotToLiveState unwraps IGMP data.Promotion envelopes', () => {
  const snap = { raw: {
    list: { data: { Promotion: { PromotionCode: 'Z', PromotionType: 'FreeCredit', PromotionRewards: [{ FixedBonusAmount: 30 }] } } },
    detail: { data: { Promotion: { PromotionCode: 'Z', PromotionType: 'FreeCredit', PromotionRewards: [{ FixedBonusAmount: 30 }] } } },
  } };
  const ls = snapshotToLiveState(snap, 'igmp');
  assert.equal(ls.list_row.PromotionCode, 'Z');
  assert.equal(ls.detail.PromotionRewards[0].FixedBonusAmount, 30);
});

test('Increment 6: snapshotToLiveState returns null for missing raw / unknown platform', () => {
  assert.equal(snapshotToLiveState(null, 'qpro'), null);
  assert.equal(snapshotToLiveState({ raw: {} }, 'unknown'), null);
});

// ---------- runComparison ----------

function baseSnapshot(overrides = {}) {
  return {
    raw: {
      listingRow: { code: 'CODE1', id: 1, bonus_type: 'Free Credit' },
      detail: { code: 'CODE1', promotion_currency_list: [{ currency: 'MYR', free_credit_amount: 30, min_transfer: 0 }], auto_reward_activation: true },
      currencies: [],
    },
    runtime: { platform: 'qp2', siteId: 'ibc22mys' },
    ...overrides,
  };
}

function baseBrandConfig(overrides = {}) {
  return { id: 'QP2A', qcRules: { mvp: true }, runtime: { platform: 'qp2', siteId: 'ibc22mys' }, ...overrides };
}

// A "healthy" set of stubs that returns a SAFE compare result.
function makeHappyDeps() {
  const expSource = {
    handle: 'P100', promoCode: 'CODE1', brand: 'QP2A',
    sourceType: 'bundle', sourceId: 'P100__QP2A.json',
    sourceTs: '2026-07-30T00:00:00Z', approvalStatus: 'approved',
    source: { promo_code: 'CODE1', bonus_type: 'Free Credit', parsed: {} },
  };
  return {
    resolveExpectedSource: () => expSource,
    expectedFromSource: () => ({
      identity: { promoCode: 'CODE1', bonusType: 'FREE_CREDIT' },
      currencies: [{ code: 'MYR' }],
    }),
    liveFromPlatform: () => ({
      identity: { promoCode: 'CODE1', bonusType: 'FREE_CREDIT', promotionId: 42 },
      currencies: [{ code: 'MYR' }],
    }),
    compare: () => ({
      verdict: 'SAFE',
      fields: [
        { name: 'promoCode', expected: 'CODE1', actual: 'CODE1', verdict: 'MATCH', severity: 'CRITICAL', path: 'identity.promoCode', notes: 'ok' },
      ],
      summary: { total: 1, passed: 1, failed: 0, warnings: 0, unavailable: 0, skipped: 0 },
    }),
  };
}

test('Increment 6: runComparison returns compare verdict for MVP brand + healthy snapshot', () => {
  const r = runComparison({
    brand: 'QP2A', code: 'CODE1', handle: 'P100',
    snapshot: baseSnapshot(), brandConfig: baseBrandConfig(),
    deps: makeHappyDeps(),
  });
  assert.equal(r.status, 'ok');
  assert.equal(r.verdict, 'SAFE');
  assert.equal(r.findings.length, 0);   // MATCH fields don't surface as findings
  assert.equal(r.fields.length, 1);
  assert.equal(r.expectedSource.sourceType, 'bundle');
  assert.equal(r.expectedSource.handle, 'P100');
  assert.equal(r.expectedSource.requestedHandle, 'P100');
  assert.equal(r.expectedRef.promoCode, 'CODE1');
  assert.equal(r.actualRef.promotionId, 42);
});

test('Increment 6: runComparison skips (does not override) when snapshot carries a fetch error', () => {
  const r = runComparison({
    brand: 'QP2A', code: 'CODE1',
    snapshot: { error: 'BO unreachable', runtime: { platform: 'qp2' }, raw: null },
    brandConfig: baseBrandConfig(),
    deps: makeHappyDeps(),
  });
  assert.equal(r.status, 'skip');
  assert.equal(r.code, 'snapshot-unavailable');
});

test('Increment 6: runComparison skips when snapshot marks the code as notFound', () => {
  const r = runComparison({
    brand: 'QP2A', code: 'CODE1',
    snapshot: { notFound: true, runtime: { platform: 'qp2' }, raw: null },
    brandConfig: baseBrandConfig(),
    deps: makeHappyDeps(),
  });
  assert.equal(r.status, 'skip');
});

test('Increment 6: runComparison returns MANUAL_REQUIRED when expected source is ambiguous', () => {
  const deps = makeHappyDeps();
  deps.resolveExpectedSource = () => ({ sourceType: 'ambiguous', source: null });
  const r = runComparison({
    brand: 'QP2A', code: 'CODE1',
    snapshot: baseSnapshot(), brandConfig: baseBrandConfig(),
    deps,
  });
  assert.equal(r.status, 'ok');
  assert.equal(r.verdict, 'MANUAL_REQUIRED');
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].check, 'expected-source-unresolved');
  assert.match(r.findings[0].message, /Multiple approved requests/);
  assert.equal(r.expectedSource.sourceType, 'ambiguous');
});

test('Increment 6: runComparison returns MANUAL_REQUIRED when expected source is not-found', () => {
  const deps = makeHappyDeps();
  deps.resolveExpectedSource = () => ({ sourceType: 'not-found', source: null });
  const r = runComparison({
    brand: 'QP2A', code: 'CODE1', handle: 'P999',
    snapshot: baseSnapshot(), brandConfig: baseBrandConfig(),
    deps,
  });
  assert.equal(r.status, 'ok');
  assert.equal(r.verdict, 'MANUAL_REQUIRED');
  assert.match(r.findings[0].message, /No approved request/);
  assert.match(r.findings[0].message, /handle P999/);
});

test('Increment 6: runComparison surfaces MANUAL_REQUIRED when the expected adapter throws', () => {
  const deps = makeHappyDeps();
  deps.expectedFromSource = () => { throw new Error('bad field: foo'); };
  const r = runComparison({
    brand: 'QP2A', code: 'CODE1',
    snapshot: baseSnapshot(), brandConfig: baseBrandConfig(),
    deps,
  });
  assert.equal(r.verdict, 'MANUAL_REQUIRED');
  assert.equal(r.findings[0].check, 'expected-adapter-failed');
  assert.match(r.findings[0].message, /bad field/);
});

test('Increment 6: runComparison surfaces MANUAL_REQUIRED when the live adapter throws', () => {
  const deps = makeHappyDeps();
  deps.liveFromPlatform = () => { throw new Error('live shape not recognised'); };
  const r = runComparison({
    brand: 'QP2A', code: 'CODE1',
    snapshot: baseSnapshot(), brandConfig: baseBrandConfig(),
    deps,
  });
  assert.equal(r.verdict, 'MANUAL_REQUIRED');
  assert.equal(r.findings[0].check, 'live-adapter-failed');
});

test('Increment 6: runComparison surfaces MISMATCH fields as FAIL findings when severity is CRITICAL', () => {
  const deps = makeHappyDeps();
  // Mock speaks the ENGINE's raw shape ({field, status, rule, message}) —
  // the flow renames to UI shape ({name, verdict, path, notes}) at the boundary.
  deps.compare = () => ({
    verdict: 'NOT_SAFE',
    fields: [
      { field: 'freeCreditAmount', expected: 30, actual: 20, status: 'MISMATCH', severity: 'CRITICAL', rule: 'currencies[MYR].freeCreditAmount', message: 'value differs' },
      { field: 'name', expected: 'A', actual: 'B', status: 'MISMATCH', severity: 'WARNING', rule: 'content.names.EN', message: 'copy drift' },
      { field: 'promoCode', expected: 'CODE1', actual: 'CODE1', status: 'MATCH', severity: 'CRITICAL', rule: 'identity.promoCode', message: 'ok' },
    ],
    summary: { passed: 1, failed: 1, warning: 1, unavailable: 0 },
  });
  const r = runComparison({
    brand: 'QP2A', code: 'CODE1',
    snapshot: baseSnapshot(), brandConfig: baseBrandConfig(),
    deps,
  });
  assert.equal(r.verdict, 'NOT_SAFE');
  assert.equal(r.findings.length, 2);   // MATCH not surfaced
  assert.equal(r.findings[0].severity, 'FAIL');
  assert.equal(r.findings[1].severity, 'WARNING');
  assert.equal(r.findings[0].field, 'currencies[MYR].freeCreditAmount');
  // Full fields[] still carried for the UI to render Expected-vs-Live.
  assert.equal(r.fields.length, 3);
});

test('Increment 6: runComparison _publicExpectedSource never leaks sourcePath', () => {
  const deps = makeHappyDeps();
  deps.resolveExpectedSource = () => ({
    handle: 'P100', promoCode: 'CODE1', brand: 'QP2A',
    sourceType: 'request',
    sourceId: 'P100.json',
    sourcePath: '/absolute/path/should-not-leak/P100.json',
    sourceTs: '2026-07-30T00:00:00Z',
    source: { promo_code: 'CODE1', bonus_type: 'Free Credit', parsed: {} },
  });
  const r = runComparison({
    brand: 'QP2A', code: 'CODE1', handle: 'P100',
    snapshot: baseSnapshot(), brandConfig: baseBrandConfig(),
    deps,
  });
  assert.equal(r.expectedSource.sourceId, 'P100.json');
  assert.equal(Object.prototype.hasOwnProperty.call(r.expectedSource, 'sourcePath'), false,
    'expectedSource must NOT carry sourcePath — that would leak the server filesystem into the client');
});

test('Increment 6: runComparison rejects unsupported platform (returns skip, not verdict)', () => {
  const r = runComparison({
    brand: 'QP2A', code: 'CODE1',
    snapshot: baseSnapshot({ runtime: { platform: 'weird' } }),
    brandConfig: { ...baseBrandConfig(), runtime: { platform: 'weird' } },
    deps: makeHappyDeps(),
  });
  assert.equal(r.status, 'skip');
  assert.equal(r.code, 'unsupported-platform');
});

test('regression: runComparison rewrites engine fields to the UI vocabulary (name/verdict/path/notes)', () => {
  // Acceptance surfaced this: the compare engine emits {field, status, rule, message}
  // but the UI, findings feed, and audit log all speak {name, verdict, path, notes}.
  // The rename happens once at the flow boundary. Regression-lock so a future
  // engine refactor cannot silently break the UI by changing the raw shape.
  const deps = makeHappyDeps();
  deps.compare = () => ({
    verdict: 'REVIEW',
    fields: [
      { field: 'promoCode', status: 'MATCH', severity: 'CRITICAL', rule: 'identity.promoCode', message: 'ok', expected: 'X', actual: 'X', expectedPath: 'source.promo_code', boPath: 'live.list_row.code' },
      { field: 'name', status: 'MISMATCH', severity: 'WARNING', rule: 'content.names.EN', message: 'drift', expected: 'A', actual: 'B' },
    ],
    summary: { passed: 1, failed: 0, warning: 1, unavailable: 0 },
  });
  const r = runComparison({
    brand: 'QP2A', code: 'CODE1',
    snapshot: baseSnapshot(), brandConfig: baseBrandConfig(),
    deps,
  });
  assert.equal(r.fields[0].name, 'promoCode');
  assert.equal(r.fields[0].verdict, 'MATCH');
  assert.equal(r.fields[0].path, 'identity.promoCode');
  assert.equal(r.fields[0].notes, 'ok');
  assert.equal(r.fields[1].name, 'name');
  assert.equal(r.fields[1].verdict, 'MISMATCH');
  // summary must speak `warnings` (plural) and expose `total` + `skipped`
  assert.equal(r.summary.total, 2);
  assert.equal(r.summary.warnings, 1);
  assert.equal(r.summary.skipped, 0);
});

test('regression: runComparison threads promoCode into expectedFromSource for bundle sources', () => {
  // Bundle sources don't always carry promo_code inside the source sub-block.
  // Without the fallback, every bundle-based compare reported promoCode as
  // UNAVAILABLE (surfaced by MVP acceptance run against P068-r69, P092-r93, P133-r135).
  const deps = makeHappyDeps();
  let capturedOpts = null;
  deps.expectedFromSource = (source, opts) => {
    capturedOpts = opts;
    return { identity: { promoCode: opts.promoCode }, currencies: [] };
  };
  deps.resolveExpectedSource = () => ({
    handle: 'P100', promoCode: 'BUNDLE_CODE_1', brand: 'QP2A',
    sourceType: 'bundle', sourceId: 'P100__QP2A.json',
    // source block does NOT include promo_code — bundle top-level does.
    source: { bonus_type: 'Free Credit', parsed: {} },
    promotionId: 12345,
  });
  runComparison({
    brand: 'QP2A', code: 'BUNDLE_CODE_1', handle: 'P100',
    snapshot: baseSnapshot(), brandConfig: baseBrandConfig(),
    deps,
  });
  assert.equal(capturedOpts.promoCode, 'BUNDLE_CODE_1', 'promoCode must be threaded from resolver to expectedFromSource');
  assert.equal(capturedOpts.promotionId, 12345, 'promotionId should also thread through');
  assert.equal(capturedOpts.brand, 'QP2A');
});

test('Increment 6: runComparison _safeMessage scrubs absolute filesystem paths from adapter errors', () => {
  const deps = makeHappyDeps();
  deps.liveFromPlatform = () => { throw new Error('read failed at C:\\Users\\vdiuser\\secret\\creds.json'); };
  const r = runComparison({
    brand: 'QP2A', code: 'CODE1',
    snapshot: baseSnapshot(), brandConfig: baseBrandConfig(),
    deps,
  });
  assert.doesNotMatch(r.findings[0].message, /C:\\Users\\vdiuser/, 'must not leak the Windows user path');
  assert.match(r.findings[0].message, /<server-path>/);
});
