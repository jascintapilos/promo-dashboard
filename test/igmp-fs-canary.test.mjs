// Regression tests for iGMP Free Spin canary improvements.
// No live BO calls — game pool injected synthetically; plan shape tested via
// _internals exports (pure functions, no network).
//
// Covers:
//   1. Game resolver — Pass 2 exact Name wins over Pass 4 prefix-strip
//                    — Pass 4 exact-before-substring fix (fallback when no exact entry exists)
//   2. Plan T&C structure — Dep/FC path vs FS followup path
//   3. Pre-QC extraction — extractRewardContents (real production function, not a mirror)
//   4. Missing FS T&C followup → empty result (clear FAIL reason)
//
// Run: node test/igmp-fs-canary.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { _matchGameFromPool } from '../src/igmp-fs-resolver.js';
import { _internals, extractRewardContents } from '../src/api-mapper-igmp.js';

const { buildAddBonus, buildAddFreeCredit, buildAddFreeSpin } = _internals;

// ── Synthetic game pools ──────────────────────────────────────────────────────

// Reviewer-specified regression pool: all three Gates of Olympus variants in
// this exact order (GOO-1000 first to also expose the old Pass-3 substring bug
// if Pass 2 were skipped).
const POOL_WITH_MB8 = [
  { Id: 1, VendorDisplayCode: 'vs20olympx',    Name: 'Gates of Olympus 1000' },
  { Id: 2, VendorDisplayCode: 'vs20olympgate', Name: 'Gates of Olympus' },
  { Id: 3, VendorDisplayCode: 'vs20mb88gates', Name: 'MB8 Gates of Olympus' },
];

// Same pool in reverse order — proves neither result depends on catalog ordering.
const POOL_WITH_MB8_REVERSED = [...POOL_WITH_MB8].reverse();

// Pass-4 fallback pool: no "MB8 Gates of Olympus" entry.
// "Gates of Olympus 1000" (id=1) appears BEFORE "Gates of Olympus" (id=2)
// to expose the old substring-only bug: includes("gates of olympus") would
// match id=1 first. The exact-before-substring fix must return id=2 instead.
const POOL_NO_MB8 = [
  { Id: 1, VendorDisplayCode: 'vs20olympx',    Name: 'Gates of Olympus 1000' },
  { Id: 2, VendorDisplayCode: 'vs20olympgate', Name: 'Gates of Olympus' },
  { Id: 4, VendorDisplayCode: 'vs20sugarrush',   Name: 'Sugar Rush' },
  { Id: 5, VendorDisplayCode: 'vs20sugarrush1k', Name: 'Sugar Rush 1000' },
];

// ── Game resolver tests ───────────────────────────────────────────────────────

// --- Pass 1 ---

test('resolver — Pass 1: exact VendorDisplayCode wins', () => {
  const hit = _matchGameFromPool(POOL_NO_MB8, 'vs20olympgate');
  assert.equal(hit?.VendorDisplayCode, 'vs20olympgate', 'exact vendor code should match Gates of Olympus');
  assert.equal(hit?.Id, 2);
});

// --- Pass 2 / MB8 regression (reviewer-specified pool) ---

test('resolver — MB8 regression: "MB8 Gates of Olympus" → vs20mb88gates via Pass 2 exact Name', () => {
  // The catalog contains an entry literally named "MB8 Gates of Olympus".
  // Pass 2 (exact Name) must find it BEFORE Pass 4 (prefix-strip) runs.
  const hit = _matchGameFromPool(POOL_WITH_MB8, 'MB8 Gates of Olympus');
  assert.equal(hit?.VendorDisplayCode, 'vs20mb88gates', '"MB8 Gates of Olympus" must resolve to vs20mb88gates');
  assert.equal(hit?.Id, 3, 'id=3 (not id=2 Gates of Olympus, not id=1 Gates of Olympus 1000)');
});

test('resolver — "Gates of Olympus" → vs20olympgate via Pass 2 exact Name', () => {
  // "Gates of Olympus 1000" (id=1) appears first but exact name match skips it.
  const hit = _matchGameFromPool(POOL_WITH_MB8, 'Gates of Olympus');
  assert.equal(hit?.VendorDisplayCode, 'vs20olympgate', '"Gates of Olympus" must resolve to vs20olympgate not vs20olympx');
  assert.equal(hit?.Id, 2);
});

test('resolver — MB8 regression result does NOT depend on pool order (reversed pool)', () => {
  // POOL_WITH_MB8_REVERSED has MB8 entry last — Pass 2 must still find it.
  const hit = _matchGameFromPool(POOL_WITH_MB8_REVERSED, 'MB8 Gates of Olympus');
  assert.equal(hit?.VendorDisplayCode, 'vs20mb88gates');
  assert.equal(hit?.Id, 3);
});

test('resolver — "Gates of Olympus" result does NOT depend on pool order (reversed pool)', () => {
  const hit = _matchGameFromPool(POOL_WITH_MB8_REVERSED, 'Gates of Olympus');
  assert.equal(hit?.VendorDisplayCode, 'vs20olympgate');
  assert.equal(hit?.Id, 2);
});

// --- Pass 4 (prefix-strip fallback — only fires when no exact full-name match exists) ---

test('resolver — Pass 4 exact-before-substring: "MB8 Gates of Olympus" → vs20olympgate (no MB8 entry in catalog)', () => {
  // POOL_NO_MB8 has no "MB8 Gates of Olympus" entry — Pass 1-3 all fail.
  // Pass 4 strips "MB8 " → stripped = "gates of olympus".
  //   Old bug (includes-only): "gates of olympus 1000".includes("gates of olympus") → id=1 ✗
  //   Fix (exact-first):       "gates of olympus 1000" !== "gates of olympus"; next → id=2 ✓
  const hit = _matchGameFromPool(POOL_NO_MB8, 'MB8 Gates of Olympus');
  assert.equal(hit?.VendorDisplayCode, 'vs20olympgate', 'Pass 4 exact match must prefer "Gates of Olympus" over "Gates of Olympus 1000"');
  assert.equal(hit?.Id, 2);
});

test('resolver — Pass 4 exact: "MB8 Gates of Olympus 1000" → vs20olympx', () => {
  // Stripped = "gates of olympus 1000" → exact match on id=1.
  const hit = _matchGameFromPool(POOL_NO_MB8, 'MB8 Gates of Olympus 1000');
  assert.equal(hit?.VendorDisplayCode, 'vs20olympx');
  assert.equal(hit?.Id, 1);
});

test('resolver — Pass 4 substring fallback when no exact match', () => {
  // "MB8 Sugar" strips to "sugar" → no exact match; first includes-match wins.
  const hit = _matchGameFromPool(POOL_NO_MB8, 'MB8 Sugar');
  assert.ok(hit != null, 'should find a sugar game via substring');
  assert.ok([4, 5].includes(hit.Id), 'should be Sugar Rush or Sugar Rush 1000');
});

test('resolver — no match returns null', () => {
  const hit = _matchGameFromPool(POOL_NO_MB8, 'Totally Unknown Game');
  assert.equal(hit, null, 'should return null for unrecognised game hint');
});

// ── Plan structure tests ──────────────────────────────────────────────────────
// Verify that the plan shape produced by the mapper has T&C in the right place
// for each bonus type — pre-condition for extractRewardContents correctness.

const BASE_REC = {
  __site_override: 'ws1-v3-my',
  promo_code: 'TEST_CODE',
  promotion_name_en: 'Test Promotion',
  promotion_name_zh: null,
  promotion_name_id: null,
  regions: ['MY'],
  locales: ['MY_EN'],
  currencies: ['MYR'],
};

test('Deposit plan: T&C is at body.PromotionRewards[0].PromotionRewardContents', () => {
  const rec = {
    ...BASE_REC,
    bonus_type: 'Deposit',
    min_deposit: 50,
    cap_bonus_amount: 200,
    turnover_multiplier: 8,
    rewards_validity_days: 7,
    bonus_pct: 100,
  };
  const plan = buildAddBonus(rec);
  assert.equal(plan.endpoint, '/PM/AddBonus');
  assert.ok(Array.isArray(plan.followups) && plan.followups.length === 0, 'Dep has no followups');
  const contents = plan.body?.PromotionRewards?.[0]?.PromotionRewardContents;
  assert.ok(Array.isArray(contents) && contents.length > 0, 'T&C should be in body.PromotionRewards[0]');
  assert.ok(contents.find((c) => c.Locale === 'en'), 'EN locale must be present');
});

test('Free Credit plan: T&C is at body.PromotionRewards[0].PromotionRewardContents', () => {
  const rec = {
    ...BASE_REC,
    bonus_type: 'Free Credit',
    free_credit_amount: 18,
    turnover_multiplier: 8,
    rewards_validity_days: 7,
  };
  const plan = buildAddFreeCredit(rec);
  assert.equal(plan.endpoint, '/PM/AddFreeCredit');
  assert.ok(Array.isArray(plan.followups) && plan.followups.length === 0, 'FC has no followups');
  const contents = plan.body?.PromotionRewards?.[0]?.PromotionRewardContents;
  assert.ok(Array.isArray(contents) && contents.length > 0, 'T&C should be in body.PromotionRewards[0]');
  assert.ok(contents.find((c) => c.Locale === 'en'), 'EN locale must be present');
});

test('Free Spin plan: shell body has NO PromotionRewards', () => {
  const rec = {
    ...BASE_REC,
    bonus_type: 'Free Spin',
    fs_provider_id: 'pp-123',
    fs_game_id: 'game-456',
    fs_rounds: 20,
    fs_amount_per_bet: '0.50',
    fs_game: 'Gates of Olympus',
    turnover_multiplier: 8,
    min_deposit: 50,
    rewards_validity_days: 7,
  };
  const plan = buildAddFreeSpin(rec, { siteId: 'ws1-v3-my' });
  assert.equal(plan.endpoint, '/PM/AddFreeSpin');
  assert.equal(plan.body?.PromotionRewards, undefined, 'FS shell body must have no PromotionRewards');
});

test('Free Spin plan: T&C is at followups[0].body.PromotionReward.PromotionRewardContents', () => {
  const rec = {
    ...BASE_REC,
    bonus_type: 'Free Spin',
    fs_provider_id: 'pp-123',
    fs_game_id: 'game-456',
    fs_rounds: 20,
    fs_amount_per_bet: '0.50',
    fs_game: 'Gates of Olympus',
    turnover_multiplier: 8,
    min_deposit: 50,
    rewards_validity_days: 7,
  };
  const plan = buildAddFreeSpin(rec, { siteId: 'ws1-v3-my' });
  assert.ok(Array.isArray(plan.followups) && plan.followups.length >= 1, 'FS must have followups');
  assert.equal(plan.followups[0].endpoint, '/PM/AddFreeSpinReward');
  const contents = plan.followups?.[0]?.body?.PromotionReward?.PromotionRewardContents;
  assert.ok(Array.isArray(contents) && contents.length > 0, 'FS T&C must be in followups[0].body.PromotionReward');
  assert.ok(contents.find((c) => c.Locale === 'en'), 'EN locale must be present in FS followup T&C');
});

test('Free Spin plan: captureFrom RewardId is set on AddFreeSpinReward followup', () => {
  // Evidence: bin/recreate-p065-ws2.mjs lines 83-84 (r?.data?.RewardId) and
  // memory/project_igmp_api_shapes.md line 127 records live capture RewardId=14583.
  // findFirstKey('RewardId') resolves data.RewardId from the step response.
  const rec = {
    ...BASE_REC,
    bonus_type: 'Free Spin',
    fs_provider_id: 'pp-123',
    fs_game_id: 'game-456',
    fs_rounds: 20,
    fs_amount_per_bet: '0.50',
    turnover_multiplier: 8,
    min_deposit: 50,
    rewards_validity_days: 7,
  };
  const plan = buildAddFreeSpin(rec, { siteId: 'ws1-v3-my' });
  const rewardFollowup = plan.followups.find((f) => f.endpoint === '/PM/AddFreeSpinReward');
  assert.ok(rewardFollowup, 'AddFreeSpinReward followup must exist');
  assert.equal(rewardFollowup.captureFrom, 'RewardId', 'captureFrom must be RewardId for QC L3 to use it');
});

// ── extractRewardContents tests (real production function) ────────────────────
// Imports the actual function from src/api-mapper-igmp.js — NOT an inline copy.
// These tests fail if the real canary code is broken, unlike a mirror would.

test('extractRewardContents: Deposit reads from body path', () => {
  const plan = {
    body: { PromotionRewards: [{ PromotionRewardContents: [{ Locale: 'en', Content: '<p>dep</p>' }] }] },
    followups: [],
  };
  const rows = extractRewardContents(plan, 'deposit');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Locale, 'en');
});

test('extractRewardContents: Free Credit reads from body path', () => {
  const plan = {
    body: { PromotionRewards: [{ PromotionRewardContents: [{ Locale: 'en', Content: '<p>fc</p>' }] }] },
    followups: [],
  };
  const rows = extractRewardContents(plan, 'free credit');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Locale, 'en');
});

test('extractRewardContents: Free Spin reads from followup path, not body', () => {
  const plan = {
    // Shell body has no PromotionRewards — guard against T&C extraction bug
    body: { PromotionCode: 'TEST_FS', Settings: [] },
    followups: [
      {
        endpoint: '/PM/AddFreeSpinReward',
        body: {
          PromotionReward: {
            PromotionRewardContents: [
              { Locale: 'en', Content: '<p>fs tnc</p>' },
              { Locale: 'zh', Content: '<p>中文</p>' },
            ],
          },
        },
      },
    ],
  };
  const rows = extractRewardContents(plan, 'free spin');
  assert.equal(rows.length, 2, 'should return both EN and ZH from followup');
  assert.ok(rows.find((r) => r.Locale === 'en'), 'EN must be present');
});

test('extractRewardContents: Free Spin with no followup body → empty [] not crash', () => {
  const plan = { body: { PromotionCode: 'TEST_FS' }, followups: [] };
  const rows = extractRewardContents(plan, 'free spin');
  assert.ok(Array.isArray(rows) && rows.length === 0, 'missing followup should return [] not throw');
});

test('extractRewardContents: Deposit with missing PromotionRewards → empty []', () => {
  const plan = { body: {}, followups: [] };
  const rows = extractRewardContents(plan, 'deposit');
  assert.ok(Array.isArray(rows) && rows.length === 0, 'missing rewards should return []');
});
