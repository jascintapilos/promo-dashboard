// Increment 5 (real-QC upgrade): tests for src/qc-dashboard/compare-engine.js
//
// Covers every verdict branch (SAFE / REVIEW / NOT_SAFE / MANUAL_REQUIRED),
// per-field rule behavior, and the platform quirks documented in
// .codex/agents/sentinel.toml.

import test from 'node:test';
import assert from 'node:assert/strict';
import { compare } from '../src/qc-dashboard/compare-engine.js';
import { expectedFromSource, liveFromQpro, liveFromQp2, liveFromIgmp } from '../src/qc-dashboard/canonical/index.js';
import { BONUS_TYPES } from '../src/qc-dashboard/canonical/canonical-model.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Item 6: locale-completeness is now wired into the verdict (compare-engine.js
// ruleLocaleCompleteness), so every fixture representing a "fully matching,
// should reach SAFE" promo needs locale-complete content too. QP2A requires
// 8 locales (MY/SG/ID/TH x EN/local-language) for promotion name and 4
// languages for MT body. TH_EN/TH_TH have no known settings_locale_id
// mapping in listing-row-fields.js's SETTINGS_LOCALE_ID_MAP yet (a separate,
// open collector gap — not invented here), so the REAL adapter path cannot
// currently produce TH content from raw BO fields. This helper synthesizes
// complete locale content directly on the CANONICAL result (post-adapter)
// purely to isolate these tests' actual subject (currency/category/auto-
// reward/etc) from that unrelated, unresolved gap — it is test-only
// scaffolding, never a claim that the real collector can produce this today.
function withCompleteLocaleContent(canonical, { languages = ['EN', 'ZH', 'ID', 'TH'], locales = ['MY_EN', 'MY_ZH', 'SG_EN', 'SG_ZH', 'ID_EN', 'ID_ID', 'TH_EN', 'TH_TH'] } = {}) {
  for (const l of languages) { canonical.content.names[l] = `Test Promo ${l}`; canonical.content.mtBody[l] = `<p>Test MT body ${l}</p>`; }
  for (const loc of locales) canonical.content.promotionNamesByLocale[loc] = `Test Promo ${loc}`;
  return canonical;
}

// Fresh minimally-complete QP2 FC pair (SAFE reference)
function qp2FcExpected() {
  return expectedFromSource({
    promo_code: 'FT_QP2A_FC', brands: ['QP2A'], currencies: ['MYR'], regions: ['MY'],
    bonus_type: 'Free Credit',
    validity_days: 7, rewards_validity_days: 3,
    parsed: { free_credit_amount: 30, min_deposit: 0, to_multiplier: 5, categories: [] },
    per_currency_overrides: { MYR: { free_credit_amount: 30 } },
  }, { brand: 'QP2A' });
}
function qp2FcLive() {
  const c = liveFromQp2({
    list_row: {
      id: 999, code: 'FT_QP2A_FC', bonus_type: 'Free Credit',
      validity: 7, reward_validity: 3, status: 1,
      merchant_ids: [1], dialog_popup_list: [{ popup_id: 100 }],
      message_template_id: 500,
    },
    detail: {
      promotion_currency_list: [{ currency: 'MYR', currency_id: 1, free_credit_amount: 30, min_transfer: 0, status: 1 }],
      to_multiplier: 5, allow_deposit: false, categories: [], game_provider_ids: [],
      // A successfully-saved QP2 promo has this field ON. Without it, the
      // compare engine correctly emits MANUAL_REQUIRED for the missing
      // evidence (which is the invariant — no PASS without live evidence).
      auto_reward_activation: true,
    },
  }, { brand: 'QP2A' });
  return withCompleteLocaleContent(c);
}

test('Increment 5: SAFE — every critical field matches, no warnings', () => {
  const r = compare({ expected: qp2FcExpected(), actual: qp2FcLive(), brand: 'QP2A' });
  assert.equal(r.verdict, 'SAFE', `expected SAFE, got ${r.verdict}; failed fields: ${r.fields.filter(f=>f.status==='MISMATCH').map(f=>f.field).join(',')}`);
  assert.ok(r.summary.passed > 0);
  assert.equal(r.summary.failed, 0);
  assert.equal(r.summary.unavailable, 0);
});

test('Increment 5: NOT_SAFE — critical mismatch on promoCode', () => {
  const exp = qp2FcExpected();
  const act = qp2FcLive();
  act.identity.promoCode = 'DIFFERENT_CODE';
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  assert.equal(r.verdict, 'NOT_SAFE');
  assert.ok(r.fields.some((f) => f.field === 'promoCode' && f.status === 'MISMATCH' && f.severity === 'CRITICAL'));
});

test('Increment 5: NOT_SAFE — critical mismatch on bonusType', () => {
  const exp = qp2FcExpected();
  const act = qp2FcLive();
  act.identity.bonusType = 'DEPOSIT';
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  assert.equal(r.verdict, 'NOT_SAFE');
});

test('Increment 5: NOT_SAFE — currency mechanics mismatch', () => {
  const exp = qp2FcExpected();
  const act = qp2FcLive();
  act.currencies[0].freeCreditAmount = 25; // expected 30
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  assert.equal(r.verdict, 'NOT_SAFE');
  assert.ok(r.fields.some((f) => f.field === 'currency:MYR:freeCreditAmount' && f.status === 'MISMATCH'));
});

test('Increment 5: MANUAL_REQUIRED — critical field unavailable on live', () => {
  const exp = qp2FcExpected();
  const act = qp2FcLive();
  act.identity.promoCode = null; // simulates missing live evidence
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  assert.equal(r.verdict, 'MANUAL_REQUIRED', 'missing critical evidence must be MANUAL_REQUIRED, never PASS');
});

test('Increment 5: MANUAL_REQUIRED — currency present on expected but absent on live (MYR)', () => {
  const exp = qp2FcExpected();
  const act = qp2FcLive();
  act.currencies = []; // wipe out currency data on live
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  assert.equal(r.verdict, 'NOT_SAFE'); // presence check is CRITICAL MISMATCH
});

test('Increment 5: REVIEW — warning-level mismatch only (extra currency in live)', () => {
  const exp = qp2FcExpected();
  const act = qp2FcLive();
  act.currencies.push({ code: 'SGD', minDeposit: 0, maxBonus: null, bonusRatePct: null, freeCreditAmount: 30, spinCount: null, valuePerSpin: null, toMultiplier: 5, maxTransferOut: null, withdrawalCap: null, active: true });
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  assert.equal(r.verdict, 'REVIEW');
});

test('Item 3 fix: QPRO auto-reward genuinely absent (no auto_approve, no auto_reward_activation) → UNAVAILABLE/CRITICAL → MANUAL_REQUIRED, never silently SKIPPED', () => {
  // Pre-item-3 this SKIPPED unconditionally on the (disproven) theory that
  // QPRO's GET API never exposes auto-reward evidence at all. Now that
  // auto_approve is a trusted proxy, a record that carries NEITHER field is a
  // genuine evidence gap, not a permanent platform limitation — and per the
  // standing invariant, missing critical evidence must resolve to
  // MANUAL_REQUIRED, never a silent pass-through.
  const exp = expectedFromSource({
    promo_code: 'QPRO_REL', brands: ['QPRO1'], currencies: ['MYR'], regions: ['MY'],
    bonus_type: 'Deposit', parsed: { min_deposit: 100, bonus_rate_pct: 30, to_multiplier: 8, max_bonus: 500 },
    per_currency_overrides: { MYR: { min_deposit: 100 } },
  }, { brand: 'QPRO1' });
  const act = liveFromQpro({
    list_row: { id: 1, code: 'QPRO_REL', bonus_type: 'Deposit - Reload', status: 1 },
    detail: {
      promotion_currency_list: [{ currency: 'MYR', currency_id: 1, status: 1 }],
      per_currency_overrides: { MYR: { min_deposit: 100, max_bonus: 500, bonus_rate: 30 } },
      to_multiplier: 8, auto_reward_activation: null, // neither field present anywhere
    },
  }, { brand: 'QPRO1' });
  const r = compare({ expected: exp, actual: act, brand: 'QPRO1' });
  const arField = r.fields.find((f) => f.field === 'autoRewardActivation');
  assert.equal(arField.status, 'UNAVAILABLE');
  assert.equal(arField.severity, 'CRITICAL');
  assert.equal(r.verdict, 'MANUAL_REQUIRED', 'genuinely missing auto-reward evidence must force MANUAL_REQUIRED, never an implicit pass');
});

test('Item 3 fix: QPRO auto_approve present → real MATCH/MISMATCH, no longer permanently SKIPPED', () => {
  const baseExpected = () => expectedFromSource({
    promo_code: 'QPRO_REL2', brands: ['QPRO1'], currencies: ['MYR'], regions: ['MY'],
    bonus_type: 'Deposit', parsed: { min_deposit: 100, bonus_rate_pct: 30, to_multiplier: 8, max_bonus: 500 },
    per_currency_overrides: { MYR: { min_deposit: 100 } },
  }, { brand: 'QPRO1' });
  const liveWithAutoApprove = (autoApprove) => liveFromQpro({
    list_row: { id: 2, code: 'QPRO_REL2', bonus_type: 'Deposit - Reload', status: 1, auto_approve: autoApprove },
    detail: {
      promotion_currency_list: [{ currency: 'MYR', currency_id: 1, status: 1 }],
      per_currency_overrides: { MYR: { min_deposit: 100, max_bonus: 500, bonus_rate: 30 } },
      to_multiplier: 8,
    },
  }, { brand: 'QPRO1' });

  // Expected defaults to auto-reward ON (expectedFromSource never asserts
  // auto_reward_off here) — live auto_approve=1 must MATCH, not SKIP.
  const rOn = compare({ expected: baseExpected(), actual: liveWithAutoApprove(1), brand: 'QPRO1' });
  const arOn = rOn.fields.find((f) => f.field === 'autoRewardActivation');
  assert.equal(arOn.status, 'MATCH');
  assert.equal(arOn.severity, 'CRITICAL');

  // A live promo that is genuinely OFF (confirmed to exist: 522/7324 in the
  // item-3 live sweep) must now surface as a real MISMATCH against the
  // ON-by-default expectation, not be hidden behind SKIPPED.
  const rOff = compare({ expected: baseExpected(), actual: liveWithAutoApprove(0), brand: 'QPRO1' });
  const arOff = rOff.fields.find((f) => f.field === 'autoRewardActivation');
  assert.equal(arOff.status, 'MISMATCH');
  assert.equal(arOff.severity, 'CRITICAL');
  assert.equal(rOff.verdict, 'NOT_SAFE');
});

test('Increment 5 + Blocker 3: QPRO4-17 no-SG quirk — SGD filtered from expected, never surfaces as field', () => {
  // Blocker 3 fix: expectedFromSource now scopes source.currencies to the
  // target brand. For QPRO5 (MY-only per allowedCurrenciesForBrand), the
  // multi-region source ['MYR', 'SGD'] is filtered to ['MYR'] at the
  // adapter boundary — so no SGD field is emitted at all. Compare engine
  // then never sees it, and there is nothing to SKIP or MISMATCH.
  const exp = expectedFromSource({
    promo_code: 'QPRO5_REL', brands: ['QPRO5'], currencies: ['MYR', 'SGD'], regions: ['MY', 'SG'],
    bonus_type: 'Deposit',
    parsed: { min_deposit: 100, bonus_rate_pct: 30, to_multiplier: 8, max_bonus: 500 },
    per_currency_overrides: { MYR: { min_deposit: 100 }, SGD: { min_deposit: 150 } },
  }, { brand: 'QPRO5', platform: 'qpro' });
  assert.deepEqual(exp.currencies.map((c) => c.code), ['MYR'], 'QPRO5 must expect only MYR — SGD is filtered');
  const act = liveFromQpro({
    list_row: { id: 2, code: 'QPRO5_REL', bonus_type: 'Deposit - Reload', status: 1 },
    detail: {
      promotion_currency_list: [{ currency: 'MYR', currency_id: 1, status: 1, min_transfer: 100, max_bonus: 500, bonus_rate: 30 }],
      to_multiplier: 8,
    },
  }, { brand: 'QPRO5' });
  const r = compare({ expected: exp, actual: act, brand: 'QPRO5' });
  const sgdPresence = r.fields.find((f) => f.field === 'currency:SGD:present');
  assert.equal(sgdPresence, undefined, 'SGD must not appear as a field at all — filtered from expected');
  assert.notEqual(r.verdict, 'NOT_SAFE', 'no SGD false-FAIL');
});

test('Increment 5: category restricted but providers empty → FAIL (bypass risk)', () => {
  const exp = expectedFromSource({
    promo_code: 'QP2_SLOTS_ONLY', brands: ['QP2A'], currencies: ['MYR'], regions: ['MY'],
    bonus_type: 'Free Credit',
    parsed: { free_credit_amount: 30, min_deposit: 0, to_multiplier: 5, categories: ['Slots'] },
    per_currency_overrides: { MYR: { free_credit_amount: 30 } },
  }, { brand: 'QP2A' });
  const act = liveFromQp2({
    list_row: { id: 3, code: 'QP2_SLOTS_ONLY', bonus_type: 'Free Credit', status: 1, merchant_ids: [1], message_template_id: 1, dialog_popup_list: [{ popup_id: 100 }] },
    detail: {
      promotion_currency_list: [{ currency: 'MYR', currency_id: 1, free_credit_amount: 30, status: 1 }],
      to_multiplier: 5, categories: ['Slots'],
      game_provider_ids: [], game_provider_codes: [], // BYPASS RISK
    },
  }, { brand: 'QP2A' });
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  const cpc = r.fields.find((f) => f.field === 'categoryProviderConsistency');
  assert.equal(cpc.status, 'MISMATCH');
  assert.equal(cpc.severity, 'CRITICAL');
  assert.equal(r.verdict, 'NOT_SAFE');
});

test('Increment 5: category sets compared unordered (case-normalized)', () => {
  const exp = qp2FcExpected();
  exp.scope.categories = ['LIVE_CASINO', 'SLOTS'];
  const act = qp2FcLive();
  act.scope.categories = ['SLOTS', 'LIVE_CASINO']; // reversed order — same set
  act.scope.gameProviderCodes = ['LIVE22', 'PP']; // has providers → consistency check passes
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  const catField = r.fields.find((f) => f.field === 'categories');
  assert.equal(catField.status, 'MATCH', 'unordered category set must match');
});

// Gap-closure category-alignment fix (2026-08-11): a promo whose approved
// source has no category restriction always came back from a live save with
// this codebase's OWN no-restriction default (src/api-mapper-qpro.js
// ALLOWED_WALLET_CATEGORY_NAMES for non-FS, FS_ONLY_CATEGORY_NAMES for Free
// Spin — same in src/api-mapper-qp2.js). Comparing bare `[]` against that
// default produced a false CRITICAL mismatch on a large fraction of live
// Deposit/Free-Credit/Free-Spin promos. Verified live 2026-08-11 against
// WHALE_CRM_PROBE_DEP50PCT_500_12X (Deposit, QPRO1 + QP2A) and two Free Spin
// probes (QPRO2 TEST_RET_CRM_REL_5FS_PTI_8X_060_MHLOG_GLD, QPRO5
// TEST_RET_CRM_REL_5FS_8X_040_SR) before writing this fix.
test('Gap-closure: source unrestricted + live matches the non-FS wallet default → MATCH, not a false mismatch', () => {
  const exp = qp2FcExpected();
  exp.scope.categories = []; // source never asked for a category restriction
  const act = qp2FcLive();
  act.scope.categories = ['CRASH', 'CRICKET', 'E_SPORTS', 'FISHING', 'LIVE_CASINO', 'SLOTS', 'SPORTS'];
  act.scope.gameProviderCodes = ['LIVE22', 'PP'];
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  const catField = r.fields.find((f) => f.field === 'categories');
  assert.equal(catField.status, 'MATCH', 'the wallet-category default must not read as an operator-configured restriction');
  assert.equal(r.verdict, 'SAFE', 'an otherwise-complete fixture must not be dragged to NOT_SAFE by this default');
});

test('Gap-closure: unrestricted + live default in SHORT-CODE form (catalogue fetch failed) → MATCH, not a false NOT_SAFE', () => {
  // When the per-site category catalogue fails to load, the live default set
  // arrives as raw/mixed short codes (CG/CK/ES/FS + already-resolved names).
  // isMapperDefaultCategorySet must still recognize it as the no-restriction
  // default — otherwise a correctly unrestricted promo false-FAILs (the exact
  // regression bitbucket fix 000c54f prevented).
  const exp = qp2FcExpected();
  exp.scope.categories = [];
  const act = qp2FcLive();
  act.scope.categories = ['CG', 'CK', 'ES', 'FS', 'LIVE_CASINO', 'SLOTS', 'SPORTS'];
  act.scope.gameProviderCodes = ['LIVE22', 'PP'];
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  const catField = r.fields.find((f) => f.field === 'categories');
  assert.equal(catField.status, 'MATCH', 'short-code default set must be recognized even when the catalogue did not resolve');
  assert.notEqual(r.verdict, 'NOT_SAFE');
});

test('Gap-closure: source unrestricted + live matches the Free-Spin-only default → MATCH', () => {
  const exp = qp2FcExpected();
  exp.identity.bonusType = BONUS_TYPES.FREE_SPIN;
  exp.scope.categories = [];
  const act = qp2FcLive();
  act.identity.bonusType = BONUS_TYPES.FREE_SPIN;
  act.scope.categories = ['SLOTS'];
  act.scope.gameProviderCodes = ['PP'];
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  const catField = r.fields.find((f) => f.field === 'categories');
  assert.equal(catField.status, 'MATCH', 'Free Spin promos default to Slots-only — this must read as a match, not a restriction the operator configured');
});

test('Gap-closure: source unrestricted + live is a genuine, non-default partial restriction → still MISMATCH (no blanket suppression)', () => {
  const exp = qp2FcExpected();
  exp.scope.categories = [];
  const act = qp2FcLive();
  act.scope.categories = ['SPORTS']; // a real restriction that happens to not match either known default
  act.scope.gameProviderCodes = ['SBO'];
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  const catField = r.fields.find((f) => f.field === 'categories');
  assert.equal(catField.status, 'MISMATCH', 'a genuine restriction the source never asked for must still be flagged');
  assert.equal(catField.severity, 'CRITICAL');
  assert.equal(r.verdict, 'NOT_SAFE');
});

test('Gap-closure: source explicitly restricted + live has a different restricted set → still MISMATCH (fix is scoped to the empty-source case only)', () => {
  const exp = qp2FcExpected();
  exp.scope.categories = ['SLOTS'];
  const act = qp2FcLive();
  act.scope.categories = ['CRASH', 'CRICKET', 'E_SPORTS', 'FISHING', 'LIVE_CASINO', 'SLOTS', 'SPORTS']; // the wallet default, but source DID ask for Slots-only
  act.scope.gameProviderCodes = ['PP'];
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  const catField = r.fields.find((f) => f.field === 'categories');
  assert.equal(catField.status, 'MISMATCH', 'an explicit source restriction must never be silently widened to the platform default');
  assert.equal(r.verdict, 'NOT_SAFE');
});

test('Increment 5: decimal comparison ignores insignificant precision (0.02 vs 0.020000001)', () => {
  const exp = qp2FcExpected();
  exp.currencies[0].freeCreditAmount = 30.00;
  const act = qp2FcLive();
  act.currencies[0].freeCreditAmount = 30.000001; // sub-cent difference
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  const field = r.fields.find((f) => f.field === 'currency:MYR:freeCreditAmount');
  assert.equal(field.status, 'MATCH', 'decimal near-equality must be treated as MATCH');
});

test('Increment 5: date comparison via canonical adapter normalization (DD/MM vs ISO)', () => {
  const exp = expectedFromSource({
    promo_code: 'DATED', brands: ['QP2A'], currencies: ['MYR'], regions: ['MY'],
    bonus_type: 'Free Credit', validity_days: 7,
    start_date: '30/07/2026', end_date: '31/07/2026',
    parsed: { free_credit_amount: 30, min_deposit: 0, to_multiplier: 5 },
  }, { brand: 'QP2A' });
  const act = liveFromQp2({
    list_row: { code: 'DATED', bonus_type: 'Free Credit', valid_from: '2026-07-30T00:00:00Z', valid_to: '2026-07-31T00:00:00Z', validity: 7, status: 1, merchant_ids: [1], message_template_id: 1, dialog_popup_list: [{ popup_id: 1 }] },
    detail: { promotion_currency_list: [{ currency: 'MYR', currency_id: 1, free_credit_amount: 30, status: 1 }], to_multiplier: 5 },
  }, { brand: 'QP2A' });
  assert.equal(exp.schedule.startDate, act.schedule.startDate, 'date normalization must equalize DD/MM/YYYY vs ISO');
});

test('Increment 5: QP2 multi-merchant dialog count mismatch → CRITICAL FAIL', () => {
  const exp = qp2FcExpected();
  const act = qp2FcLive();
  act.linkage.promotionListIds = [1, 2, 3, 4]; // four merchants
  act.linkage.dialogPopupList = [100];         // one popup — mismatch
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  const dialog = r.fields.find((f) => f.field === 'dialogLinkage' && f.rule === 'linkage.qp2-dialog-count');
  assert.ok(dialog);
  assert.equal(dialog.severity, 'CRITICAL');
  assert.equal(r.verdict, 'NOT_SAFE');
});

test('Increment 5: IGMP linkage rules skipped (no MT/dialog concept)', () => {
  const exp = expectedFromSource({
    promo_code: 'IGMP_DEP', brands: ['WS1_MY'], currencies: ['MYR'], regions: ['MY'],
    bonus_type: 'Deposit', parsed: { min_deposit: 30, bonus_rate_pct: 88, to_multiplier: 8, max_bonus: 88 },
  }, { brand: 'WS1_MY' });
  const act = liveFromIgmp({
    list_row: { PromotionId: 1, PromotionCode: 'IGMP_DEP', PromotionType: 'Bonus', IsActive: true },
    detail: { PromotionRewards: [{ MinimumActionAmount: 30, BonusPercentage: 88, RolloverMultiplier: 8, CapBonusAmount: 88 }] },
  }, { brand: 'WS1_MY', siteId: 'ws1-v3-my' });
  const r = compare({ expected: exp, actual: act, brand: 'WS1_MY' });
  const mt = r.fields.find((f) => f.field === 'mtLinkage');
  const dialog = r.fields.find((f) => f.field === 'dialogLinkage');
  assert.equal(mt.status, 'SKIPPED');
  assert.equal(dialog.status, 'SKIPPED');
  // Overall should be SAFE — no critical mismatch on IGMP
  assert.notEqual(r.verdict, 'NOT_SAFE');
});

// SUPERSEDED 2026-07-31. This test previously asserted that IGMP FS
// spinCount/valuePerSpin were a permanent "platform limitation" and therefore
// SKIPPED. That premise was wrong: a read-only probe found FreeSpinRounds and
// AmountPerBet nested under PromotionRewards[0].FreeSpin. The adapter now reads
// them, the downgrade list is empty, and these fields must compare for real.
// Rewritten to assert affirmative evidence in both directions.

test('G5/G6: IGMP FS spinCount + valuePerSpin compare as real evidence (MATCH)', () => {
  const exp = expectedFromSource({
    promo_code: 'IGMP_FS', brands: ['WS1_MY'], currencies: ['MYR'], regions: ['MY'],
    bonus_type: 'Free Spin', parsed: { spin_count: 88, value_per_spin: 0.5, to_multiplier: 10, min_deposit: 0 },
  }, { brand: 'WS1_MY', platform: 'igmp', siteId: 'ws1-v3-my' });
  const act = withCompleteLocaleContent(liveFromIgmp({
    list_row: { PromotionCode: 'IGMP_FS', PromotionType: 'FreeSpin', IsActive: true },
    detail: {
      PromotionRewards: [{
        RolloverMultiplier: 10, RedemptionType: 1, MinimumActionAmount: 0,
        FreeSpin: { FreeSpinId: 7, FreeSpinRounds: 88, AmountPerBet: 0.5 },
      }],
    },
  }, { brand: 'WS1_MY', siteId: 'ws1-v3-my' }), { languages: ['EN', 'ZH'], locales: ['MY_EN', 'MY_ZH'] });
  const r = compare({ expected: exp, actual: act, brand: 'WS1_MY' });
  const spin = r.fields.find((f) => f.field === 'currency:MYR:spinCount');
  const vps = r.fields.find((f) => f.field === 'currency:MYR:valuePerSpin');
  assert.equal(spin.status, 'MATCH', 'spinCount is now collectable — must genuinely compare');
  assert.equal(vps.status, 'MATCH', 'valuePerSpin is now collectable — must genuinely compare');
  assert.equal(r.verdict, 'SAFE', 'a fully-matching IGMP FS promo must reach PASS automatically');
});

test('G5/G6: IGMP FS spin-count drift is caught as a real MISMATCH (no longer hidden by SKIP)', () => {
  const exp = expectedFromSource({
    promo_code: 'IGMP_FS', brands: ['WS1_MY'], currencies: ['MYR'], regions: ['MY'],
    bonus_type: 'Free Spin', parsed: { spin_count: 88, value_per_spin: 0.5, to_multiplier: 10, min_deposit: 0 },
  }, { brand: 'WS1_MY', platform: 'igmp', siteId: 'ws1-v3-my' });
  const act = liveFromIgmp({
    list_row: { PromotionCode: 'IGMP_FS', PromotionType: 'FreeSpin', IsActive: true },
    detail: {
      PromotionRewards: [{
        RolloverMultiplier: 10, RedemptionType: 1, MinimumActionAmount: 0,
        FreeSpin: { FreeSpinId: 7, FreeSpinRounds: 68, AmountPerBet: 0.5 },  // 68 ≠ 88
      }],
    },
  }, { brand: 'WS1_MY', siteId: 'ws1-v3-my' });
  const r = compare({ expected: exp, actual: act, brand: 'WS1_MY' });
  const spin = r.fields.find((f) => f.field === 'currency:MYR:spinCount');
  assert.equal(spin.status, 'MISMATCH');
  assert.equal(spin.severity, 'CRITICAL');
  assert.equal(r.verdict, 'NOT_SAFE', 'the old SKIP behavior would have hidden this as a PASS');
});

test('G5/G6: the platform-unretrievable downgrade list is empty', () => {
  // Guard against silently re-adding a field here to make a red test green.
  // Adding an entry requires proving no read path exposes the field.
  const src = readFileSync(path.resolve(process.cwd(), 'src/qc-dashboard/compare-engine.js'), 'utf8');
  const m = src.match(/PLATFORM_UNRETRIEVABLE_CURRENCY_FIELDS\s*=\s*Object\.freeze\((\{[\s\S]*?\})\)/);
  assert.ok(m, 'downgrade map must still exist as a mechanism');
  assert.match(m[1].replace(/\s/g, ''), /^\{\}$/, 'downgrade map must be EMPTY — no field may be written off as uncollectable without proof');
});

test('Increment 5: compare throws when expected or actual is missing', () => {
  assert.throws(() => compare({ expected: null, actual: {} }), /required/);
  assert.throws(() => compare({ expected: {}, actual: null }), /required/);
});

// ── Item 6: locale completeness wired into the verdict ──────────────────

test('Item 6: locale-complete promotion name + MT body → MATCH, verdict unaffected', () => {
  const r = compare({ expected: qp2FcExpected(), actual: qp2FcLive(), brand: 'QP2A' });
  const name = r.fields.find((f) => f.field === 'localeCompleteness:promotionName');
  const mt = r.fields.find((f) => f.field === 'localeCompleteness:mtBodyLanguages');
  assert.equal(name.status, 'MATCH');
  assert.equal(name.severity, 'CRITICAL');
  assert.equal(mt.status, 'MATCH');
  assert.equal(r.verdict, 'SAFE');
});

// A promo that genuinely serves all four QP2 regions carries all four
// currencies. The locale gate is now scoped to the promo's real currency
// footprint (2026-08-11 fix), so a test proving "missing SG/ID/TH flags" must
// give the promo those currencies — otherwise it isn't a 4-region promo and
// SG/ID/TH are correctly not required.
function withFourRegionCurrencies(canonical) {
  const have = new Set(canonical.currencies.map((c) => c.code));
  for (const code of ['MYR', 'SGD', 'IDR', 'THB']) if (!have.has(code)) canonical.currencies.push({ code });
  return canonical;
}

test('Item 6: a 4-region promo (MYR+SGD+IDR+THB) missing SG/ID/TH names → UNAVAILABLE/CRITICAL → MANUAL_REQUIRED', () => {
  const act = withFourRegionCurrencies(qp2FcLive());
  act.content.promotionNamesByLocale = { MY_EN: 'x', MY_ZH: 'y' }; // SG/ID/TH all missing
  const r = compare({ expected: qp2FcExpected(), actual: act, brand: 'QP2A' });
  const name = r.fields.find((f) => f.field === 'localeCompleteness:promotionName');
  assert.equal(name.status, 'UNAVAILABLE');
  assert.equal(name.severity, 'CRITICAL');
  assert.match(name.message, /SG_EN/);
  assert.equal(r.verdict, 'MANUAL_REQUIRED');
});

test('Item 6: a 4-region promo missing a required MT-body language → UNAVAILABLE/CRITICAL → MANUAL_REQUIRED', () => {
  const act = withFourRegionCurrencies(qp2FcLive());
  delete act.content.mtBody.TH;
  const r = compare({ expected: qp2FcExpected(), actual: act, brand: 'QP2A' });
  const mt = r.fields.find((f) => f.field === 'localeCompleteness:mtBodyLanguages');
  assert.equal(mt.status, 'UNAVAILABLE');
  assert.match(mt.message, /TH/);
  assert.equal(r.verdict, 'MANUAL_REQUIRED');
});

// ── Gap-closure: locale requirement follows the promo's currency footprint ──
//
// Root cause (2026-08-11, user-reported): a QP2 promo intentionally scoped to
// MY/SG (currencies MYR+SGD, localized MY_EN/MY_ZH/SG_EN/SG_ZH) was flagged
// MANUAL_REQUIRED for "missing ID/TH", because the locale gate keyed off the
// brand's maximal region set instead of the promo's real footprint. Verified
// live on QP2A WHALE_CRM_PROBE_DEP50PCT_500_12X and QPRO2 TEST_RET_CRM_REL_5FS.
test('Gap-closure: a QP2 promo carrying only MYR+SGD requires only MY/SG locales → SAFE, not flagged for ID/TH', () => {
  const act = qp2FcLive();
  act.currencies = [{ code: 'MYR' }, { code: 'SGD' }];       // intentionally MY/SG only
  act.content.promotionNamesByLocale = { MY_EN: 'x', MY_ZH: 'y', SG_EN: 'x', SG_ZH: 'y' };
  act.content.mtBody = { EN: 'a', ZH: 'b' };
  const exp = qp2FcExpected();
  exp.currencies = [{ code: 'MYR' }, { code: 'SGD' }];        // source agrees: MY/SG promo
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  const name = r.fields.find((f) => f.field === 'localeCompleteness:promotionName');
  const mt = r.fields.find((f) => f.field === 'localeCompleteness:mtBodyLanguages');
  assert.equal(name.status, 'MATCH', 'MY/SG-only promo must not be dinged for ID/TH it never serves');
  assert.deepEqual(name.expected, ['MY_EN', 'MY_ZH', 'SG_EN', 'SG_ZH'], 'required set is exactly the promo\'s two regions');
  assert.equal(mt.status, 'MATCH');
  assert.equal(r.verdict, 'SAFE');
});

test('Gap-closure: narrowing never hides a real gap — a MY/SG promo missing SG_ZH still flags', () => {
  const act = qp2FcLive();
  act.currencies = [{ code: 'MYR' }, { code: 'SGD' }];
  act.content.promotionNamesByLocale = { MY_EN: 'x', MY_ZH: 'y', SG_EN: 'x' }; // SG_ZH missing
  const exp = qp2FcExpected();
  exp.currencies = [{ code: 'MYR' }, { code: 'SGD' }];
  const r = compare({ expected: exp, actual: act, brand: 'QP2A' });
  const name = r.fields.find((f) => f.field === 'localeCompleteness:promotionName');
  assert.equal(name.status, 'UNAVAILABLE');
  assert.match(name.message, /SG_ZH/);
  assert.equal(r.verdict, 'MANUAL_REQUIRED');
});

test('Item 6: dialog-locale completeness is WARNING-only and only checked when a dialog is actually linked', () => {
  const linked = qp2FcLive(); // qp2FcLive links dialog_popup_list: [{popup_id:100}] but never populates dialogBody
  const rLinked = compare({ expected: qp2FcExpected(), actual: linked, brand: 'QP2A' });
  const dlgLinked = rLinked.fields.find((f) => f.field === 'localeCompleteness:dialogBodyLanguages');
  assert.equal(dlgLinked.status, 'UNAVAILABLE');
  assert.equal(dlgLinked.severity, 'WARNING', 'dialog-locale gaps must never force MANUAL_REQUIRED — no verified per-bonus-type requirement exists yet');

  const unlinked = qp2FcLive();
  unlinked.linkage.dialogPopupList = [];
  const rUnlinked = compare({ expected: qp2FcExpected(), actual: unlinked, brand: 'QP2A' });
  const dlgUnlinked = rUnlinked.fields.find((f) => f.field === 'localeCompleteness:dialogBodyLanguages');
  assert.equal(dlgUnlinked.status, 'SKIPPED', 'no dialog linked at all — locale completeness is not applicable, not a gap');
});

test('Item 6: a brand with no mapped region requirement is SKIPPED, never fabricates a requirement', () => {
  const act = qp2FcLive();
  const r = compare({ expected: qp2FcExpected(), actual: act, brand: 'BRAND_NOT_IN_REGION_MAP' });
  const name = r.fields.find((f) => f.field === 'localeCompleteness:promotionName');
  assert.equal(name.status, 'SKIPPED');
  assert.equal(name.severity, 'INFO');
});

test('Item 6: MY-only brand (QPRO5) only requires MY_EN/MY_ZH — SG/ID/TH absence is not a gap', () => {
  const act = withCompleteLocaleContent(qp2FcLive(), { languages: ['EN', 'ZH'], locales: ['MY_EN', 'MY_ZH'] });
  act.content.promotionNamesByLocale = { MY_EN: 'x', MY_ZH: 'y' };
  act.content.mtBody = { EN: 'a', ZH: 'b' };
  const r = compare({ expected: qp2FcExpected(), actual: act, brand: 'QPRO5' });
  const name = r.fields.find((f) => f.field === 'localeCompleteness:promotionName');
  const mt = r.fields.find((f) => f.field === 'localeCompleteness:mtBodyLanguages');
  assert.equal(name.status, 'MATCH');
  assert.equal(mt.status, 'MATCH');
});
