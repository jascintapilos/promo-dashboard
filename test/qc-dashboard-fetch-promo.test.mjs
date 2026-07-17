import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQproQp2 } from '../src/qc-dashboard/fetch-promo.js';

test('QPRO detail normalization maps live BO fields without false unavailable values', () => {
  const snapshot = normalizeQproQp2({
    brand: 'QPRO1',
    runtime: { platform: 'qpro' },
    listingRow: {
      id: 123,
      code: 'RET_CRM_REL_30PCT_12X_ALL',
      name: 'Reload 30%',
      bonus_type: 'Deposit - Reload',
      status: 1,
      valid_from: '2026-07-17T00:00:00.000000Z',
      valid_to: '2026-07-24T23:59:59.000000Z',
      message_templates: [{}],
      dialog_popup_list: [{}],
    },
    detail: {
      id: 123,
      code: 'RET_CRM_REL_30PCT_12X_ALL',
      promo_type: 2,
      promo_sub_type: 1,
      bonus_rate: '30.00',
      valid_from: '2026-07-17T00:00:00.000000Z',
      valid_to: '2026-07-24T23:59:59.000000Z',
      max_application: 0,
      daily_max: 1,
      recurring: 0,
      reset_frequency: 0,
      status: 1,
      target: [{ multiplier: 12 }],
    },
    currencies: [{
      currency: 1,
      min_transfer: '100.00',
      max_bonus: '6000.00',
      max_total_applications: 0,
      max_total_bonus: 0,
      bonus_rate: '0.00',
    }],
    names: [{ locale: 'MY_EN', promotion_name: 'Reload 30%' }],
    listingFull: { data: { rows: [] } },
  });

  assert.equal(snapshot.details.reward, '30%');
  assert.equal(snapshot.details.promoType, 'Deposit - Reload');
  assert.equal(snapshot.details.lifetimeClaim, 'Unlimited');
  assert.equal(snapshot.details.dailyClaim, '1');
  assert.equal(snapshot.details.validity, '2026-07-17 \u2192 2026-07-24');
  assert.equal(snapshot.details.recurring, 'Once');
  assert.equal(snapshot.details.status, 'Active');
});

test('QP2 blank per-currency max_total limits render as Unlimited', () => {
  const snapshot = normalizeQproQp2({
    brand: 'QP2A',
    runtime: { platform: 'qp2' },
    listingRow: {
      id: 456,
      code: 'FC_TEST',
      name: 'Free Credit',
      status: 0,
      valid_from: '2026-07-17T00:00:00.000000Z',
      valid_to: null,
      message_templates: [],
      dialog_popup_list: [],
    },
    detail: {
      id: 456,
      code: 'FC_TEST',
      promo_type: 3,
      valid_from: '2026-07-17T00:00:00.000000Z',
      valid_to: null,
      daily_max: 1,
      recurring: 0,
      reset_frequency: 0,
      status: 0,
      target: [{ multiplier: 8 }],
    },
    currencies: [{
      currency: 'MYR',
      bonus_amount: '10.00',
      max_total_applications: null,
      max_total_bonus: null,
      min_transfer: '0.00',
      max_bonus: '0.00',
    }],
    names: [{ locale: 'MY_EN', promotion_name: 'Free Credit' }],
    listingFull: { data: { rows: [] } },
  });

  assert.equal(snapshot.details.reward, '10');
  assert.equal(snapshot.details.lifetimeClaim, 'Unlimited');
  assert.equal(snapshot.details.validity, '2026-07-17 \u2192 Unlimited');
  assert.equal(snapshot.details.status, 'Inactive');
});
