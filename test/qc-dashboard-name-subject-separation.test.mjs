// Correctness gate #1: promotion names and MT subjects are DIFFERENT fields
// and must never overwrite each other.
//
// Real evidence from QPRO1 / P026-r27:
//   promotion name (from /promotionname) : "88% Slots Reload Bonus"
//   MT subject     (from message_templates): "Exclusive Reload Bonus — Claim Yours — 88% Bonus"
// A Phase-2 bug wrote the subject into content.names, which would either
// fabricate a promo-name mismatch or hide a real one behind a populated key.

import test from 'node:test';
import assert from 'node:assert/strict';
import { liveFromQpro, liveFromQp2 } from '../src/qc-dashboard/canonical/index.js';
import { promotionNamesFrom } from '../src/qc-dashboard/canonical/listing-row-fields.js';

const MT_ROWS = [
  { settings_locale_id: 1, message_template_id: 90, subject: 'Exclusive Reload Bonus — Claim Yours', message: '<p>EN body</p>' },
  { settings_locale_id: 3, message_template_id: 90, subject: '专属充值奖励——等您来领', message: '<p>ZH body</p>' },
];
const NAME_ROWS = [
  { locale: 'MY_EN', promotion_name: '88% Slots Reload Bonus' },
  { locale: 'MY_ZH', promotion_name: '88% 老虎机充值奖励' },
];

test('gate1: promotion name and MT subject coexist without overwriting', () => {
  const c = liveFromQpro({
    list_row: { code: 'X', bonus_type: 'Deposit - Reload', status: 1, message_templates: MT_ROWS },
    detail: { promotion_name_list: NAME_ROWS, promotion_currency_list: [] },
  }, { brand: 'QPRO1' });
  assert.equal(c.content.names.EN, '88% Slots Reload Bonus', 'names.EN must be the PROMOTION NAME');
  assert.equal(c.content.names.ZH, '88% 老虎机充值奖励');
  assert.equal(c.content.messageTemplate.subjectByLocale.MY_EN, 'Exclusive Reload Bonus — Claim Yours');
  assert.notEqual(c.content.names.EN, c.content.messageTemplate.subjectByLocale.MY_EN,
    'the two fields must remain distinct');
});

test('gate1: MT subject NEVER leaks into content.names even when names are absent', () => {
  // The pre-fix bug filled names from subjects when names was empty. With no
  // promotion-name source, names must stay EMPTY so the compare engine
  // reports it UNAVAILABLE rather than comparing a subject against a name.
  const c = liveFromQpro({
    list_row: { code: 'X', bonus_type: 'Deposit - Reload', status: 1, message_templates: MT_ROWS },
    detail: { promotion_currency_list: [] },   // no promotion_name_list, no name
  }, { brand: 'QPRO1' });
  assert.equal(c.content.names.EN, undefined, 'no promotion-name source → names must stay empty, not borrow a subject');
  assert.equal(c.content.messageTemplate.subjectByLocale.MY_EN, 'Exclusive Reload Bonus — Claim Yours',
    'the subject is still collected, just in its own field');
});

test('gate1: QP2 behaves identically', () => {
  const c = liveFromQp2({
    list_row: { code: 'X', bonus_type: 'Free Credit', merchant_ids: [1], message_templates: MT_ROWS },
    detail: { promotion_name_list: NAME_ROWS, promotion_currency_list: [] },
  }, { brand: 'QP2A' });
  assert.equal(c.content.names.EN, '88% Slots Reload Bonus');
  assert.notEqual(c.content.names.EN, c.content.messageTemplate.subjectByLocale.MY_EN);
});

test('gate1: a tnc subject is treated as an MT subject, not a promotion name', () => {
  const c = liveFromQpro({
    list_row: { code: 'X', bonus_type: 'Deposit - Reload', status: 1 },
    detail: { promotion_name_list: NAME_ROWS, promotion_currency_list: [] },
    tnc: { messages: { MY_EN: { subject: 'Inbox Subject From TNC', body: '<p>tnc</p>' } } },
  }, { brand: 'QPRO1' });
  assert.equal(c.content.names.EN, '88% Slots Reload Bonus', 'promotion name unchanged by a tnc subject');
  assert.equal(c.content.messageTemplate.subjectByLocale.MY_EN, 'Inbox Subject From TNC');
});

test('gate1: promotion names are locale-keyed as well as language-keyed', () => {
  const c = liveFromQpro({
    list_row: { code: 'X', bonus_type: 'Deposit - Reload', status: 1 },
    detail: {
      promotion_name_list: [
        { locale: 'MY_EN', promotion_name: 'MY English Name' },
        { locale: 'SG_EN', promotion_name: 'SG English Name' },
      ],
      promotion_currency_list: [],
    },
  }, { brand: 'QPRO1' });
  assert.equal(c.content.promotionNamesByLocale.MY_EN, 'MY English Name');
  assert.equal(c.content.promotionNamesByLocale.SG_EN, 'SG English Name');
  assert.equal(c.content.names.EN, 'MY English Name', 'MY wins the EN language bucket');
});

test('gate1: promotionNamesFrom falls back to the normalized bundle shape', () => {
  const r = promotionNamesFrom({
    detail: {
      promotion_name_en: '88% Slots Reload Bonus',
      promotion_name_zh_id: '88% 老虎机充值奖励',
      locales: ['MY_EN', 'MY_ZH', 'SG_EN', 'SG_ZH'],
    },
  });
  assert.equal(r.byLanguage.EN, '88% Slots Reload Bonus');
  assert.equal(r.byLanguage.ZH, '88% 老虎机充值奖励');
  assert.deepEqual(r.localesDeclared, ['MY_EN', 'MY_ZH', 'SG_EN', 'SG_ZH']);
});

test('gate1: localesDeclared surfaces what the BO says the promo carries', () => {
  const c = liveFromQpro({
    list_row: { code: 'X', bonus_type: 'Deposit - Reload', status: 1 },
    detail: {
      promotion_name_list: [
        { locale: 'MY_EN', promotion_name: 'a' }, { locale: 'SG_ZH', promotion_name: 'b' },
      ],
      promotion_currency_list: [],
    },
  }, { brand: 'QPRO1' });
  assert.deepEqual(c.content.localesDeclared, ['MY_EN', 'SG_ZH']);
});
