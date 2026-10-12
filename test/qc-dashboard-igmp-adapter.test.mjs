// Gap-closure item 1/2 tests — IGMP PromotionRewardContents locale wiring.
//
// Fixtures are captured, sanitized shapes from a live read-only probe
// against WS1_MY/SG/TH/ID/KH on 2026-08-10 (RewardId/Locale/Content length
// only where the real HTML isn't needed for the assertion — nothing site-
// identifying beyond the locale vocabulary itself). This is the evidence
// that Locale is a lowercase language code (en/zh/th/id/km), confirmed on
// a REAL promotion per region — not inferred from the en/zh pattern.

import test from 'node:test';
import assert from 'node:assert/strict';
import { liveFromIgmp } from '../src/qc-dashboard/canonical/igmp-adapter.js';
import { snapshotToLiveState } from '../src/qc-dashboard/compare-flow.js';
import { compare } from '../src/qc-dashboard/compare-engine.js';
import { expectedFromSource } from '../src/qc-dashboard/canonical/index.js';

// "88 Free Spins Welcome Bonus - Gates of OlympusV1" — real live capture,
// WS1_TH. Content bodies truncated to a representative snippet; only length
// matters for these assertions, not exact text.
const TH_REWARD_CONTENTS = [
  { RewardId: 20001, Locale: 'en', PromotionRewardName: 'Marketing - 88 FS Welcome Bonus - MB8 Gates of Olympus ', Content: '<h4>EN body incl. Terms and Conditions section...</h4>' },
  { RewardId: 20001, Locale: 'th', PromotionRewardName: 'Marketing - 88 FS Welcome Bonus - MB8 Gates of Olympus (TH)', Content: '<h4>TH body incl. Terms and Conditions section (Thai)...</h4>' },
];

// "FT_VM_FC_VARIABLE_8X" — real live capture, WS1_KH.
const KH_REWARD_CONTENTS = [
  { RewardId: 20002, Locale: 'en', PromotionRewardName: 'VIP BONUS - Free Credit - 8x TO', Content: '<p>EN free credit body</p>' },
  { RewardId: 20002, Locale: 'km', PromotionRewardName: 'VIP BONUS - Free Credit - 8x TO (KM)', Content: '<p>KM free credit body</p>' },
];

// Same promo name, WS1_ID capture.
const ID_REWARD_CONTENTS = [
  { RewardId: 20003, Locale: 'en', PromotionRewardName: '88 FS Welcome Bonus - MB8 Gates of Olympus - ID', Content: '<h4>EN body</h4>' },
  { RewardId: 20003, Locale: 'id', PromotionRewardName: '88 FS Welcome Bonus - MB8 Gates of Olympus - ID (ID)', Content: '<h4>ID body</h4>' },
];

// "TEST_IGMP_DEP_V13" — real live capture, WS1_MY.
const MY_REWARD_CONTENTS = [
  { RewardId: 20004, Locale: 'en', PromotionRewardName: 'TEST iGMP Deposit - 50% Bonus', Content: '<h4>EN body</h4>' },
  { RewardId: 20004, Locale: 'zh', PromotionRewardName: 'TEST iGMP Deposit - 50% Bonus', Content: '<h4>ZH body</h4>' },
];

function liveStateWith(rewardContents, { code = 'X', type = 'Bonus', extra = {} } = {}) {
  return {
    list_row: { PromotionCode: code, PromotionType: type, IsActive: true, ...extra },
    detail: { PromotionRewards: [{ RewardId: rewardContents[0]?.RewardId, RolloverMultiplier: 5 }] },
    rewardContents,
  };
}

// ── per-region locale identifier proof (item 2) ──────────────────────────

test('Item 2: TH locale identifier is "th" (lowercase) — live-derived, not guessed', () => {
  const c = liveFromIgmp(liveStateWith(TH_REWARD_CONTENTS, { code: 'FS_TH_TEST' }), { brand: 'WS1_TH' });
  assert.equal(c.content.names.TH, 'Marketing - 88 FS Welcome Bonus - MB8 Gates of Olympus (TH)');
  assert.equal(c.content.promotionNamesByLocale.TH_TH, 'Marketing - 88 FS Welcome Bonus - MB8 Gates of Olympus (TH)');
  assert.match(c.content.mtBody.TH, /Thai/);
  assert.deepEqual(c.content.localesDeclared, ['TH_EN', 'TH_TH']);
});

test('Item 1/2: ID locale identifier is "id", KM locale identifier is "km" — both live-derived', () => {
  const idC = liveFromIgmp(liveStateWith(ID_REWARD_CONTENTS, { code: 'FS_ID_TEST' }), { brand: 'WS1_ID' });
  assert.deepEqual(idC.content.localesDeclared, ['ID_EN', 'ID_ID']);
  assert.equal(idC.content.names.ID, '88 FS Welcome Bonus - MB8 Gates of Olympus - ID (ID)');

  const khC = liveFromIgmp(liveStateWith(KH_REWARD_CONTENTS, { code: 'FC_KH_TEST', type: 'FreeCredit' }), { brand: 'WS1_KH' });
  assert.deepEqual(khC.content.localesDeclared, ['KH_EN', 'KH_KM']);
  assert.equal(khC.content.names.KM, 'VIP BONUS - Free Credit - 8x TO (KM)');
});

test('Item 1: EN+ZH (MY region) populates names, promotionNamesByLocale and mtBody together', () => {
  const c = liveFromIgmp(liveStateWith(MY_REWARD_CONTENTS, { code: 'DEP_MY_TEST' }), { brand: 'WS1_MY' });
  assert.deepEqual(c.content.names, { EN: 'TEST iGMP Deposit - 50% Bonus', ZH: 'TEST iGMP Deposit - 50% Bonus' });
  assert.deepEqual(c.content.promotionNamesByLocale, { MY_EN: 'TEST iGMP Deposit - 50% Bonus', MY_ZH: 'TEST iGMP Deposit - 50% Bonus' });
  assert.match(c.content.mtBody.EN, /<h4>/);
  assert.match(c.content.mtBody.ZH, /<h4>/);
  assert.deepEqual(c.content.localesDeclared, ['MY_EN', 'MY_ZH']);
});

// ── correctness: no separate "subject" field invented, T&C not split out ──

test('Item 1: PromotionRewardName maps to the promotion name ONLY — never fabricates a separate MT subject', () => {
  const c = liveFromIgmp(liveStateWith(MY_REWARD_CONTENTS, { code: 'DEP_MY_TEST' }), { brand: 'WS1_MY' });
  assert.equal(c.content.messageTemplate.subjectByLocale.MY_EN, undefined, 'IGMP has no subject field on this endpoint — must stay unpopulated, not guessed from the name');
});

test('Item 1: Content (description+how-to-apply+T&C combined) is never split — T&C stays part of mtBody, tncClauses stays empty', () => {
  const c = liveFromIgmp(liveStateWith(TH_REWARD_CONTENTS, { code: 'FS_TH_TEST' }), { brand: 'WS1_TH' });
  assert.deepEqual(c.content.tncClauses, [], 'a heuristic HTML split was deliberately not attempted — risks fabricating a mismatch');
  assert.match(c.content.mtBody.EN, /Terms and Conditions/);
});

// ── fallback + graceful-degradation behavior ─────────────────────────────

test('Item 1: row.PromotionName is a fallback only — never overwrites the authoritative reward-content name', () => {
  const state = liveStateWith(MY_REWARD_CONTENTS, { code: 'DEP_MY_TEST', extra: { PromotionName: 'Some Other Listing-Row Name' } });
  const c = liveFromIgmp(state, { brand: 'WS1_MY' });
  assert.equal(c.content.names.EN, 'TEST iGMP Deposit - 50% Bonus', 'reward-content is authoritative and must win over the listing-row fallback when both exist');
});

test('Item 1: row.PromotionName fills in when reward content is genuinely unavailable (e.g. LuckyWheel — confirmed live on WS1_ID/TH/KH, no RewardId resolvable)', () => {
  const state = { list_row: { PromotionCode: 'LUCKYWHEEL_X', PromotionType: 'LuckyWheel', IsActive: true, PromotionName: 'Lucky Wheel August' }, detail: {}, rewardContents: [] };
  const c = liveFromIgmp(state, { brand: 'WS1_ID' });
  assert.equal(c.identity.bonusType, 'OTHER', 'an unmodeled bonus type must resolve to OTHER, never guessed as Deposit/FC/FS');
  assert.equal(c.content.names.EN, 'Lucky Wheel August');
  assert.deepEqual(c.content.localesDeclared, [], 'no reward-content locales were actually returned — must not fabricate a declared locale');
});

test('Item 1: missing/null rewardContents never throws — empty buckets, not a crash', () => {
  assert.doesNotThrow(() => liveFromIgmp({ list_row: { PromotionCode: 'X' }, detail: {}, rewardContents: null }, { brand: 'WS1_MY' }));
  assert.doesNotThrow(() => liveFromIgmp({ list_row: { PromotionCode: 'X' }, detail: {} }, { brand: 'WS1_MY' }));
  const c = liveFromIgmp({ list_row: { PromotionCode: 'X' }, detail: {}, rewardContents: null }, { brand: 'WS1_MY' });
  assert.deepEqual(c.content.names, {});
});

test('Item 1: a malformed entry (missing Content or PromotionRewardName) partially populates without throwing', () => {
  const partial = [
    { RewardId: 1, Locale: 'en', PromotionRewardName: 'Name Only' }, // no Content
    { RewardId: 1, Locale: 'zh', Content: '<p>body only</p>' },       // no PromotionRewardName
  ];
  const c = liveFromIgmp(liveStateWith(partial, { code: 'PARTIAL_TEST' }), { brand: 'WS1_MY' });
  assert.equal(c.content.names.EN, 'Name Only');
  assert.equal(c.content.mtBody.EN, undefined);
  assert.equal(c.content.mtBody.ZH, '<p>body only</p>');
  assert.equal(c.content.names.ZH, undefined);
});

// ── end-to-end via snapshotToLiveState + full compare (missing content is a real finding) ──

test('Item 1: snapshotToLiveState threads rewardContents through to the adapter end-to-end', () => {
  const snapshot = {
    raw: {
      list: { data: { Promotion: { PromotionCode: 'FS_TH_TEST', PromotionType: 'FreeSpin', IsActive: true } } },
      detail: { data: { Promotion: { PromotionRewards: [{ RewardId: 20001, RolloverMultiplier: 10 }] } } },
      rewardContents: { success: true, data: TH_REWARD_CONTENTS },
    },
  };
  const liveState = snapshotToLiveState(snapshot, 'igmp');
  assert.deepEqual(liveState.rewardContents, TH_REWARD_CONTENTS);
  const c = liveFromIgmp(liveState, { brand: 'WS1_TH' });
  assert.deepEqual(c.content.localesDeclared, ['TH_EN', 'TH_TH']);
});

test('Item 1: missing required IGMP locale content is a real CRITICAL comparison finding, not a silent/unexplained MANUAL_REQUIRED', () => {
  const exp = expectedFromSource({
    promo_code: 'FS_TH_TEST', brands: ['WS1_TH'], currencies: ['THB'], regions: ['TH'],
    bonus_type: 'Free Spin', parsed: { spin_count: 88, value_per_spin: 0.4, to_multiplier: 10, min_deposit: 50 },
  }, { brand: 'WS1_TH', platform: 'igmp', siteId: 'ws1-v3-th' });
  // Live content is EN-only (TH translation not yet published) — a genuine gap.
  const incompleteContents = [TH_REWARD_CONTENTS[0]];
  const act = liveFromIgmp(liveStateWith(incompleteContents, { code: 'FS_TH_TEST', type: 'FreeSpin', extra: {} }), { brand: 'WS1_TH', siteId: 'ws1-v3-th' });
  act.currencies = [{ code: 'THB', minDeposit: 50, maxBonus: null, bonusRatePct: null, freeCreditAmount: null, spinCount: null, valuePerSpin: null, toMultiplier: 10, maxTransferOut: null, withdrawalCap: null, active: true }];
  const r = compare({ expected: exp, actual: act, brand: 'WS1_TH' });
  const name = r.fields.find((f) => f.field === 'localeCompleteness:promotionName');
  assert.equal(name.status, 'UNAVAILABLE');
  assert.match(name.message, /TH_TH/, 'the finding must name the exact missing locale, not just say "manual review needed"');
  assert.equal(r.verdict, 'MANUAL_REQUIRED');
});

test('Item 1: a fully-localized IGMP promo (real EN+TH content) reaches locale-completeness MATCH, not MANUAL_REQUIRED', () => {
  const act = liveFromIgmp(liveStateWith(TH_REWARD_CONTENTS, { code: 'FS_TH_TEST', type: 'FreeSpin' }), { brand: 'WS1_TH', siteId: 'ws1-v3-th' });
  act.currencies = [{ code: 'THB', minDeposit: 50, maxBonus: null, bonusRatePct: null, freeCreditAmount: null, spinCount: 88, valuePerSpin: 0.4, toMultiplier: 10, maxTransferOut: null, withdrawalCap: null, active: true }];
  const exp = expectedFromSource({
    promo_code: 'FS_TH_TEST', brands: ['WS1_TH'], currencies: ['THB'], regions: ['TH'],
    bonus_type: 'Free Spin', parsed: { spin_count: 88, value_per_spin: 0.4, to_multiplier: 10, min_deposit: 50 },
  }, { brand: 'WS1_TH', platform: 'igmp', siteId: 'ws1-v3-th' });
  const r = compare({ expected: exp, actual: act, brand: 'WS1_TH' });
  const name = r.fields.find((f) => f.field === 'localeCompleteness:promotionName');
  const mt = r.fields.find((f) => f.field === 'localeCompleteness:mtBodyLanguages');
  assert.equal(name.status, 'MATCH');
  assert.equal(mt.status, 'MATCH');
});
