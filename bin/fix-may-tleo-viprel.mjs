#!/usr/bin/env node
// Fix two May-tab configuration gaps on QPRO3/4/6/8/10 + QP2C.
//
// Part 1 — FT_REL_TLEO catTO (promotion_category_turnover missing):
//   LC promos:    set catTO=[2]  (LIVE CASINO).  Preserve existing gpIds.
//   Slots promos: set catTO=[3]  (SLOTS).         Preserve existing gpIds.
//   Scope: qpro3 / qpro4 / qpro6 / qpro8 / qpro10, ~39 promos each = ~195 records.
//
// Part 2 — VIP_REL Slots+Fishing (providers empty/unrestricted):
//   QPRO4  VIP_REL_100PCT_MIN* + VIP_REL_100PCT_5X_MIN*:
//     set gpIds=Slots+Fishing(39) + catTO=[3,5].
//   QP2C   VIP_REL_100PCT_MIN* + VIP_REL_100PCT_5X_MIN* (IDs 1182–1198):
//     set game_provider_codes=Slots+Fishing + catIds=[3,5].
//
// Usage:
//   node bin/fix-may-tleo-viprel.mjs           # dry run
//   node bin/fix-may-tleo-viprel.mjs --commit  # live PUT

import { authedFetch } from '../src/api-client.js';
import { getSite }     from '../src/sites.js';

const COMMIT = process.argv.includes('--commit');
console.log(`\nMay TLEO+VIP_REL fix — ${COMMIT ? 'LIVE (--commit)' : 'DRY RUN'}\n`);

// ── Helpers ───────────────────────────────────────────────────────────────────

function arrayToIntObj(arr) {
  const out = {};
  arr.forEach((v, i) => { out[String(i)] = v; });
  return out;
}

function isoToBoDatetime(iso) {
  return (iso || '').replace('T', ' ').replace(/\.\d+Z$/, '');
}

async function getDialogPopup(site, promoId) {
  const r = await authedFetch(site, `/api/bo/promotion?id=${promoId}&perPage=5`);
  const rows = Object.values(r?.data?.rows ?? {});
  return rows.find(p => p.id === promoId)?.dialog_popup_list?.[0] ?? null;
}

// Concurrency pool: runs tasks with at most `limit` in-flight at once.
async function runPool(tasks, limit = 10) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const idx = next++;
      try { results[idx] = await tasks[idx](); }
      catch (e) { results[idx] = { error: e.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}

// ── QPRO PUT builder (catTO + gpIds) ─────────────────────────────────────────

function buildQproPutBody(detail, catIds, gpIds, popupRow) {
  const target0 = Array.isArray(detail.target) ? detail.target[0] : (detail.target?.['0'] ?? {});
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
        game_provider_ids: arrayToIntObj(gpIds),
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

// ── QP2 provider constants ────────────────────────────────────────────────────

const QP2A_TARGET_GAME_PROVIDER_CODES = {
  '0': '365G', '1': '9W', '2': 'AP', '3': 'AVI', '4': 'BG', '5': 'BOOM',
  '6': 'BNG', '7': 'BTG', '8': 'CMD', '9': 'CQ9', '10': 'EVOK', '11': 'EZ',
  '12': 'FS', '13': 'FP', '14': 'FC', '15': 'GXW', '16': 'HSG', '17': 'IM',
  '18': '2BC', '19': 'JDB', '20': 'JILI', '21': 'JK', '22': 'KA', '23': 'LIVE',
  '24': 'LUCKY', '25': 'MAHA', '26': 'MGP', '27': 'MONKEY', '28': 'NET2',
  '29': 'NEXT', '30': 'NLC', '31': 'PNG', '32': 'AG', '33': 'PTI', '34': 'PP',
  '35': 'PP2', '36': 'RT2', '37': 'RG', '38': 'SA', '39': 'MAX', '40': 'SBO',
  '41': 'SBO2', '42': 'SEXY', '43': 'SIMPLE', '44': 'SG', '45': 'SPRIBE',
  '46': 'TF', '47': 'VIVO', '48': 'WBET', '49': 'WM', '50': 'XE', '51': 'YB',
  '52': 'YL',
};

const QP2A_PUT_GAME_PROVIDER_IDS = {
  '0': 178, '1': 139, '2': 341, '3': 196, '4': 15, '5': 268, '6': 328, '7': 292,
  '8': 18, '9': 14, '10': 320, '11': 25, '12': 122, '13': 304, '14': 184, '15': 324,
  '16': 197, '17': 23, '18': 312, '19': 110, '20': 111, '21': 7, '22': 190, '23': 21,
  '24': 284, '25': 313, '26': 203, '27': 274, '28': 256, '29': 22, '30': 257, '31': 17,
  '32': 1, '33': 308, '34': 35, '35': 345, '36': 258, '37': 349, '38': 13, '39': 8,
  '40': 34, '41': 353, '42': 31, '43': 10, '44': 9, '45': 187, '46': 117, '47': 332,
  '48': 72, '49': 37, '50': 33, '51': 297, '52': 36,
};

const QP2_CATEGORY_PROVIDER_CODES = {
  'SLOTS':   ['AP', 'BNG', 'BOOM', 'BTG', 'CQ9', 'FC', 'FP', 'FS', 'HSG', 'JDB', 'JILI', 'JK',
               'KA', 'LIVE', 'LUCKY', 'MAHA', 'MGP', 'MONKEY', 'NET2', 'NEXT', 'NLC', 'PNG',
               'PP', 'PP2', 'PTI', 'RG', 'RT2', 'SG', 'SIMPLE', 'XE', 'YB'],
  'FISHING': ['BG', 'BTG', 'CQ9', 'FC', 'FS', 'JDB', 'JILI', 'JK', 'KA', 'LIVE', 'LUCKY',
               'MGP', 'MONKEY', 'SG', 'SIMPLE', 'YB', 'YL'],
};

function filterQp2ProvidersByCat(categoryNames) {
  const catSet = new Set(categoryNames.map(n => n.toUpperCase()));
  const allowedCodes = new Set();
  for (const [cat, codes] of Object.entries(QP2_CATEGORY_PROVIDER_CODES)) {
    if (catSet.has(cat)) codes.forEach(c => allowedCodes.add(c));
  }
  const putIds = {};
  const targetCodes = {};
  let idx = 0;
  for (const k of Object.keys(QP2A_TARGET_GAME_PROVIDER_CODES)) {
    const code = QP2A_TARGET_GAME_PROVIDER_CODES[k];
    if (allowedCodes.has(code)) {
      putIds[String(idx)] = QP2A_PUT_GAME_PROVIDER_IDS[k];
      targetCodes[String(idx)] = code;
      idx++;
    }
  }
  return { putIds, targetCodes };
}

// QP2 PUT builder
function buildQp2PutBody(detail, catIdsObj, categoryProviders, popupRow) {
  const mgIds = Array.isArray(detail.member_group_ids) ? detail.member_group_ids : [];
  const mgIdsObj = Object.fromEntries([...mgIds].sort((a, b) => a - b).map((id, i) => [String(i), id]));
  const target0 = Array.isArray(detail.target) ? detail.target[0] : (detail.target?.['0'] ?? {});
  const multiplierStr = Number(target0?.multiplier ?? 0).toFixed(2);
  const merchantIds = Array.isArray(detail.merchant_ids)
    ? Object.fromEntries(detail.merchant_ids.map((m, i) => [String(i), m.id ?? m]))
    : (detail.merchant_ids ?? { '0': 3 });

  return {
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
    game_provider_codes: categoryProviders.putIds,
    target: {
      type: 1,
      multiplier: multiplierStr,
      game_provider_codes: categoryProviders.targetCodes,
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
}

// ── Category ID constants (consistent across all brands) ──────────────────────
const CAT_ID = { LC: 2, SLOTS: 3, FISHING: 5 };

// Classify TLEO code → category name or null (skip FC promos)
function tleoCategory(code) {
  if (/TLEO_FC/.test(code)) return null;                          // Free Credit — skip
  if (/TLEO_LC_|_LC$|50PCT_25MX_LC|REL_TLEO_LC/.test(code)) return 'LC';
  if (/TLEO_(20PCT|45PCT|50PCT_25MX_SLOT)|_SL_|_SL$|REL_TLEO_SL/.test(code)) return 'SLOTS';
  return null; // unknown — skip
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PART 1 — FT_REL_TLEO catTO fix
// ═══════════════════════════════════════════════════════════════════════════════

console.log('═'.repeat(72));
console.log('  PART 1 — FT_REL_TLEO: set promotion_category_turnover\n');
console.log('  Preserving existing game_provider_ids.\n');

const TLEO_BRANDS = ['qpro3', 'qpro4', 'qpro6', 'qpro8', 'qpro10'];
let p1Ok = 0, p1Fail = 0;

for (const siteId of TLEO_BRANDS) {
  const site = getSite(siteId);
  console.log(`\n  ── ${siteId} ──`);

  // Fetch listing once per brand
  const r = await authedFetch(site, '/api/bo/promotion?perPage=999&page=1');
  const allRows = Object.values(r?.data?.rows ?? {});
  const targets = allRows.filter(p => {
    if (!p.code?.includes('TLEO')) return false;
    return tleoCategory(p.code) !== null;
  });

  if (!targets.length) { console.log('  no TLEO deposit/reload promos found'); continue; }

  const tasks = targets.map(p => async () => {
    const cat    = tleoCategory(p.code);
    const catIds = cat === 'LC' ? [CAT_ID.LC] : [CAT_ID.SLOTS];
    const label  = `[${String(p.id).padEnd(5)}] ${p.code.padEnd(32)} [${cat}]`;

    if (!COMMIT) {
      process.stdout.write(`  ${label} → would set catTO=${JSON.stringify(catIds)}\n`);
      return 'ok';
    }

    const [detail, popupRow] = await Promise.all([
      authedFetch(site, `/api/bo/promotion/${p.id}`).then(r => r?.data?.rows),
      getDialogPopup(site, p.id),
    ]);
    if (!detail) {
      process.stdout.write(`  ${label} → SKIP — detail not found\n`);
      return 'fail';
    }

    // Preserve existing gpIds exactly as-is
    const existingGpIds = Object.values(detail.game_provider_ids ?? {});
    const putBody = buildQproPutBody(detail, catIds, existingGpIds, popupRow);
    const putRes  = await authedFetch(site, `/api/bo/promotion/${p.id}`, { method: 'PUT', body: putBody });

    if (putRes?.success || putRes?.data) {
      process.stdout.write(`  ${label} → ✓ catTO=${JSON.stringify(catIds)}\n`);
      return 'ok';
    } else {
      process.stdout.write(`  ${label} → ✗ ${JSON.stringify(putRes).slice(0, 60)}\n`);
      return 'fail';
    }
  });

  const results = await runPool(tasks, 8);
  const siteOk   = results.filter(r => r === 'ok').length;
  const siteFail = results.filter(r => r !== 'ok').length;
  p1Ok   += siteOk;
  p1Fail += siteFail;
  console.log(`\n  ${siteId}: ok=${siteOk}  fail=${siteFail}`);
}

console.log(`\n  PART 1 total: ok=${p1Ok}  fail=${p1Fail}\n`);

// ═══════════════════════════════════════════════════════════════════════════════
//  PART 2a — VIP_REL Slots+Fishing on QPRO4
// ═══════════════════════════════════════════════════════════════════════════════

console.log('═'.repeat(72));
console.log('  PART 2a — QPRO4 VIP_REL: set Slots+Fishing providers + catTO=[3,5]\n');

const qpro4Site = getSite('qpro4');
let p2aOk = 0, p2aFail = 0;

// Resolve Slots+Fishing provider IDs live from QPRO4 catalog
const gpr4 = await authedFetch(qpro4Site, '/api/bo/gameprovider?perPage=999&page=1');
const gp4Rows = gpr4?.data?.rows || [];
const slotFishIds = gp4Rows
  .filter(r => (r.categories || []).some(c => ['SLOTS', 'FISHING'].includes(c.category?.toUpperCase())))
  .map(r => r.id);
console.log(`  Slots+Fishing provider IDs on qpro4: ${slotFishIds.length} → [${slotFishIds.join(',')}]\n`);

const vip4Listing = await authedFetch(qpro4Site, '/api/bo/promotion?perPage=999&page=1');
const vip4Rows = Object.values(vip4Listing?.data?.rows ?? {});
const vipTargets = vip4Rows.filter(p =>
  p.code?.startsWith('VIP_REL_100PCT_MIN') || p.code?.startsWith('VIP_REL_100PCT_5X_MIN')
);
console.log(`  Found ${vipTargets.length} VIP_REL targets on qpro4\n`);

const VIP_CAT_IDS = [CAT_ID.SLOTS, CAT_ID.FISHING];

for (const p of vipTargets.sort((a, b) => String(a.code).localeCompare(b.code))) {
  const label = `[${String(p.id).padEnd(5)}] ${p.code.padEnd(35)}`;
  process.stdout.write(`  ${label} → `);

  if (!COMMIT) {
    const existingGpCount = (p.game_provider || '').split(',').filter(Boolean).length;
    console.log(`would set gpIds=${slotFishIds.length} (was ${existingGpCount})  catTO=[3,5]`);
    p2aOk++;
    continue;
  }

  try {
    const [detail, popupRow] = await Promise.all([
      authedFetch(qpro4Site, `/api/bo/promotion/${p.id}`).then(r => r?.data?.rows),
      getDialogPopup(qpro4Site, p.id),
    ]);
    if (!detail) { console.log('SKIP — detail not found'); p2aFail++; continue; }

    const putBody = buildQproPutBody(detail, VIP_CAT_IDS, slotFishIds, popupRow);
    const putRes  = await authedFetch(qpro4Site, `/api/bo/promotion/${p.id}`, { method: 'PUT', body: putBody });

    if (putRes?.success || putRes?.data) { console.log(`✓ gpIds=${slotFishIds.length}  catTO=[3,5]`); p2aOk++; }
    else { console.log(`✗ ${JSON.stringify(putRes).slice(0, 70)}`); p2aFail++; }
  } catch (e) {
    console.log(`ERROR — ${e.message.split('\n')[0].slice(0, 60)}`);
    p2aFail++;
  }
}

console.log(`\n  PART 2a done: ok=${p2aOk}  fail=${p2aFail}\n`);

// ═══════════════════════════════════════════════════════════════════════════════
//  PART 2b — VIP_REL Slots+Fishing on QP2C (ibc22)
// ═══════════════════════════════════════════════════════════════════════════════

console.log('═'.repeat(72));
console.log('  PART 2b — QP2C (ibc22) VIP_REL: set Slots+Fishing providers + catIds=[3,5]\n');

const qp2Site = getSite('ibc22');
let p2bOk = 0, p2bFail = 0;

// QP2 Slots+Fishing provider codes
const slotFishQp2 = filterQp2ProvidersByCat(['SLOTS', 'FISHING']);
const slotFishCodeList = Object.values(slotFishQp2.targetCodes);
console.log(`  QP2C Slots+Fishing providers: ${slotFishCodeList.length} → ${slotFishCodeList.join(',')}\n`);

const QP2_VIP_CAT_IDS_OBJ = { '0': CAT_ID.SLOTS, '1': CAT_ID.FISHING };

// All VIP_REL_100PCT_MIN* and VIP_REL_100PCT_5X_MIN* on QP2C
const vipQp2Listing = await authedFetch(qp2Site, '/api/bo/promotion?perPage=999&page=1');
const vipQp2Rows = Object.values(vipQp2Listing?.data?.rows ?? {});
const vipQp2Targets = vipQp2Rows.filter(p =>
  p.code?.startsWith('VIP_REL_100PCT_MIN') || p.code?.startsWith('VIP_REL_100PCT_5X_MIN')
);
console.log(`  Found ${vipQp2Targets.length} VIP_REL targets on QP2C\n`);

for (const p of vipQp2Targets.sort((a, b) => String(a.code).localeCompare(b.code))) {
  const label = `[${String(p.id).padEnd(5)}] ${p.code.padEnd(35)}`;
  process.stdout.write(`  ${label} → `);

  if (!COMMIT) {
    console.log(`would set providers=${slotFishCodeList.length}  catIds=[3,5]`);
    p2bOk++;
    continue;
  }

  try {
    const [detail, popupRow] = await Promise.all([
      authedFetch(qp2Site, `/api/bo/promotion/${p.id}`).then(r => r?.data?.rows),
      getDialogPopup(qp2Site, p.id),
    ]);
    if (!detail) { console.log('SKIP — detail not found'); p2bFail++; continue; }

    const putBody = buildQp2PutBody(detail, QP2_VIP_CAT_IDS_OBJ, slotFishQp2, popupRow);
    const putRes  = await authedFetch(qp2Site, `/api/bo/promotion/${p.id}`, { method: 'PUT', body: putBody });

    if (putRes?.success || putRes?.data) { console.log(`✓ providers=${slotFishCodeList.length}  catIds=[3,5]`); p2bOk++; }
    else { console.log(`✗ ${JSON.stringify(putRes).slice(0, 70)}`); p2bFail++; }
  } catch (e) {
    console.log(`ERROR — ${e.message.split('\n')[0].slice(0, 60)}`);
    p2bFail++;
  }
}

console.log(`\n  PART 2b done: ok=${p2bOk}  fail=${p2bFail}\n`);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('═'.repeat(72));
const totalOk   = p1Ok + p2aOk + p2bOk;
const totalFail = p1Fail + p2aFail + p2bFail;
console.log(`  Total: ${totalOk} / ${totalOk + totalFail} fixed   ${totalFail} failed`);
if (!COMMIT) console.log('  Run with --commit to apply.\n');
else console.log('  Done.\n');
