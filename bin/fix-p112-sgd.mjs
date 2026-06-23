#!/usr/bin/env node
// One-off fix: P112 (id=1205, FT_WELC_120PCT_10X_WCRND) SGD currency row.
//
// The previous session created record 2275 via the BO UI but without
// deposit_options because Angular serialized merchant_bank_ids as an indexed
// object {"0":323,...} rather than an array [323,...]. The server silently
// ignored the field.
//
// Fix: PUT to the main promotion endpoint with the SGD currency block
// including deposit_options: [408, 410, 411, 412] (from reference promo 1198).
// The PUT replaces the embedded promotion_currency rows including deposit_options.
//
// If the PUT approach doesn't persist deposit_options, fall back to:
//   DELETE /api/bo/promotioncurrency/2275
//   POST   /api/bo/promotioncurrency with correct deposit_options array

import { authedFetch, updatePromotion, findPromotionByCode } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { buildApiPlan } from '../src/api-mapper-qp2.js';
import { loadAllRequests } from '../src/planner.js';

const PROMOTION_ID = 1205;
const SGD_DEPOSIT_OPTIONS = [408, 410, 411, 412]; // from reference promo 1198

const site = getSite('ibc22');

// ── Step 1: Check current state ─────────────────────────────────────────────
console.log('── Step 1: Current currency state for P112 (id=1205) ──');
const currRes = await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${PROMOTION_ID}`);
const curRows = currRes?.data?.rows || [];
console.log('  Currency rows:', curRows.map(r => ({
  id: r.id,
  currency: r.currency,
  deposit_options: r.deposit_options,
  min_deposit: r.min_deposit || r.min_transfer,
  max_bonus: r.max_bonus,
})));

const sgdRow = curRows.find(r => r.currency === 'SGD');
const myrRow = curRows.find(r => r.currency === 'MYR');
console.log(`  MYR row: id=${myrRow?.id ?? 'none'}, deposit_options=${JSON.stringify(myrRow?.deposit_options)}`);
console.log(`  SGD row: id=${sgdRow?.id ?? 'none'}, deposit_options=${JSON.stringify(sgdRow?.deposit_options)}`);

if (sgdRow && Array.isArray(sgdRow.deposit_options) && sgdRow.deposit_options.length > 0) {
  console.log('\n✓ SGD row already has deposit_options — nothing to do.');
  process.exit(0);
}

// ── Step 2: Build the full promotion PUT body ─────────────────────────────
console.log('\n── Step 2: Build PUT body for promotion 1205 ──');

// Load the request fixture for P112
const { byHandle } = await loadAllRequests();
const rec = byHandle.get('P112-r113');
if (!rec) throw new Error('P112-r113 fixture not found — run ingest first');

const plan = await buildApiPlan(rec, { brand: 'QP2A', site, merchantIds: [1] });

// Fetch existing linkage (template + popup) so PUT preserves them
const existing = await findPromotionByCode(site, rec.promo_code);
const templateId = existing?.message_template_id || 0;
const popupRow = existing?.dialog_popup_list?.[0];
const dialogPopup = popupRow ? {
  id: popupRow.popup_id,
  code: popupRow.code || popupRow.dialog_popup?.code || '',
  start_date: popupRow.dialog_popup?.start_date || popupRow.start_date,
  label: rec.promotion_name_en,
  fullRow: popupRow.dialog_popup || popupRow,
} : null;

console.log(`  template_id=${templateId}, dialog_popup=${dialogPopup?.id ?? 'none'}`);

// Build the PUT body
const putBody = plan.buildUpdate(PROMOTION_ID, templateId, dialogPopup);

// ── Step 3: Inject deposit_options into the SGD currency block ─────────────
console.log('\n── Step 3: Inject deposit_options into SGD currency block ──');
const currencyKeys = Object.keys(putBody.promotion_currency || {});
console.log(`  promotion_currency keys: ${currencyKeys.join(', ')}`);
console.log('  Blocks:', JSON.stringify(
  Object.fromEntries(currencyKeys.map(k => [
    putBody.promotion_currency[k].currency,
    { currency_id: putBody.promotion_currency[k].currency_id, min_deposit: putBody.promotion_currency[k].min_deposit }
  ]))
));

let injected = false;
for (const key of currencyKeys) {
  const block = putBody.promotion_currency[key];
  if (block.currency === 'SGD') {
    block.deposit_options = SGD_DEPOSIT_OPTIONS;
    // Also try merchant_bank_ids in case that's the write-side field name
    block.merchant_bank_ids = SGD_DEPOSIT_OPTIONS;
    console.log(`  ✓ SGD block[${key}]: deposit_options=${JSON.stringify(SGD_DEPOSIT_OPTIONS)}`);
    injected = true;
  }
}
if (!injected) throw new Error('SGD block not found in promotion_currency — check currencies on rec');

// ── Step 4: Send the PUT ──────────────────────────────────────────────────
console.log('\n── Step 4: PUT /api/bo/promotion/1205 ──');
await updatePromotion(site, PROMOTION_ID, putBody);
console.log('  ✓ PUT succeeded');

// ── Step 5: Verify ────────────────────────────────────────────────────────
console.log('\n── Step 5: Verify deposit_options persisted ──');
const verifyRes = await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${PROMOTION_ID}`);
const verifyRows = verifyRes?.data?.rows || [];
verifyRows.forEach(r => {
  const status = Array.isArray(r.deposit_options) && r.deposit_options.length > 0 ? '✓' : '✗';
  console.log(`  ${status} ${r.currency} (id=${r.id}): deposit_options=${JSON.stringify(r.deposit_options)}`);
});

const sgdVerify = verifyRows.find(r => r.currency === 'SGD');
if (sgdVerify?.deposit_options?.length) {
  console.log('\n✓ P112 SGD deposit_options fixed!');
} else {
  // If PUT didn't work, try direct POST to promotioncurrency
  console.log('\n✗ PUT did not persist deposit_options — trying direct POST to /api/bo/promotioncurrency');
  await tryDirectPost(site, PROMOTION_ID, rec, sgdRow, SGD_DEPOSIT_OPTIONS);
}

async function tryDirectPost(site, promotionId, rec, existingSgdRow, depositOptions) {
  const r = rec.parsed || {};
  const o = rec.per_currency_overrides?.SGD || {};

  if (existingSgdRow) {
    // Try DELETE first
    console.log(`  Attempting DELETE /api/bo/promotioncurrency/${existingSgdRow.id}`);
    try {
      await authedFetch(site, `/api/bo/promotioncurrency/${existingSgdRow.id}`, { method: 'DELETE' });
      console.log(`  ✓ Deleted SGD row ${existingSgdRow.id}`);
    } catch (e) {
      console.log(`  ✗ DELETE failed: ${e.message} — will try POST anyway (BO may merge)`);
    }
  }

  const minDep = o.min_deposit ?? r.min_deposit ?? 0;
  const maxBonus = o.max_bonus ?? r.max_bonus ?? 0;
  const bonusRate = o.bonus_rate_pct ?? r.bonus_rate_pct ?? 0;

  const body = {
    promotion_id: promotionId,
    currency_id: '3',       // SGD
    currency: 'SGD',
    bonus_amount: 0,
    bonus_rate: bonusRate,
    bonus_type: 2,           // Percentage
    bypass_min_deposit: 0,
    max_balance_claim: null,
    status: '1',
    reset: 0,
    start_time: '00:00:00',
    end_time: '23:59:59',
    min_transfer: minDep,
    min_deposit: minDep,
    max_withdraw_type: '1',  // Fixed Amount
    max_withdraw: null,
    max_total_applications: null,
    max_total_bonus: null,
    promo_type: 2,           // Reload (from P112 bonus_type=Deposit/Welcome)
    reset_name: 'None',
    max_bonus: maxBonus,
    total_players: 0,
    current_players: 0,
    total_used_budget: 0,
    current_used_budget: 0,
    deposit_options: depositOptions,
    merchant_bank_ids: depositOptions,
  };

  console.log('  POST body (key fields):', JSON.stringify({
    promotion_id: body.promotion_id,
    currency_id: body.currency_id,
    min_deposit: body.min_deposit,
    max_bonus: body.max_bonus,
    bonus_rate: body.bonus_rate,
    deposit_options: body.deposit_options,
  }));

  const postRes = await authedFetch(site, '/api/bo/promotioncurrency', { method: 'POST', body });
  console.log('  POST response:', JSON.stringify(postRes?.data || postRes).slice(0, 200));

  // Final verify
  const finalRes = await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${promotionId}`);
  const finalRows = finalRes?.data?.rows || [];
  console.log('\n  Final currency state:');
  finalRows.forEach(r => {
    const ok = Array.isArray(r.deposit_options) && r.deposit_options.length > 0 ? '✓' : '✗';
    console.log(`  ${ok} ${r.currency} (id=${r.id}): deposit_options=${JSON.stringify(r.deposit_options)}`);
  });
  const sgdFinal = finalRows.find(row => row.currency === 'SGD');
  if (sgdFinal?.deposit_options?.length) {
    console.log('\n✓ P112 SGD deposit_options fixed via direct POST!');
  } else {
    console.log('\n✗ deposit_options still missing — manual intervention needed');
  }
}
