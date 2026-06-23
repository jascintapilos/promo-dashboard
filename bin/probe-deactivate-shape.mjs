#!/usr/bin/env node
// Probe what a minimal status-change PUT needs for QP2 and QPRO.
// Tests three approaches in dry-run style (no commit).
// Usage: node bin/probe-deactivate-shape.mjs

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

// Use non-live test promos for probing
const QP2_TEST_ID  = 1175; // TEST_22FS_GOO_20X on ibc22
const QPRO_TEST_ID = 936;  // TEST_22FS_GOO_20X on qpro1

// ─── QP2 probe ──────────────────────────────────────────────────────────────
const qp2Site = getSite('ibc22');
console.log('\n━━━ QP2 GET /api/bo/promotion/' + QP2_TEST_ID + ' ━━━');
const qp2Det = (await authedFetch(qp2Site, `/api/bo/promotion/${QP2_TEST_ID}`)).data.rows;
console.log('merchant_ids type:', typeof qp2Det.merchant_ids, JSON.stringify(qp2Det.merchant_ids));
console.log('dialog_popup_list:', JSON.stringify(qp2Det.dialog_popup_list));
console.log('game_provider_codes:', JSON.stringify(qp2Det.game_provider_codes));
console.log('target:', JSON.stringify(qp2Det.target));
console.log('promotion_category_ids:', JSON.stringify(qp2Det.promotion_category_ids));
console.log('member_group_ids:', JSON.stringify(qp2Det.member_group_ids));
console.log('status:', qp2Det.status);

// Try minimal PUT: just {status: 0}
console.log('\n━━━ QP2 minimal PUT test (status=0 only) ━━━');
try {
  const r = await authedFetch(qp2Site, `/api/bo/promotion/${QP2_TEST_ID}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 0 }),
  });
  console.log('✓ Minimal PUT accepted! response:', JSON.stringify(r).slice(0, 200));
} catch (e) {
  console.log('✗ Minimal PUT rejected:', e.message.slice(0, 400));
}

// ─── QPRO probe ─────────────────────────────────────────────────────────────
const qproSite = getSite('qpro1');
console.log('\n━━━ QPRO1 GET /api/bo/promotion/' + QPRO_TEST_ID + ' ━━━');
const qproDet = (await authedFetch(qproSite, `/api/bo/promotion/${QPRO_TEST_ID}`)).data.rows;
console.log('promotion_currency present?', !!qproDet.promotion_currency);
console.log('status:', qproDet.status);
console.log('all keys:', Object.keys(qproDet).join(', '));

// Try minimal PUT: just {status: 0}
console.log('\n━━━ QPRO1 minimal PUT test (status=0 only) ━━━');
try {
  const r = await authedFetch(qproSite, `/api/bo/promotion/${QPRO_TEST_ID}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 0 }),
  });
  console.log('✓ Minimal PUT accepted!');
} catch (e) {
  console.log('✗ Minimal PUT rejected:', e.message.slice(0, 400));
}

// Try full GET body PUT (with status changed) for QPRO
console.log('\n━━━ QPRO1 full-body PUT test (status=0, no promotion_currency) ━━━');
const { promotion_currency, ...qproBody } = qproDet;
qproBody.status = 0;
try {
  const r = await authedFetch(qproSite, `/api/bo/promotion/${QPRO_TEST_ID}`, {
    method: 'PUT',
    body: JSON.stringify(qproBody),
  });
  console.log('✓ Full-body PUT accepted!');
  // Verify it actually changed
  const verify = (await authedFetch(qproSite, `/api/bo/promotion/${QPRO_TEST_ID}`)).data.rows;
  console.log('  Status now:', verify.status, '(0=Inactive expected)');

  // Restore to Active
  qproBody.status = 1;
  await authedFetch(qproSite, `/api/bo/promotion/${QPRO_TEST_ID}`, {
    method: 'PUT', body: JSON.stringify(qproBody),
  });
  console.log('  Restored to Active (status=1)');
} catch (e) {
  console.log('✗ Full-body PUT rejected:', e.message.slice(0, 400));
}
