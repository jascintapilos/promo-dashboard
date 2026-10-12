// Phase 2 collector tests — fields recovered from the QPRO/QP2 listing row.
//
// Context: re-probing G4 revealed the listing row carries far more than the
// code assumed. Message-template bodies, dialog linkage, provider codes,
// category codes and the auto-reward flag were all available while the
// adapters reported them as missing. These tests pin each recovered path and
// guard the "never invent evidence" rule.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localeKeyForSettingsId, languageForLocaleKey, messageTemplatesFromRow,
  smsTemplatesFromRow, dialogLinkageFromRow, splitCodeString,
  categoriesFromShortCodes, categoriesFromShortCodesDetailed, autoRewardFromRow, currencyCodesFromRow,
  SETTINGS_LOCALE_ID_MAP, CATEGORY_SHORT_CODE_MAP, gameProviderCodesFromRow,
} from '../src/qc-dashboard/canonical/listing-row-fields.js';

// ── locale mapping ──────────────────────────────────────────────────────

test('locale: settings_locale_id map matches the empirically-derived ids', () => {
  assert.equal(localeKeyForSettingsId(1), 'MY_EN');
  assert.equal(localeKeyForSettingsId(3), 'MY_ZH');
  assert.equal(localeKeyForSettingsId(6), 'SG_EN');
  assert.equal(localeKeyForSettingsId(7), 'SG_ZH');
  assert.equal(localeKeyForSettingsId(8), 'ID_ID');
});

test('locale: unknown id is surfaced as LOCALE_<id>, never guessed', () => {
  assert.equal(localeKeyForSettingsId(99), 'LOCALE_99');
  assert.equal(localeKeyForSettingsId(null), null);
  assert.equal(localeKeyForSettingsId('nope'), null);
});

test('locale: language collapse maps region locales to language buckets', () => {
  assert.equal(languageForLocaleKey('MY_EN'), 'EN');
  assert.equal(languageForLocaleKey('SG_EN'), 'EN');
  assert.equal(languageForLocaleKey('MY_ZH'), 'ZH');
  assert.equal(languageForLocaleKey('ID_ID'), 'ID');
  assert.equal(languageForLocaleKey('TH_TH'), 'TH');
  assert.equal(languageForLocaleKey(null), null);
});

// ── G2: message templates ───────────────────────────────────────────────

const ROW_WITH_MT = {
  message_templates: [
    { id: 1, settings_locale_id: 1, message_template_id: 1054, subject: 'EN subject', message: '<p>EN body</p>' },
    { id: 2, settings_locale_id: 3, message_template_id: 1054, subject: 'ZH subject', message: '<p>ZH body</p>' },
    { id: 3, settings_locale_id: 6, message_template_id: 1054, subject: 'SG EN subject', message: '<p>SG EN body</p>' },
    { id: 4, settings_locale_id: 7, message_template_id: 1054, subject: 'SG ZH subject', message: '<p>SG ZH body</p>' },
  ],
};

test('G2: message bodies + subjects extracted per language from the listing row', () => {
  const r = messageTemplatesFromRow(ROW_WITH_MT);
  assert.equal(r.mtBody.EN, '<p>EN body</p>');
  assert.equal(r.mtBody.ZH, '<p>ZH body</p>');
  assert.equal(r.mtSubject.EN, 'EN subject');
  assert.equal(r.mtSubject.ZH, 'ZH subject');
});

test('G2: MY locale wins over SG for the same language (deterministic precedence)', () => {
  const r = messageTemplatesFromRow(ROW_WITH_MT);
  assert.equal(r.mtBody.EN, '<p>EN body</p>', 'MY_EN (id 1) must win over SG_EN (id 6)');
  assert.equal(r.mtBody.SG_EN, undefined, 'language buckets only — not region keys');
});

test('G2: per-locale detail retained alongside the language buckets', () => {
  const r = messageTemplatesFromRow(ROW_WITH_MT);
  assert.deepEqual(Object.keys(r.byLocale).sort(), ['MY_EN', 'MY_ZH', 'SG_EN', 'SG_ZH']);
  assert.equal(r.byLocale.SG_ZH.subject, 'SG ZH subject');
});

test('G2: template ids collected, de-duplicated', () => {
  const r = messageTemplatesFromRow(ROW_WITH_MT);
  assert.deepEqual(r.templateIds, [1054]);
});

test('G2: absent / malformed message_templates yields empty buckets, no throw', () => {
  for (const row of [{}, { message_templates: null }, { message_templates: 'nope' }, { message_templates: [null, 42] }]) {
    const r = messageTemplatesFromRow(row);
    assert.deepEqual(r.mtBody, {});
    assert.deepEqual(r.templateIds, []);
  }
});

test('G2: rows with an unmappable locale id are skipped, not mislabelled', () => {
  const r = messageTemplatesFromRow({ message_templates: [{ settings_locale_id: null, subject: 's', message: 'm' }] });
  assert.deepEqual(r.mtBody, {}, 'a template with no resolvable locale must not land in a language bucket');
});

test('G2: SMS templates read from the sibling sms_message_templates key', () => {
  const r = smsTemplatesFromRow({
    sms_message_templates: [{ settings_locale_id: 1, subject: 'sms subj', message: 'sms body' }],
  });
  assert.equal(r.mtBody.EN, 'sms body');
});

// ── G3: dialog linkage (IDs only — body is NOT on the row) ──────────────

test('G3: dialog linkage extracts popup ids', () => {
  const r = dialogLinkageFromRow({ dialog_popup_list: [{ id: 5, promotion_id: 9, popup_id: 602 }] });
  assert.deepEqual(r.popupIds, [602]);
  assert.equal(r.count, 1);
});

test('G3: falls back to row id when popup_id is absent; de-dupes', () => {
  const r = dialogLinkageFromRow({ dialog_popup_list: [{ id: 7 }, { popup_id: 7 }] });
  assert.deepEqual(r.popupIds, [7]);
});

test('G3: absent dialog list yields empty, no throw', () => {
  assert.deepEqual(dialogLinkageFromRow({}).popupIds, []);
  assert.deepEqual(dialogLinkageFromRow({ dialog_popup_list: 'x' }).popupIds, []);
});

// ── G8: provider code strings ───────────────────────────────────────────

test('G8: comma-delimited provider string splits, trims, sorts, de-dupes', () => {
  assert.deepEqual(splitCodeString('PP, PP2, AG'), ['AG', 'PP', 'PP2']);
  assert.deepEqual(splitCodeString('PP,PP , PP'), ['PP']);
  assert.deepEqual(splitCodeString(''), []);
  assert.deepEqual(splitCodeString(null), []);
});

test('G8: already-array input is normalized the same way', () => {
  assert.deepEqual(splitCodeString(['PP2', 'AG', 'AG']), ['AG', 'PP2']);
});

test('G8: a realistic 41-provider string parses completely', () => {
  const real = 'AG, AP, BNG, BOOM, BTG, CQ9, FC, FP, FS, HABA, HSG, JDB, JILI, JK, KA, KAYA, KM, LIVE, LUCKY, MAHA, MEGAB, MEGAC, MGP, MONKEY, NET2, NEXT, NLC, PGS, PGS2, PGS3, PNG, PP, PP2, PTI, RG, RT2, SG, SIMPLE, TTG2, XE, YB';
  const out = splitCodeString(real);
  assert.equal(out.length, 41);
  assert.ok(out.includes('PP2') && out.includes('PTI'));
});

// ── Gap-closure item 3: provider-code fallback order (not a union) ──────

test('gameProviderCodesFromRow prefers detail.game_provider_codes and does NOT union in the broader listing-row string', () => {
  // Real live shapes (2026-08-10, QP2A WHALE_CRM_PROBE_DEP50PCT_500_12X):
  // detail had 46 codes; the listing-row string carried those 46 PLUS 6 more
  // (GXW, PNG, PP, SBO, SPRIBE, YL) that do not belong to this promo's own
  // restriction — proven by detail and target[] agreeing exactly with each
  // other and disagreeing with the row string.
  const detail = { game_provider_codes: ['AG', 'BG', 'PP2'] };
  const row = { game_provider: 'AG, BG, PP2, PP, SBO, GXW' }; // broader — must NOT leak through
  const r = gameProviderCodesFromRow({ row, detail });
  assert.deepEqual(r.codes, ['AG', 'BG', 'PP2']);
  assert.equal(r.source, 'detail');
});

test('gameProviderCodesFromRow falls back to target[] when detail.game_provider_codes is empty (QP2)', () => {
  const detail = { target: [{ game_provider_codes: ['PP2'] }, { game_provider_codes: ['AG', 'PP2'] }] };
  const r = gameProviderCodesFromRow({ row: { game_provider: 'PP2, AG, ZZ' }, detail });
  assert.deepEqual(r.codes, ['AG', 'PP2']);
  assert.equal(r.source, 'target');
});

test('gameProviderCodesFromRow falls back to the listing-row string only when neither detail.game_provider_codes nor target[] have anything (QPRO\'s common case)', () => {
  const r = gameProviderCodesFromRow({ row: { game_provider: 'AG, BG, PP2' }, detail: {} });
  assert.deepEqual(r.codes, ['AG', 'BG', 'PP2']);
  assert.equal(r.source, 'listing-row');
});

test('gameProviderCodesFromRow reports source:"none" when there is genuinely no provider-scope evidence anywhere', () => {
  const r = gameProviderCodesFromRow({ row: {}, detail: {} });
  assert.deepEqual(r.codes, []);
  assert.equal(r.source, 'none');
});

// ── G9: category short codes ────────────────────────────────────────────

test('G9: short codes map to the canonical category vocabulary', () => {
  assert.deepEqual(categoriesFromShortCodes('SL'), ['SLOTS']);
  assert.deepEqual(categoriesFromShortCodes('LC'), ['LIVE_CASINO']);
  assert.deepEqual(categoriesFromShortCodes('SP'), ['SPORTS']);
  assert.deepEqual(categoriesFromShortCodes('SL, LC'), ['LIVE_CASINO', 'SLOTS']);
});

test('G9: unknown short code is preserved, never dropped', () => {
  // Dropping a restriction would make a restricted promo look unrestricted —
  // the exact bypass risk the compare engine flags as CRITICAL.
  assert.deepEqual(categoriesFromShortCodes('SL, ZZ'), ['SLOTS', 'ZZ']);
});

test('GATE3: category map contains ONLY verified codes (no invented entries)', () => {
  assert.deepEqual(Object.keys(CATEGORY_SHORT_CODE_MAP).sort(), ['LC', 'SL', 'SP']);
});

test('GATE3: real production category string reports unmapped codes + incompleteness', () => {
  // "CG, CK, ES, FS, LC, SL, SP" appears on 182 production promos.
  const r = categoriesFromShortCodesDetailed('CG, CK, ES, FS, LC, SL, SP');
  assert.deepEqual(r.unmapped, ['CG', 'CK', 'ES', 'FS']);
  assert.equal(r.complete, false, 'incomplete scope must be visible to the caller');
  assert.ok(r.categories.includes('SLOTS') && r.categories.includes('CG'),
    'mapped codes canonicalized, unmapped passed through verbatim');
});

test('GATE3: fully-mapped string reports complete', () => {
  const r = categoriesFromShortCodesDetailed('SL, LC');
  assert.deepEqual(r.unmapped, []);
  assert.equal(r.complete, true);
});

test('G9: empty category string yields empty array', () => {
  assert.deepEqual(categoriesFromShortCodes(''), []);
  assert.deepEqual(categoriesFromShortCodes(null), []);
});

// ── G4: auto-reward flag across both field names ────────────────────────

test('G4: QP2 reads auto_reward_activation from the listing row', () => {
  assert.equal(autoRewardFromRow({ row: { auto_reward_activation: 1 }, platform: 'qp2' }), true);
  assert.equal(autoRewardFromRow({ row: { auto_reward_activation: 0 }, platform: 'qp2' }), false);
});

test('G4: QP2 falls back to detail when the row lacks the key (QP2D case)', () => {
  assert.equal(autoRewardFromRow({ row: {}, detail: { auto_reward_activation: 1 }, platform: 'qp2' }), true);
});

test('ITEM 3: QPRO auto_approve IS now accepted as auto-reward proof by default (proven — see doc comment)', () => {
  // Proven 2026-08-10 via the BO's own compiled frontend (toggle label "Auto
  // Approve", tooltip "Auto approves promotion applied or claimed from user
  // portal by the user") plus a live sweep of all 17 QPRO brands finding 522
  // genuine auto_approve=0 rows across every bonus type — the "zero variance
  // across 469 bundles" finding was a sampling artifact of a narrow corpus,
  // not evidence the field is inert.
  assert.equal(autoRewardFromRow({ row: { auto_approve: 1, auto_unlock: 1 }, platform: 'qpro' }), true);
  assert.equal(autoRewardFromRow({ row: { auto_approve: 0 }, platform: 'qpro' }), false);
});

test('GATE3: QPRO still honours a genuinely-named auto_reward_activation if one appears (named field wins over the proxy)', () => {
  assert.equal(autoRewardFromRow({ row: { auto_reward_activation: 1 }, platform: 'qpro' }), true);
  assert.equal(autoRewardFromRow({ row: { auto_reward_activation: 0, auto_approve: 1 }, platform: 'qpro' }), false);
});

test('ITEM 3: trustQproAutoApprove:false restores the old conservative (named-field-only) behavior', () => {
  assert.equal(autoRewardFromRow({ row: { auto_approve: 1 }, platform: 'qpro', trustQproAutoApprove: false }), null);
  assert.equal(autoRewardFromRow({ row: { auto_approve: 1 }, platform: 'qpro' }), true);
});

test('G4: returns null (never a silent false) when no source carries the flag', () => {
  assert.equal(autoRewardFromRow({ row: {}, detail: {}, platform: 'qpro' }), null);
  assert.equal(autoRewardFromRow({}), null);
});

test('G4: boolean and string encodings are both accepted (via the named field)', () => {
  assert.equal(autoRewardFromRow({ row: { auto_reward_activation: true }, platform: 'qp2' }), true);
  assert.equal(autoRewardFromRow({ row: { auto_reward_activation: 'true' }, platform: 'qp2' }), true);
  assert.equal(autoRewardFromRow({ row: { auto_reward_activation: '0' }, platform: 'qp2' }), false);
  // QP2 falls back to auto_approve too since its named field exists; QPRO
  // now trusts the same proxy by default (item 3 proof) — see the dedicated
  // ITEM 3 tests above for QPRO's own coverage of this.
  assert.equal(autoRewardFromRow({ row: { auto_approve: '1' }, platform: 'qp2' }), true);
});

// ── currency cross-check ────────────────────────────────────────────────

test('currency codes parse from the listing row string', () => {
  assert.deepEqual(currencyCodesFromRow({ currencies: 'MYR, SGD' }), ['MYR', 'SGD']);
  assert.deepEqual(currencyCodesFromRow({}), []);
});

// ── map integrity guards ────────────────────────────────────────────────

test('maps are frozen so a caller cannot mutate collector semantics at runtime', () => {
  assert.throws(() => { SETTINGS_LOCALE_ID_MAP[1] = 'HACKED'; }, TypeError);
  assert.throws(() => { CATEGORY_SHORT_CODE_MAP.SL = 'HACKED'; }, TypeError);
});
