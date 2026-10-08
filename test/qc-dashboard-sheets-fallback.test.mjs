// Collector item 5 tests — cached, read-only Promo Request Sheet fallback.
//
// All Sheets access is dependency-injected (ingestImpl / listTabsImpl /
// sheetsClientImpl) so these tests never touch the network or require real
// OAuth credentials — matching the "runs only where credentials exist,
// never throws into a QC run" contract the module documents.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveExpectedSourceFromSheet, _clearSheetsFallbackCache,
} from '../src/qc-dashboard/sheets-fallback.js';
import { runComparisonWithSheetsFallback } from '../src/qc-dashboard/compare-flow.js';

test.beforeEach((t) => {
  _clearSheetsFallbackCache();
  // These fixtures model August as current month; do not depend on today's date.
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-15T12:00:00Z') });
});

function record(overrides = {}) {
  return {
    handle: 'P200', promo_code: 'FT_QPRO1_TEST', brands: ['QPRO1'],
    status: 'QC Completed', bonus_type: 'Deposit', parsed: {},
    ...overrides,
  };
}

// ── basic resolution ─────────────────────────────────────────────────────

test('resolveExpectedSourceFromSheet finds an exact promo_code+brand match in the current-month tab', async () => {
  const ingestImpl = async () => ({ tab: 'August 2026', records: [record()] });
  const result = await resolveExpectedSourceFromSheet({ brand: 'QPRO1', code: 'FT_QPRO1_TEST', ingestImpl, monthsToSearch: 1 });
  assert.equal(result.sourceType, 'sheet');
  assert.equal(result.sourceId, 'sheet:August 2026::P200');
  assert.equal(result.promoCode, 'FT_QPRO1_TEST');
  assert.equal(result.brand, 'QPRO1');
  assert.equal(result.source.handle, 'P200');
  assert.equal(result.approvalStatus, 'QC Completed');
});

test('resolveExpectedSourceFromSheet finds an exact handle+brand match, checking only the current-month tab', async () => {
  let calls = 0;
  const ingestImpl = async () => { calls += 1; return { tab: 'August 2026', records: [record()] }; };
  const result = await resolveExpectedSourceFromSheet({ brand: 'QPRO1', handle: 'P200', ingestImpl });
  assert.equal(result.sourceType, 'sheet');
  assert.equal(result.handle, 'P200');
  assert.equal(calls, 1, 'handle lookups must never search past-month tabs');
});

test('resolveExpectedSourceFromSheet returns not-found when brand does not match the row', async () => {
  const ingestImpl = async () => ({ tab: 'August 2026', records: [record({ brands: ['QPRO2'] })] });
  const result = await resolveExpectedSourceFromSheet({ brand: 'QPRO1', code: 'FT_QPRO1_TEST', ingestImpl, monthsToSearch: 1 });
  assert.equal(result.sourceType, 'not-found');
});

test('resolveExpectedSourceFromSheet returns not-found (never throws) when the sheet/credentials are unavailable', async () => {
  const ingestImpl = async () => { throw new Error('no OAuth token file on this host'); };
  const result = await resolveExpectedSourceFromSheet({ brand: 'QPRO1', code: 'FT_QPRO1_TEST', ingestImpl, monthsToSearch: 1 });
  assert.equal(result.sourceType, 'not-found');
});

test('resolveExpectedSourceFromSheet requires brand and (code or handle)', async () => {
  assert.equal((await resolveExpectedSourceFromSheet({ code: 'X' })).sourceType, 'invalid');
  assert.equal((await resolveExpectedSourceFromSheet({ brand: 'QPRO1' })).sourceType, 'invalid');
});

// ── circularity guard: code mismatch is rejected, never silently accepted ──

test('resolveExpectedSourceFromSheet rejects a resolved row whose code does not match what was requested', async () => {
  const ingestImpl = async () => ({ tab: 'August 2026', records: [record({ handle: 'P201' })] });
  // Ask by handle P201, but assert the code we actually expected was different —
  // simulates an index/handle drift; must not silently substitute the wrong row.
  const result = await resolveExpectedSourceFromSheet({ brand: 'QPRO1', code: 'DIFFERENT_CODE', handle: 'P201', ingestImpl, monthsToSearch: 1 });
  assert.equal(result.sourceType, 'not-found');
});

// ── multi-month search (no-handle path only) ─────────────────────────────

test('resolveExpectedSourceFromSheet searches past months for an exact code+brand match when no handle is given', async () => {
  const ingestImpl = async ({ tabNameOverride }) => {
    if (tabNameOverride === 'July 2026') return { tab: 'July 2026', records: [record({ handle: 'P150' })] };
    return { tab: 'August 2026', records: [] }; // current month: nothing
  };
  const listTabsImpl = async () => [{ name: 'August 2026' }, { name: 'July 2026' }, { name: 'June 2026' }];
  const sheetsClientImpl = async () => ({});
  const result = await resolveExpectedSourceFromSheet({
    brand: 'QPRO1', code: 'FT_QPRO1_TEST', monthsToSearch: 2, ingestImpl, listTabsImpl, sheetsClientImpl,
  });
  assert.equal(result.sourceType, 'sheet');
  assert.equal(result.sourceId, 'sheet:July 2026::P150');
});

test('resolveExpectedSourceFromSheet respects monthsToSearch — a match 2 months back is NOT found when monthsToSearch=1', async () => {
  const ingestImpl = async ({ tabNameOverride }) => {
    if (tabNameOverride === 'June 2026') return { tab: 'June 2026', records: [record({ handle: 'P100' })] };
    return { tab: tabNameOverride || 'August 2026', records: [] };
  };
  const listTabsImpl = async () => [{ name: 'August 2026' }, { name: 'July 2026' }, { name: 'June 2026' }];
  const sheetsClientImpl = async () => ({});
  const result = await resolveExpectedSourceFromSheet({
    brand: 'QPRO1', code: 'FT_QPRO1_TEST', monthsToSearch: 1, ingestImpl, listTabsImpl, sheetsClientImpl,
  });
  assert.equal(result.sourceType, 'not-found', 'monthsToSearch=1 means current month only — June must not be consulted');
});

test('resolveExpectedSourceFromSheet reports ambiguous when the same code+brand appears in two distinct months', async () => {
  const ingestImpl = async ({ tabNameOverride }) => {
    if (tabNameOverride === 'July 2026') return { tab: 'July 2026', records: [record({ handle: 'P150' })] };
    return { tab: 'August 2026', records: [record({ handle: 'P200' })] };
  };
  const listTabsImpl = async () => [{ name: 'August 2026' }, { name: 'July 2026' }];
  const sheetsClientImpl = async () => ({});
  const result = await resolveExpectedSourceFromSheet({
    brand: 'QPRO1', code: 'FT_QPRO1_TEST', monthsToSearch: 2, ingestImpl, listTabsImpl, sheetsClientImpl,
  });
  assert.equal(result.sourceType, 'ambiguous');
  assert.equal(result.matches.length, 2);
});

// ── caching ───────────────────────────────────────────────────────────────

test('resolveExpectedSourceFromSheet caches a tab within TTL — ingestImpl not re-called', async () => {
  let calls = 0;
  const ingestImpl = async () => { calls += 1; return { tab: 'August 2026', records: [record()] }; };
  await resolveExpectedSourceFromSheet({ brand: 'QPRO1', code: 'FT_QPRO1_TEST', ingestImpl, now: 1000, ttlMs: 5000, monthsToSearch: 1 });
  await resolveExpectedSourceFromSheet({ brand: 'QPRO1', code: 'FT_QPRO1_TEST', ingestImpl, now: 2000, ttlMs: 5000, monthsToSearch: 1 });
  assert.equal(calls, 1);
});

// ── runComparisonWithSheetsFallback (compare-flow.js integration) ───────

function baseSnapshot() {
  return {
    raw: {
      listingRow: { code: 'CODE1', id: 1, bonus_type: 'Free Credit' },
      detail: { code: 'CODE1', promotion_currency_list: [{ currency: 'MYR', free_credit_amount: 30, min_transfer: 0 }], auto_reward_activation: true },
      currencies: [],
    },
    runtime: { platform: 'qp2', siteId: 'ibc22mys' },
  };
}
function baseBrandConfig() {
  return { id: 'QP2A', qcRules: { mvp: true }, runtime: { platform: 'qp2', siteId: 'ibc22mys' } };
}
function compareStubs() {
  return {
    expectedFromSource: () => ({ identity: { promoCode: 'CODE1', bonusType: 'FREE_CREDIT' }, currencies: [{ code: 'MYR' }] }),
    liveFromPlatform: () => ({ identity: { promoCode: 'CODE1', bonusType: 'FREE_CREDIT', promotionId: 42 }, currencies: [{ code: 'MYR' }] }),
    compare: () => ({
      verdict: 'SAFE',
      fields: [{ name: 'promoCode', expected: 'CODE1', actual: 'CODE1', verdict: 'MATCH', severity: 'CRITICAL', path: 'identity.promoCode', notes: 'ok' }],
      summary: { total: 1, passed: 1, failed: 0, warnings: 0, unavailable: 0, skipped: 0 },
    }),
  };
}

test('runComparisonWithSheetsFallback never consults the sheet when the local resolver already found a source', async () => {
  const localSource = {
    handle: 'P100', promoCode: 'CODE1', brand: 'QP2A', sourceType: 'bundle', sourceId: 'P100__QP2A.json',
    source: { promo_code: 'CODE1', bonus_type: 'Free Credit', parsed: {} },
  };
  const r = await runComparisonWithSheetsFallback({
    brand: 'QP2A', code: 'CODE1', handle: 'P100', snapshot: baseSnapshot(), brandConfig: baseBrandConfig(),
    deps: {
      resolveExpectedSource: () => localSource,
      resolveExpectedSourceFromSheet: async () => { throw new Error('must not be called — local already resolved'); },
      ...compareStubs(),
    },
  });
  assert.equal(r.verdict, 'SAFE');
  assert.equal(r.expectedSource.sourceType, 'bundle');
});

test('runComparisonWithSheetsFallback uses the sheet result when local resolution is not-found', async () => {
  const sheetSource = {
    handle: 'P200', promoCode: 'CODE1', brand: 'QP2A', sourceType: 'sheet', sourceId: 'sheet:August 2026::P200',
    source: { promo_code: 'CODE1', bonus_type: 'Free Credit', parsed: {} },
  };
  const r = await runComparisonWithSheetsFallback({
    brand: 'QP2A', code: 'CODE1', snapshot: baseSnapshot(), brandConfig: baseBrandConfig(),
    deps: {
      resolveExpectedSource: () => ({ sourceType: 'not-found', reason: 'nothing local' }),
      resolveExpectedSourceFromSheet: async () => sheetSource,
      ...compareStubs(),
    },
  });
  assert.equal(r.verdict, 'SAFE');
  assert.equal(r.expectedSource.sourceType, 'sheet', 'the sheet-sourced expectation must be visible in the audit trail, not silently indistinguishable from a local one');
});

test('runComparisonWithSheetsFallback falls through to MANUAL_REQUIRED when BOTH local and sheet are not-found', async () => {
  const r = await runComparisonWithSheetsFallback({
    brand: 'QP2A', code: 'CODE1', snapshot: baseSnapshot(), brandConfig: baseBrandConfig(),
    deps: {
      resolveExpectedSource: () => ({ sourceType: 'not-found', reason: 'nothing local' }),
      resolveExpectedSourceFromSheet: async () => ({ sourceType: 'not-found', reason: 'nothing in sheet either' }),
      ...compareStubs(),
    },
  });
  assert.equal(r.verdict, 'MANUAL_REQUIRED');
  assert.equal(r.findings[0].check, 'expected-source-unresolved');
});

test('runComparisonWithSheetsFallback does not let a local ambiguity be overridden by a sheet match', async () => {
  const r = await runComparisonWithSheetsFallback({
    brand: 'QP2A', code: 'CODE1', snapshot: baseSnapshot(), brandConfig: baseBrandConfig(),
    deps: {
      resolveExpectedSource: () => ({ sourceType: 'ambiguous', reason: 'two local files match', matches: [{ kind: 'bundle' }, { kind: 'request' }] }),
      resolveExpectedSourceFromSheet: async () => { throw new Error('must not be called — local ambiguity is authoritative'); },
      ...compareStubs(),
    },
  });
  assert.equal(r.verdict, 'MANUAL_REQUIRED');
  assert.equal(r.expectedSource.sourceType, 'ambiguous');
});

test('runComparisonWithSheetsFallback treats a sheet-resolver exception as unavailable, never crashes the run', async () => {
  const r = await runComparisonWithSheetsFallback({
    brand: 'QP2A', code: 'CODE1', snapshot: baseSnapshot(), brandConfig: baseBrandConfig(),
    deps: {
      resolveExpectedSource: () => ({ sourceType: 'not-found', reason: 'nothing local' }),
      resolveExpectedSourceFromSheet: async () => { throw new Error('boom'); },
      ...compareStubs(),
    },
  });
  assert.equal(r.verdict, 'MANUAL_REQUIRED');
});
