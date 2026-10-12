// Correctness gate #2: required-vs-collected locale coverage per brand.
// "EN + ZH found" is not completeness for an ID/TH/KM brand — and a MY-only
// brand must not be penalised for lacking TH.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  regionsForBrand, requiredLocalesForBrand, requiredLanguagesForBrand,
  evaluateLocaleCoverage, evaluateLanguageCoverage, evaluateCanonicalLocaleCoverage,
  regionsFromCanonicalCurrencies, requiredRegionsForCanonical,
} from '../src/qc-dashboard/canonical/locale-matrix.js';

test('regions: QPRO tier boundary — 1-3 keep SG, 4+ are MY-only', () => {
  assert.deepEqual(regionsForBrand('QPRO1'), ['MY', 'SG']);
  assert.deepEqual(regionsForBrand('QPRO3'), ['MY', 'SG']);
  assert.deepEqual(regionsForBrand('QPRO4'), ['MY']);
  assert.deepEqual(regionsForBrand('QPRO17'), ['MY']);
});

test('regions: each WS1 site is single-region; WS2 is MY', () => {
  assert.deepEqual(regionsForBrand('WS1_MY'), ['MY']);
  assert.deepEqual(regionsForBrand('WS1_ID'), ['ID']);
  assert.deepEqual(regionsForBrand('WS1_TH'), ['TH']);
  assert.deepEqual(regionsForBrand('WS1_KH'), ['KH']);
  assert.deepEqual(regionsForBrand('WS2'), ['MY']);
});

test('required locales: MY-only brand needs exactly MY_EN + MY_ZH', () => {
  assert.deepEqual(requiredLocalesForBrand('QPRO5'), ['MY_EN', 'MY_ZH']);
});

test('required locales: Thai site needs TH locales, not MY/ZH', () => {
  assert.deepEqual(requiredLocalesForBrand('WS1_TH'), ['TH_EN', 'TH_TH']);
  assert.deepEqual(requiredLanguagesForBrand('WS1_TH'), ['EN', 'TH']);
});

test('required locales: Cambodia site needs KM', () => {
  assert.deepEqual(requiredLanguagesForBrand('WS1_KH'), ['EN', 'KM']);
});

test('required locales: QP2 shared BO spans MY/SG/ID/TH', () => {
  assert.deepEqual(requiredLanguagesForBrand('QP2A'), ['EN', 'ID', 'TH', 'ZH']);
});

test('gate2: EN+ZH is INCOMPLETE for a brand that also requires ID and TH', () => {
  const r = evaluateLanguageCoverage({ brand: 'QP2A', collectedLanguages: ['EN', 'ZH'] });
  assert.equal(r.complete, false, 'EN+ZH must not be reported complete for QP2A');
  assert.deepEqual(r.missing, ['ID', 'TH']);
});

test('gate2: EN+ZH IS complete for a MY-only brand', () => {
  const r = evaluateLanguageCoverage({ brand: 'QPRO5', collectedLanguages: ['EN', 'ZH'] });
  assert.equal(r.complete, true);
  assert.deepEqual(r.missing, []);
});

test('gate2: irrelevant locales are never required (no TH demand on a MY brand)', () => {
  const r = evaluateLocaleCoverage({ brand: 'WS1_MY', collectedLocales: ['MY_EN', 'MY_ZH'] });
  assert.equal(r.complete, true);
  assert.ok(!r.required.some((l) => /^TH_/.test(l)), 'MY brand must not require TH locales');
});

test('gate2: extra locales are informational, not a failure', () => {
  const r = evaluateLocaleCoverage({ brand: 'WS1_MY', collectedLocales: ['MY_EN', 'MY_ZH', 'SG_EN'] });
  assert.equal(r.complete, true);
  assert.deepEqual(r.extra, ['SG_EN']);
});

test('gate2: unmapped brand yields no requirement rather than a fabricated one', () => {
  const r = evaluateLocaleCoverage({ brand: 'MYSTERY', collectedLocales: [] });
  assert.deepEqual(r.required, []);
  assert.equal(r.complete, true);
});

// ── Per-promo scope (2026-08-11): requirement follows currency footprint ──

test('scope: regions come from the promo\'s currencies, not the brand max', () => {
  assert.deepEqual(regionsFromCanonicalCurrencies({ currencies: [{ code: 'MYR' }, { code: 'SGD' }] }), ['MY', 'SG']);
  assert.deepEqual(regionsFromCanonicalCurrencies({ currencies: [{ code: 'MYR' }] }), ['MY']);
  assert.deepEqual(regionsFromCanonicalCurrencies({ currencies: [] }), []);
});

test('scope: a MY/SG-only promo on a 4-region QP2 brand requires only MY/SG', () => {
  const canonical = { identity: { brand: 'QP2A' }, currencies: [{ code: 'MYR' }, { code: 'SGD' }] };
  assert.deepEqual(requiredRegionsForCanonical(canonical, 'QP2A'), ['MY', 'SG']);
  const cov = evaluateCanonicalLocaleCoverage(canonical, { brand: 'QP2A' });
  assert.deepEqual(cov.promotionName.required, ['MY_EN', 'MY_ZH', 'SG_EN', 'SG_ZH']);
});

test('scope: a promo with no mappable currency falls back to the full brand scope (over-check, never under-check)', () => {
  const canonical = { identity: { brand: 'QP2A' }, currencies: [] };
  assert.deepEqual(requiredRegionsForCanonical(canonical, 'QP2A'), ['MY', 'SG', 'ID', 'TH']);
});

test('scope: an unmapped brand still fabricates NO requirement even if the promo has a currency', () => {
  const canonical = { identity: { brand: 'MYSTERY' }, currencies: [{ code: 'MYR' }] };
  assert.deepEqual(requiredRegionsForCanonical(canonical, 'MYSTERY'), []);
});

test('scope: the promo footprint never widens beyond the brand — a QPRO5 (MY-only) promo priced in SGD still caps to MY', () => {
  // Defensive: even if a currency appears that the brand doesn't serve, the
  // requirement can't exceed the brand's regions.
  const canonical = { identity: { brand: 'QPRO5' }, currencies: [{ code: 'SGD' }] };
  assert.deepEqual(requiredRegionsForCanonical(canonical, 'QPRO5'), ['MY']);
});

test('gate2: canonical-wide evaluation separates name coverage from MT coverage', () => {
  const canonical = {
    identity: { brand: 'QPRO1' },
    content: {
      names: { EN: 'n' },
      promotionNamesByLocale: { MY_EN: 'n' },                       // missing MY_ZH/SG_*
      messageTemplate: { subjectByLocale: { MY_EN: 's', MY_ZH: 's', SG_EN: 's', SG_ZH: 's' }, bodyByLocale: {} },
      mtBody: { EN: 'b', ZH: 'b' },
      dialogBody: {},
      localesDeclared: ['MY_EN'],
    },
  };
  const r = evaluateCanonicalLocaleCoverage(canonical, { brand: 'QPRO1' });
  assert.equal(r.promotionName.complete, false, 'promotion name is short 3 locales');
  assert.deepEqual(r.promotionName.missing, ['MY_ZH', 'SG_EN', 'SG_ZH']);
  assert.equal(r.messageTemplateSubject.complete, true, 'MT subject coverage is full and reported separately');
  assert.equal(r.dialogBodyLanguages.complete, false, 'no dialog body collected yet');
});
