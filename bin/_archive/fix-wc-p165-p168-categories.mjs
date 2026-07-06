#!/usr/bin/env node
// Fix P165–P168 Sports-Only category + provider config on all 8 brands.
//
// QPRO (7 brands): promotion_category_turnover was empty → set to SPORT only.
// QP2C (ibc22):   game_provider_codes had all 51 providers → restrict to Sports only.
//
// Usage:
//   node bin/fix-wc-p165-p168-categories.mjs           # dry run
//   node bin/fix-wc-p165-p168-categories.mjs --commit  # live PUT

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const COMMIT = process.argv.includes('--commit');
console.log(`\nP165–P168 WC category/provider fix — ${COMMIT ? 'LIVE (--commit)' : 'DRY RUN'}\n`);

// ── Helpers ──────────────────────────────────────────────────────────────────

function arrayToIntObj(arr) {
  const out = {};
  arr.forEach((v, i) => { out[String(i)] = v; });
  return out;
}

function isoToBoDatetime(iso) {
  return (iso || '').replace('T', ' ').replace(/\.\d+Z$/, '');
}

async function resolveCatId(site, name) {
  const r = await authedFetch(site, '/api/bo/categories?perPage=500');
  const rows = Object.values(r?.data?.rows ?? {});
  const row = rows.find(c => String(c.name || '').toUpperCase() === name.toUpperCase());
  return row?.id ?? null;
}

async function getDialogPopup(site, promoId) {
  // dialog_popup_list lives on the listing row, NOT the detail — per feedback_promotion_put_dialog_popup_list_wipe.md
  const r = await authedFetch(site, `/api/bo/promotion?id=${promoId}&perPage=5`);
  const rows = Object.values(r?.data?.rows ?? {});
  return rows.find(p => p.id === promoId)?.dialog_popup_list?.[0] ?? null;
}

// ── QPRO fix ─────────────────────────────────────────────────────────────────
// Sets promotion_category_turnover to SPORT (id=1 on all QPRO brands, confirmed by probe).
// Preserves all other fields (game_provider_ids, dialog, MT, blacklist, etc.).

function buildQproPutBody(detail, catIds, popupRow) {
  const gpIds = Array.isArray(detail.game_provider_ids) ? detail.game_provider_ids : [];
  const target0 = Array.isArray(detail.target) ? detail.target[0] : (detail.target?.['0'] ?? {});
  const targetGpIds = Array.isArray(target0.game_provider_ids)
    ? target0.game_provider_ids : gpIds;

  const body = {
    id:   detail.id,
    code: detail.code,
    name: detail.name,
    free_spin_game_provider_id:  detail.free_spin_game_provider_id ?? 0,
    promotion_category_turnover: arrayToIntObj(catIds),
    promotion_category_winloss:  [],
    promo_type:     detail.promo_type,
    promo_sub_type: detail.promo_sub_type,
    promotion_ids:  [],
    valid_from:     isoToBoDatetime(detail.valid_from),
    validity:       detail.validity,
    reward_validity: detail.reward_validity,
    frequency:      detail.frequency ?? [],
    frequency_type: Number(detail.frequency_type),
    first_deposit:  0,
    member_group_ids: [],
    last_deposit:   detail.last_deposit,
    auto_approve:   detail.auto_approve,
    visible_by_affiliate: detail.visible_by_affiliate,
    recurring:      detail.recurring ?? 0,
    max_per_player: detail.max_per_player ?? 99999,
    daily_max:      detail.daily_max ?? 1,
    status:         detail.status,
    limit_transfer_in:  detail.limit_transfer_in,
    limit_transfer_out: detail.limit_transfer_out,
    restrict_claim_round_active:   detail.restrict_claim_round_active,
    restrict_same_provider_launch: detail.restrict_same_provider_launch,
    auto_unlock:  detail.auto_unlock,
    allow_cancel: detail.allow_cancel,
    game_provider_ids: arrayToIntObj(gpIds),
    target: {
      '0': {
        type:              target0.type       ?? 1,
        multiplier:        target0.multiplier ?? 0,
        game_provider_ids: arrayToIntObj(targetGpIds),
      },
    },
    message_template_id:     detail.message_template_id ?? 0,
    message_template_sms_id: 0,
    eligible_types:          detail.eligible_types,
    affiliate_group_ids:             [],
    telemarketer_ids:                [],
    normal_account_manager_ids:      [],
    vip_account_manager_ids:         [],
    requires_email:    detail.requires_email,
    requires_mobile:   detail.requires_mobile,
    requires_dob:      detail.requires_dob,
    requires_fullname: detail.requires_fullname,
    transfer_unlock:   detail.transfer_unlock,
    kyc_basic:    detail.kyc_basic,
    kyc_advanced: detail.kyc_advanced,
    kyc_pro:      detail.kyc_pro,
    blacklist_id: detail.blacklist_id,
    black_list_sub_categories: [],
    dialog_popup_list: popupRow
      ? { '0': { id: popupRow.popup_id, start_date: popupRow.created_at ? isoToBoDatetime(popupRow.created_at) : '', end_date: null, promotion_id: detail.id, labelKey: '', code: '' } }
      : [],
  };
  if (detail.bonus_rate != null) body.bonus_rate = String(Number(detail.bonus_rate).toFixed(2));
  if (detail.recurring && detail.reset_frequency) body.reset_frequency = detail.reset_frequency;
  return body;
}

// ── QP2 fix ──────────────────────────────────────────────────────────────────
// Sports-only provider codes for QP2C (confirmed by probe — these are the sports
// sportsbook providers in QP2C's catalog).
// PUT uses NUMERIC IDs (quirk vs POST which uses string codes).
const QP2C_SPORTS_PROVIDER_IDS_PUT = { '0': 18, '1': 8, '2': 34, '3': 353, '4': 117, '5': 72, '6': 312 };
// Target still uses string codes on PUT.
const QP2C_SPORTS_PROVIDER_CODES   = { '0': 'CMD', '1': 'MAX', '2': 'SBO', '3': 'SBO2', '4': 'TF', '5': 'WBET', '6': '2BC' };

function buildQp2PutBody(detail, popupRow) {
  const mgIds = Array.isArray(detail.member_group_ids) ? detail.member_group_ids : [];
  const mgIdsObj = Object.fromEntries([...mgIds].sort((a, b) => a - b).map((id, i) => [String(i), id]));

  const target0 = Array.isArray(detail.target) ? detail.target[0] : (detail.target?.['0'] ?? {});
  const multiplierStr = Number(target0?.multiplier ?? 0).toFixed(2);

  // promotion_category_ids stays SPORT only (id=1) — already correct, preserve it.
  const catIds = Array.isArray(detail.promotion_category_ids) ? detail.promotion_category_ids : [1];
  const catIdsObj = arrayToIntObj(catIds);

  // merchant_ids: convert from array shape (GET) to object shape (PUT)
  const merchantIds = Array.isArray(detail.merchant_ids)
    ? Object.fromEntries(detail.merchant_ids.map((m, i) => [String(i), m.id ?? m]))
    : (detail.merchant_ids ?? { '0': 3 });

  const body = {
    id:   detail.id,
    code: detail.code,
    name: detail.name,
    free_spin_game_provider_id: detail.free_spin_game_provider_id ?? 0,
    promotion_category_ids: catIdsObj,
    bonus_settings: 1,
    promo_type:     String(detail.promo_type),
    promo_sub_type: String(detail.promo_sub_type),
    promotion_ids:  [],
    valid_from:     isoToBoDatetime(detail.valid_from),
    validity:       detail.validity,
    reward_validity: detail.reward_validity,
    frequency:      [],
    frequency_type: 1,
    member_group_ids: mgIdsObj,
    members_only:   0,
    fingerprint_check: 0,
    freespin_check: 0,
    auto_approve:   1,
    auto_reward_activation: 1,
    recurring:      detail.recurring ?? 0,
    reset_frequency: 1,
    reset_month:    1,
    max_per_player: detail.max_per_player ?? 1,
    daily_max:      detail.daily_max ?? 1,
    status:         1,
    limit_transfer_in:  0,
    limit_transfer_out: 0,
    bonus_rate:     0,
    auto_unlock:    1,
    allow_cancel:   0,
    withdrawal_unlock: 0,
    // ← THE FIX: Sports-only providers (was all 51)
    game_provider_codes: QP2C_SPORTS_PROVIDER_IDS_PUT,
    target: {
      type: 1,
      multiplier: multiplierStr,
      game_provider_codes: QP2C_SPORTS_PROVIDER_CODES,
    },
    message_template_id:     detail.message_template_id ?? 0,
    message_template_sms_id: 0,
    deposit_count:   0,
    active_period:   0,
    merchant_ids:    merchantIds,
    allow_deposit:   0,
    allow_continuous_claim: 0,
    deposit_status:  detail.last_deposit > 0 ? 4 : 1,
    eligible_types:  1,
    affiliate_group_ids: [],
    telemarketer_ids:    [],
    requires_mobile:  0,
    requires_dob:     0,
    requires_fullname: 0,
    black_list_sub_categories: [],
    blacklist_template_id: detail.blacklist_template_id ?? 2,
    dialog_popup_list: popupRow
      ? { '0': { id: popupRow.popup_id, start_date: popupRow.created_at ? isoToBoDatetime(popupRow.created_at) : '', end_date: null, promotion_id: detail.id, labelKey: '', code: '' } }
      : [],
  };
  return body;
}

// ── Target promo IDs (from probe output 2026-07-02) ──────────────────────────
const QPRO_TARGETS = [
  // [siteId, promoId, code]
  // QPRO3
  ['qpro3',  545, 'WC_GLD_100FC_10X'],
  ['qpro3',  546, 'WC_PLT_188FC_10X'],
  ['qpro3',  547, 'WC_DMD_288FC_10X'],
  ['qpro3',  548, 'WC_VIP_REL_30PCT_12X'],
  // QPRO4
  ['qpro4',  474, 'WC_GLD_100FC_10X'],
  ['qpro4',  475, 'WC_PLT_188FC_10X'],
  ['qpro4',  476, 'WC_DMD_288FC_10X'],
  ['qpro4',  477, 'WC_VIP_REL_30PCT_12X'],
  // QPRO5
  ['qpro5',  415, 'WC_GLD_100FC_10X'],
  ['qpro5',  416, 'WC_PLT_188FC_10X'],
  ['qpro5',  417, 'WC_DMD_288FC_10X'],
  ['qpro5',  418, 'WC_VIP_REL_30PCT_12X'],
  // QPRO7
  ['qpro7',  407, 'WC_GLD_100FC_10X'],
  ['qpro7',  408, 'WC_PLT_188FC_10X'],
  ['qpro7',  409, 'WC_DMD_288FC_10X'],
  ['qpro7',  410, 'WC_VIP_REL_30PCT_12X'],
  // QPRO10
  ['qpro10', 323, 'WC_GLD_100FC_10X'],
  ['qpro10', 324, 'WC_PLT_188FC_10X'],
  ['qpro10', 325, 'WC_DMD_288FC_10X'],
  ['qpro10', 326, 'WC_VIP_REL_30PCT_12X'],
  // QPRO15
  ['qpro15', 314, 'WC_GLD_100FC_10X'],
  ['qpro15', 315, 'WC_PLT_188FC_10X'],
  ['qpro15', 316, 'WC_DMD_288FC_10X'],
  ['qpro15', 317, 'WC_VIP_REL_30PCT_12X'],
  // QPRO16
  ['qpro16', 282, 'WC_GLD_100FC_10X'],
  ['qpro16', 283, 'WC_PLT_188FC_10X'],
  ['qpro16', 284, 'WC_DMD_288FC_10X'],
  ['qpro16', 285, 'WC_VIP_REL_30PCT_12X'],
];

const QP2C_TARGETS = [
  // [promoId, code]
  [1293, 'WC_GLD_100FC_10X'],
  [1294, 'WC_PLT_188FC_10X'],
  [1295, 'WC_DMD_288FC_10X'],
  [1296, 'WC_VIP_REL_30PCT_12X'],
];

// ── Run QPRO ─────────────────────────────────────────────────────────────────

console.log('── QPRO (7 brands) — set promotion_category_turnover = SPORT ──\n');

let ok = 0, fail = 0;

// Cache SPORT category ID per brand (all should be 1, but resolve live to be safe)
const sportCatCache = {};

for (const [siteId, promoId, code] of QPRO_TARGETS) {
  const site = getSite(siteId);
  process.stdout.write(`  ${siteId.padEnd(8)} [${String(promoId).padEnd(5)}] ${code.padEnd(26)} → `);

  try {
    if (!sportCatCache[siteId]) {
      sportCatCache[siteId] = await resolveCatId(site, 'SPORT');
    }
    const catId = sportCatCache[siteId];
    if (!catId) { console.log('SKIP — SPORT category not found on this brand'); fail++; continue; }

    if (!COMMIT) {
      console.log(`would set promotion_category_turnover={"0":${catId}}`);
      ok++;
      continue;
    }

    const [detailRes, popupRow] = await Promise.all([
      authedFetch(site, `/api/bo/promotion/${promoId}`).then(r => r?.data?.rows),
      getDialogPopup(site, promoId),
    ]);
    if (!detailRes) { console.log('SKIP — detail not found'); fail++; continue; }

    const putBody = buildQproPutBody(detailRes, [catId], popupRow);
    const putRes  = await authedFetch(site, `/api/bo/promotion/${promoId}`, { method: 'PUT', body: putBody });

    if (putRes?.success || putRes?.data) { console.log('✓ saved'); ok++; }
    else { console.log(`✗ ${JSON.stringify(putRes).slice(0, 80)}`); fail++; }

  } catch (e) {
    console.log(`ERROR — ${e.message.split('\n')[0].slice(0, 70)}`);
    fail++;
  }
}

console.log(`\n  QPRO done: ok=${ok}  fail=${fail}\n`);

// ── Run QP2C ─────────────────────────────────────────────────────────────────

console.log('── QP2C (ibc22) — restrict game_provider_codes to Sports only ──\n');
console.log('  Sports providers: CMD, MAX(SABA), SBO, SBO2, TF, WBET, 2BC(IWC)\n');

let qp2Ok = 0, qp2Fail = 0;
const qp2Site = getSite('ibc22');

for (const [promoId, code] of QP2C_TARGETS) {
  process.stdout.write(`  ibc22    [${String(promoId).padEnd(5)}] ${code.padEnd(26)} → `);
  try {
    if (!COMMIT) {
      console.log('would set game_provider_codes to 7 Sports-only providers');
      qp2Ok++;
      continue;
    }

    const [detailRes, popupRow] = await Promise.all([
      authedFetch(qp2Site, `/api/bo/promotion/${promoId}`).then(r => r?.data?.rows),
      getDialogPopup(qp2Site, promoId),
    ]);
    if (!detailRes) { console.log('SKIP — detail not found'); qp2Fail++; continue; }

    const putBody = buildQp2PutBody(detailRes, popupRow);
    const putRes  = await authedFetch(qp2Site, `/api/bo/promotion/${promoId}`, { method: 'PUT', body: putBody });

    if (putRes?.success || putRes?.data) { console.log('✓ saved'); qp2Ok++; }
    else { console.log(`✗ ${JSON.stringify(putRes).slice(0, 80)}`); qp2Fail++; }

  } catch (e) {
    console.log(`ERROR — ${e.message.split('\n')[0].slice(0, 70)}`);
    qp2Fail++;
  }
}

console.log(`\n  QP2C done: ok=${qp2Ok}  fail=${qp2Fail}\n`);

console.log('═'.repeat(70));
const totalOk   = ok + qp2Ok;
const totalFail = fail + qp2Fail;
console.log(`  Total: ${totalOk} saved   ${totalFail} failed`);
if (!COMMIT) console.log('  Run with --commit to apply.\n');
