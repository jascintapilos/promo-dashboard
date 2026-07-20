// Regression tests for the SMS/dialog warning guard in both API mappers.
// No live BO calls — all resolved objects are synthetic.
// Covers the 6 required cases from the user spec × 2 platforms (QPRO, QP2).
//
// Run: node test/sms-dialog-warning.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasSmsRequirement as hasSmsQpro,
  buildSmsLocaleCopy as smsLocaleCopyQpro,
  buildSmsTemplateBody as smsBuildQpro,
  buildDialogPopupBody as dialogBuildQpro,
} from '../src/api-mapper-qpro.js';

import {
  hasSmsRequirement as hasSmsQp2,
  buildSmsLocaleCopy as smsLocaleCopyQp2,
  buildSmsTemplateBody as smsBuildQp2,
  buildDialogPopupBody as dialogBuildQp2,
} from '../src/api-mapper-qp2.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function captureWarn() {
  const log = [];
  const orig = console.warn;
  console.warn = (...args) => log.push(args.join(' '));
  return { log, restore: () => { console.warn = orig; } };
}

function fsResolved(overrides = {}) {
  return {
    promo_code: 'TEST_FS_CODE',
    bonus_type: 'Free Spin',
    locales: ['MY_EN'],
    currencies: ['MYR'],
    per_currency_overrides: {},
    parsed: { spin_count: 5, to_multiplier: 8 },
    instructions: { sms_required: true },
    ...overrides,
  };
}

function fcResolved(overrides = {}) {
  return {
    promo_code: 'TEST_FC_CODE',
    bonus_type: 'Free Credit',
    locales: ['MY_EN'],
    currencies: ['MYR'],
    per_currency_overrides: { MYR: { free_credit_amount: 18 } },
    parsed: { free_credit_amount: 18, to_multiplier: 8 },
    instructions: { sms_required: true },
    ...overrides,
  };
}

function depResolved(overrides = {}) {
  return {
    promo_code: 'TEST_DEP_CODE',
    bonus_type: 'Deposit',
    locales: ['MY_EN'],
    currencies: ['MYR'],
    per_currency_overrides: {},
    parsed: { bonus_rate_pct: 100, to_multiplier: 8, min_deposit: 50 },
    instructions: { sms_required: true },
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// QPRO SMS TESTS
// ═══════════════════════════════════════════════════════════════════════════

test('QPRO SMS — case 1+6: sms_required=true, FS but spin_count=null → warn + null', async () => {
  const { log, restore } = captureWarn();
  const resolved = fsResolved({ parsed: { spin_count: null, to_multiplier: 8 } });
  const result = await smsBuildQpro(resolved, 'QPRO11');
  restore();
  assert.equal(result, null, 'should return null when all locales produce no copy');
  assert.equal(log.length, 1, 'should emit exactly one warning');
  assert.ok(log[0].includes('SMS required'), 'warning should mention "SMS required"');
  assert.ok(log[0].includes('TEST_FS_CODE'), 'warning should include the promo code');
  assert.ok(log[0].includes('MY_EN'), 'warning should list the locale');
});

test('QPRO SMS — case 6b: sms_required=true, FC but to_multiplier=null → warn + null', async () => {
  const { log, restore } = captureWarn();
  const resolved = fcResolved({ parsed: { free_credit_amount: 18, to_multiplier: null } });
  const result = await smsBuildQpro(resolved, 'QPRO11');
  restore();
  assert.equal(result, null);
  assert.equal(log.length, 1);
  assert.ok(log[0].includes('SMS required'));
});

test('QPRO SMS — case 3: valid FS mechanics → no warn, body returned', async () => {
  const { log, restore } = captureWarn();
  const resolved = fsResolved();
  const result = await smsBuildQpro(resolved, 'QPRO11');
  restore();
  assert.ok(result !== null, 'should return a non-null body');
  assert.equal(log.length, 0, 'should emit no warning');
  assert.equal(typeof result.name, 'string');
  assert.ok(result.details && Object.keys(result.details).length > 0, 'details should be populated');
  assert.ok(result.code.includes('TEST_FS_CODE'));
});

test('QPRO SMS — case 4: sms not required → no warn, null', async () => {
  const { log, restore } = captureWarn();
  const resolved = fsResolved({ instructions: {} });
  const result = await smsBuildQpro(resolved, 'QPRO11');
  restore();
  assert.equal(result, null);
  assert.equal(log.length, 0);
});

test('QPRO SMS — case 5: Cashback exemption → no warn, null', async () => {
  const { log, restore } = captureWarn();
  const resolved = fsResolved({ bonus_type: 'Cashback', instructions: { sms_required: true } });
  const result = await smsBuildQpro(resolved, 'QPRO11');
  restore();
  assert.equal(result, null);
  assert.equal(log.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// QPRO DIALOG TESTS
// ═══════════════════════════════════════════════════════════════════════════

test('QPRO Dialog — case 2: popup_dialog=true, unknown bonus_type → warn + null', async () => {
  const { log, restore } = captureWarn();
  const resolved = {
    promo_code: 'TEST_UNKNOWN',
    bonus_type: 'Gift Card',
    popup_dialog: true,
    locales: ['MY_EN'],
    currencies: ['MYR'],
    per_currency_overrides: {},
    parsed: {},
    promotion_name_en: 'Test Promo',
    promotion_name_zh_id: null,
  };
  const result = await dialogBuildQpro(resolved, 'QPRO11');
  restore();
  assert.equal(result, null);
  assert.equal(log.length, 1);
  assert.ok(log[0].includes('Dialog popup requested'));
  assert.ok(log[0].includes('TEST_UNKNOWN'));
});

test('QPRO Dialog — case 3: popup_dialog=true, Free Credit, MY_EN → no warn, body returned', async () => {
  const { log, restore } = captureWarn();
  const resolved = {
    promo_code: 'TEST_FC_DLG',
    bonus_type: 'Free Credit',
    popup_dialog: true,
    locales: ['MY_EN'],
    currencies: ['MYR'],
    per_currency_overrides: { MYR: { free_credit_amount: 18 } },
    parsed: { free_credit_amount: 18, to_multiplier: 8, min_deposit: 0 },
    promotion_name_en: 'Test Free Credit',
    promotion_name_zh_id: null,
  };
  const result = await dialogBuildQpro(resolved, 'QPRO11');
  restore();
  assert.ok(result !== null, 'should return a non-null body');
  assert.equal(log.length, 0, 'should emit no warning');
  assert.ok(result.contents && Object.keys(result.contents).length > 0);
});

test('QPRO Dialog — case 4: popup_dialog=false → no warn, null', async () => {
  const { log, restore } = captureWarn();
  const resolved = {
    promo_code: 'TEST_NO_DLG',
    bonus_type: 'Free Credit',
    popup_dialog: false,
    locales: ['MY_EN'],
    currencies: ['MYR'],
    per_currency_overrides: {},
    parsed: {},
  };
  const result = await dialogBuildQpro(resolved, 'QPRO11');
  restore();
  assert.equal(result, null);
  assert.equal(log.length, 0);
});

test('QPRO Dialog — case 5: Cashback, popup_dialog=true → no warn, null', async () => {
  const { log, restore } = captureWarn();
  const resolved = {
    promo_code: 'TEST_CB_DLG',
    bonus_type: 'Cashback',
    popup_dialog: true,
    locales: ['MY_EN'],
    currencies: ['MYR'],
    per_currency_overrides: {},
    parsed: {},
  };
  const result = await dialogBuildQpro(resolved, 'QPRO11');
  restore();
  assert.equal(result, null);
  assert.equal(log.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// QP2 SMS TESTS
// ═══════════════════════════════════════════════════════════════════════════

test('QP2 SMS — case 1+6: sms_required=true, FS but spin_count=null → warn + null', async () => {
  const { log, restore } = captureWarn();
  const resolved = fsResolved({ parsed: { spin_count: null, to_multiplier: 8 } });
  const result = await smsBuildQp2(resolved, 'QP2A');
  restore();
  assert.equal(result, null);
  assert.equal(log.length, 1);
  assert.ok(log[0].includes('SMS required'));
  assert.ok(log[0].includes('TEST_FS_CODE'));
  assert.ok(log[0].includes('MY_EN'));
});

test('QP2 SMS — case 6b: sms_required=true, FC but to_multiplier=null → warn + null', async () => {
  const { log, restore } = captureWarn();
  const resolved = fcResolved({ parsed: { free_credit_amount: 18, to_multiplier: null } });
  const result = await smsBuildQp2(resolved, 'QP2A');
  restore();
  assert.equal(result, null);
  assert.equal(log.length, 1);
  assert.ok(log[0].includes('SMS required'));
});

test('QP2 SMS — case 3: valid FS mechanics → no warn, body returned', async () => {
  const { log, restore } = captureWarn();
  const resolved = fsResolved();
  const result = await smsBuildQp2(resolved, 'QP2A');
  restore();
  assert.ok(result !== null);
  assert.equal(log.length, 0);
  assert.equal(typeof result.name, 'string');
  assert.ok(result.details && Object.keys(result.details).length > 0);
  assert.ok(result.code.includes('TEST_FS_CODE'));
});

test('QP2 SMS — case 4: sms not required → no warn, null', async () => {
  const { log, restore } = captureWarn();
  const resolved = fsResolved({ instructions: {} });
  const result = await smsBuildQp2(resolved, 'QP2A');
  restore();
  assert.equal(result, null);
  assert.equal(log.length, 0);
});

test('QP2 SMS — case 5: Cashback exemption → no warn, null', async () => {
  const { log, restore } = captureWarn();
  const resolved = fsResolved({ bonus_type: 'Cashback', instructions: { sms_required: true } });
  const result = await smsBuildQp2(resolved, 'QP2A');
  restore();
  assert.equal(result, null);
  assert.equal(log.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// QP2 DIALOG TESTS
// ═══════════════════════════════════════════════════════════════════════════

test('QP2 Dialog — case 2: popup_dialog=true, unknown bonus_type → warn + null', async () => {
  const { log, restore } = captureWarn();
  const resolved = {
    promo_code: 'TEST_UNKNOWN_QP2',
    bonus_type: 'Gift Card',
    popup_dialog: true,
    locales: ['MY_EN'],
    currencies: ['MYR'],
    per_currency_overrides: {},
    parsed: {},
    promotion_name_en: 'Test Promo',
    promotion_name_zh_id: null,
  };
  const result = await dialogBuildQp2(resolved, 'QP2A');
  restore();
  assert.equal(result, null);
  assert.equal(log.length, 1);
  assert.ok(log[0].includes('Dialog popup requested'));
  assert.ok(log[0].includes('TEST_UNKNOWN_QP2'));
});

test('QP2 Dialog — case 3: popup_dialog=true, Free Credit, MY_EN → no warn, body returned', async () => {
  const { log, restore } = captureWarn();
  const resolved = {
    promo_code: 'TEST_FC_DLG_QP2',
    bonus_type: 'Free Credit',
    popup_dialog: true,
    locales: ['MY_EN'],
    currencies: ['MYR'],
    per_currency_overrides: { MYR: { free_credit_amount: 18 } },
    parsed: { free_credit_amount: 18, to_multiplier: 8, min_deposit: 0 },
    promotion_name_en: 'Test Free Credit',
    promotion_name_zh_id: null,
  };
  const result = await dialogBuildQp2(resolved, 'QP2A');
  restore();
  assert.ok(result !== null);
  assert.equal(log.length, 0);
  assert.ok(result.contents && Object.keys(result.contents).length > 0);
  assert.equal(result.site_id, 1);
});

test('QP2 Dialog — case 4: popup_dialog=false → no warn, null', async () => {
  const { log, restore } = captureWarn();
  const resolved = {
    promo_code: 'TEST_NO_DLG_QP2',
    bonus_type: 'Free Credit',
    popup_dialog: false,
    locales: ['MY_EN'],
    currencies: ['MYR'],
    per_currency_overrides: {},
    parsed: {},
  };
  const result = await dialogBuildQp2(resolved, 'QP2A');
  restore();
  assert.equal(result, null);
  assert.equal(log.length, 0);
});

test('QP2 Dialog — case 5: Cashback, popup_dialog=true → no warn, null', async () => {
  const { log, restore } = captureWarn();
  const resolved = {
    promo_code: 'TEST_CB_DLG_QP2',
    bonus_type: 'Cashback',
    popup_dialog: true,
    locales: ['MY_EN'],
    currencies: ['MYR'],
    per_currency_overrides: {},
    parsed: {},
  };
  const result = await dialogBuildQp2(resolved, 'QP2A');
  restore();
  assert.equal(result, null);
  assert.equal(log.length, 0);
});
