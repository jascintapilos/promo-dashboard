// Blocker 3 fix: regression tests for brand/site currency scoping.
// A multi-region approved request (MY + SG) fanning out to WS1_MY (MY-only)
// must NOT produce a false FAIL on SGD — that currency lives on WS1_SG's
// separate BO. The expected-adapter filters source.currencies to the
// currencies the TARGET brand's BO can actually carry.

import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedFromSource } from '../src/qc-dashboard/canonical/expected-adapter.js';
import { allowedCurrenciesForBrand } from '../src/qc-dashboard/canonical/brand-currencies.js';

// ── allowedCurrenciesForBrand table ─────────────────────────────────────

test('brand-currencies: IGMP sites map 1:1 to their region currency', () => {
  assert.deepEqual(allowedCurrenciesForBrand({ brand: 'WS1_MY', platform: 'igmp', siteId: 'ws1-v3-my' }), ['MYR']);
  assert.deepEqual(allowedCurrenciesForBrand({ brand: 'WS1_SG', platform: 'igmp', siteId: 'ws1-v3-sg' }), ['SGD']);
  assert.deepEqual(allowedCurrenciesForBrand({ brand: 'WS1_ID', platform: 'igmp', siteId: 'ws1-v3-id' }), ['IDR']);
  assert.deepEqual(allowedCurrenciesForBrand({ brand: 'WS1_TH', platform: 'igmp', siteId: 'ws1-v3-th' }), ['THB']);
  assert.deepEqual(allowedCurrenciesForBrand({ brand: 'WS1_KH', platform: 'igmp', siteId: 'ws1-v3-kh' }), ['USD']);
  assert.deepEqual(allowedCurrenciesForBrand({ brand: 'WS2',    platform: 'igmp', siteId: 'ws2'        }), ['MYR']);
});

test('brand-currencies: QPRO tiered — 1..3 keep SGD, 4..17 are MY-only', () => {
  assert.deepEqual(allowedCurrenciesForBrand({ brand: 'QPRO1', platform: 'qpro' }), ['MYR', 'SGD']);
  assert.deepEqual(allowedCurrenciesForBrand({ brand: 'QPRO3', platform: 'qpro' }), ['MYR', 'SGD']);
  assert.deepEqual(allowedCurrenciesForBrand({ brand: 'QPRO4', platform: 'qpro' }), ['MYR']);
  assert.deepEqual(allowedCurrenciesForBrand({ brand: 'QPRO5', platform: 'qpro' }), ['MYR']);
  assert.deepEqual(allowedCurrenciesForBrand({ brand: 'QPRO17', platform: 'qpro' }), ['MYR']);
});

test('brand-currencies: QP2 merchants share ibc22 BO — no filter (multi-currency)', () => {
  const cur = allowedCurrenciesForBrand({ brand: 'QP2A', platform: 'qp2' });
  assert.ok(cur.includes('MYR') && cur.includes('SGD') && cur.includes('IDR'));
});

test('brand-currencies: unknown brand returns null (don\'t drop data on unknown mappings)', () => {
  assert.equal(allowedCurrenciesForBrand({ brand: 'MYSTERY', platform: 'qpro' }), null);
  assert.equal(allowedCurrenciesForBrand({ brand: 'WS1_UNKNOWN', platform: 'igmp', siteId: 'nope' }), null);
});

// ── expectedFromSource scoping regression ────────────────────────────────

test('regression: multi-region source (MY+SG) → WS1_MY expected has ONLY MYR', () => {
  // This is exactly the shape that surfaced the SGD false-FAIL on
  // P133-r135__WS1_MY in live acceptance.
  const source = {
    promo_code: 'FT_RET_CHURN_FS_GOO',
    regions: ['MY', 'SG'],
    currencies: ['MYR', 'SGD'],
    bonus_type: 'Free Spin',
    parsed: { spin_count: 68, value_per_spin: 0.4, to_multiplier: 10, min_deposit: 0 },
  };
  const c = expectedFromSource(source, { brand: 'WS1_MY', platform: 'igmp', siteId: 'ws1-v3-my' });
  assert.deepEqual(c.currencies.map((x) => x.code), ['MYR'], 'WS1_MY only carries MYR — SGD must be filtered');
});

test('regression: WS1_SG projection from the same multi-region source has only SGD', () => {
  const source = {
    promo_code: 'FT_RET_CHURN_FS_GOO',
    regions: ['MY', 'SG'],
    currencies: ['MYR', 'SGD'],
    bonus_type: 'Free Spin',
    parsed: { spin_count: 68, value_per_spin: 0.4, to_multiplier: 10, min_deposit: 0 },
  };
  const c = expectedFromSource(source, { brand: 'WS1_SG', platform: 'igmp', siteId: 'ws1-v3-sg' });
  assert.deepEqual(c.currencies.map((x) => x.code), ['SGD']);
});

test('regression: QPRO5 (MY-only) drops SGD from a multi-region source, keeps MYR', () => {
  const source = {
    promo_code: 'TEST_DEP',
    regions: ['MY', 'SG'],
    currencies: ['MYR', 'SGD'],
    bonus_type: 'Deposit',
    parsed: { min_deposit: 100, bonus_rate_pct: 30, to_multiplier: 8, max_bonus: 500 },
  };
  const c = expectedFromSource(source, { brand: 'QPRO5', platform: 'qpro' });
  assert.deepEqual(c.currencies.map((x) => x.code), ['MYR'], 'QPRO5 is MY-only — SGD must be filtered');
});

test('regression: QPRO1 (full-region) keeps both MYR and SGD from a multi-region source', () => {
  const source = {
    promo_code: 'TEST_DEP',
    regions: ['MY', 'SG'],
    currencies: ['MYR', 'SGD'],
    bonus_type: 'Deposit',
    parsed: { min_deposit: 100, bonus_rate_pct: 30, to_multiplier: 8, max_bonus: 500 },
  };
  const c = expectedFromSource(source, { brand: 'QPRO1', platform: 'qpro' });
  assert.deepEqual(c.currencies.map((x) => x.code).sort(), ['MYR', 'SGD']);
});

test('regression: filter never DROPS a currency the platform SHOULD support (safety net for unknown brands)', () => {
  // Unknown brand → filter is null → no filtering happens → source declarations preserved.
  const source = {
    promo_code: 'X',
    regions: ['MY', 'SG'],
    currencies: ['MYR', 'SGD'],
    bonus_type: 'Free Credit',
  };
  const c = expectedFromSource(source, { brand: 'MYSTERY_BRAND' });
  assert.deepEqual(c.currencies.map((x) => x.code).sort(), ['MYR', 'SGD'], 'unknown brand must not silently drop data');
});
