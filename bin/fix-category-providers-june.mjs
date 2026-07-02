#!/usr/bin/env node
// Remediation: fix category + provider config on 48 live BO records from June.
//
// Root cause: mappers set promotion_category_turnover / promotion_category_ids
// correctly but game_provider_ids / game_provider_codes stayed ALL providers —
// making the category restriction cosmetically correct but financially meaningless.
//
// Scope:
//   P128-P129  LIVE CASINO  QPRO1/2/3/4 + QP2A   (10 records)
//   P130-P131  SPORT        QPRO1/2/3/4 + QP2A   (10 records)
//   P132-P133  SLOTS        QPRO1/2/3/4 + QP2A   (10 records)
//   P134-P142  LIVE CASINO  QPRO8 + QP2A          (18 records)
//   Total: 48 records
//
// Usage:
//   node bin/fix-category-providers-june.mjs           # dry run
//   node bin/fix-category-providers-june.mjs --commit  # live PUT

import { authedFetch } from '../src/api-client.js';
import { getSite }     from '../src/sites.js';

const COMMIT = process.argv.includes('--commit');
console.log(`\nJune category/provider remediation — ${COMMIT ? 'LIVE (--commit)' : 'DRY RUN'}\n`);

// ── Generic helpers ────────────────────────────────────────────────────────────

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

async function resolveCategoryGpIds(site, categoryNames) {
  const catSet = new Set(categoryNames.map(n => n.toUpperCase()));
  const res = await authedFetch(site, '/api/bo/gameprovider?perPage=999&page=1');
  const rows = res?.data?.rows || [];
  return rows
    .filter(r => (r.categories || []).some(c => catSet.has(String(c.category || '').toUpperCase())))
    .map(r => r.id);
}

async function getDialogPopup(site, promoId) {
  const r = await authedFetch(site, `/api/bo/promotion?id=${promoId}&perPage=5`);
  const rows = Object.values(r?.data?.rows ?? {});
  return rows.find(p => p.id === promoId)?.dialog_popup_list?.[0] ?? null;
}

// ── QPRO PUT builder ───────────────────────────────────────────────────────────

function buildQproPutBody(detail, catIds, newGpIds, popupRow) {
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
    game_provider_ids: arrayToIntObj(newGpIds),
    target: {
      '0': {
        type:              target0.type       ?? 1,
        multiplier:        target0.multiplier ?? 0,
        game_provider_ids: arrayToIntObj(newGpIds),
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

// ── QP2 provider filter ────────────────────────────────────────────────────────

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
  'SPORT':       ['2BC', '9W', 'CMD', 'MAX', 'SBO', 'SBO2', 'WBET'],
  'LIVE CASINO': ['AG', 'BG', 'EVOK', 'EZ', 'MGP', 'PP', 'PP2', 'PTI', 'SA', 'SEXY', 'VIVO', 'WM'],
  'SLOTS':       ['AP', 'BNG', 'BOOM', 'BTG', 'CQ9', 'FC', 'FP', 'FS', 'HSG', 'JDB', 'JILI', 'JK',
                  'KA', 'LIVE', 'LUCKY', 'MAHA', 'MGP', 'MONKEY', 'NET2', 'NEXT', 'NLC', 'PNG',
                  'PP', 'PP2', 'PTI', 'RG', 'RT2', 'SG', 'SIMPLE', 'XE', 'YB'],
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

// ── QP2 PUT builder ────────────────────────────────────────────────────────────

function buildQp2PutBody(detail, catIdsObj, categoryProviders, popupRow) {
  const mgIds = Array.isArray(detail.member_group_ids) ? detail.member_group_ids : [];
  const mgIdsObj = Object.fromEntries([...mgIds].sort((a, b) => a - b).map((id, i) => [String(i), id]));

  const target0 = Array.isArray(detail.target) ? detail.target[0] : (detail.target?.['0'] ?? {});
  const multiplierStr = Number(target0?.multiplier ?? 0).toFixed(2);

  const merchantIds = Array.isArray(detail.merchant_ids)
    ? Object.fromEntries(detail.merchant_ids.map((m, i) => [String(i), m.id ?? m]))
    : (detail.merchant_ids ?? { '0': 1 });

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

// ── Target records (IDs from QC bundles captured at commit time) ───────────────

const QPRO_TARGETS = [
  // [siteId, promoId, code, categoriesOnly]
  // P128 — LIVE CASINO — QPRO1/2/3/4
  ['qpro1', 788, 'RET_LC_BASE_15PCT',      ['LIVE CASINO']],
  ['qpro2', 515, 'RET_LC_BASE_15PCT',      ['LIVE CASINO']],
  ['qpro3', 538, 'RET_LC_BASE_15PCT',      ['LIVE CASINO']],
  ['qpro4', 467, 'RET_LC_BASE_15PCT',      ['LIVE CASINO']],
  // P129 — LIVE CASINO — QPRO1/2/3/4
  ['qpro1', 789, 'RET_LC_BOOST_18PCT',     ['LIVE CASINO']],
  ['qpro2', 516, 'RET_LC_BOOST_18PCT',     ['LIVE CASINO']],
  ['qpro3', 539, 'RET_LC_BOOST_18PCT',     ['LIVE CASINO']],
  ['qpro4', 468, 'RET_LC_BOOST_18PCT',     ['LIVE CASINO']],
  // P130 — SPORT — QPRO1/2/3/4
  ['qpro1', 790, 'RET_SPORTS_BASE_12PCT',  ['SPORT']],
  ['qpro2', 517, 'RET_SPORTS_BASE_12PCT',  ['SPORT']],
  ['qpro3', 540, 'RET_SPORTS_BASE_12PCT',  ['SPORT']],
  ['qpro4', 469, 'RET_SPORTS_BASE_12PCT',  ['SPORT']],
  // P131 — SPORT — QPRO1/2/3/4
  ['qpro1', 791, 'RET_SPORTS_BOOST_15PCT', ['SPORT']],
  ['qpro2', 518, 'RET_SPORTS_BOOST_15PCT', ['SPORT']],
  ['qpro3', 541, 'RET_SPORTS_BOOST_15PCT', ['SPORT']],
  ['qpro4', 470, 'RET_SPORTS_BOOST_15PCT', ['SPORT']],
  // P132 — SLOTS — QPRO1/2/3/4
  ['qpro1', 812, 'REL_BASE_12PCT_5X',      ['SLOTS']],
  ['qpro2', 519, 'REL_BASE_12PCT_5X',      ['SLOTS']],
  ['qpro3', 542, 'REL_BASE_12PCT_5X',      ['SLOTS']],
  ['qpro4', 471, 'REL_BASE_12PCT_5X',      ['SLOTS']],
  // P133 — SLOTS — QPRO1/2/3/4
  ['qpro1', 813, 'REL_BOOSTER_15PCT_5X',   ['SLOTS']],
  ['qpro2', 520, 'REL_BOOSTER_15PCT_5X',   ['SLOTS']],
  ['qpro3', 543, 'REL_BOOSTER_15PCT_5X',   ['SLOTS']],
  ['qpro4', 472, 'REL_BOOSTER_15PCT_5X',   ['SLOTS']],
  // P134–P142 — LIVE CASINO — QPRO8
  ['qpro8', 525, 'FT_REL_30PCT_18X_MIN500', ['LIVE CASINO']],
  ['qpro8', 526, 'FT_REL_50PCT_18X_MIN500', ['LIVE CASINO']],
  ['qpro8', 527, 'FT_REL_70PCT_18X_MIN500', ['LIVE CASINO']],
  ['qpro8', 528, 'FT_REL_30PCT_18X_MIN300', ['LIVE CASINO']],
  ['qpro8', 529, 'FT_REL_50PCT_18X_MIN300', ['LIVE CASINO']],
  ['qpro8', 530, 'FT_REL_70PCT_18X_MIN300', ['LIVE CASINO']],
  ['qpro8', 531, 'FT_REL_30PCT_18X_MIN100', ['LIVE CASINO']],
  ['qpro8', 532, 'FT_REL_50PCT_18X_MIN100', ['LIVE CASINO']],
  ['qpro8', 533, 'FT_REL_70PCT_18X_MIN100', ['LIVE CASINO']],
];

const QP2_TARGETS = [
  // [promoId, code, categoriesOnly]
  // P128 — LIVE CASINO — QP2A
  [860,  'RET_LC_BASE_15PCT',      ['LIVE CASINO']],
  // P129 — LIVE CASINO — QP2A
  [861,  'RET_LC_BOOST_18PCT',     ['LIVE CASINO']],
  // P130 — SPORT — QP2A
  [859,  'RET_SPORTS_BASE_12PCT',  ['SPORT']],
  // P131 — SPORT — QP2A
  [862,  'RET_SPORTS_BOOST_15PCT', ['SPORT']],
  // P132 — SLOTS — QP2A
  [898,  'REL_BASE_12PCT_5X',      ['SLOTS']],
  // P133 — SLOTS — QP2A
  [899,  'REL_BOOSTER_15PCT_5X',   ['SLOTS']],
  // P134–P142 — LIVE CASINO — QP2A
  [1273, 'FT_REL_30PCT_18X_MIN500', ['LIVE CASINO']],
  [1274, 'FT_REL_50PCT_18X_MIN500', ['LIVE CASINO']],
  [1275, 'FT_REL_70PCT_18X_MIN500', ['LIVE CASINO']],
  [1276, 'FT_REL_30PCT_18X_MIN300', ['LIVE CASINO']],
  [1277, 'FT_REL_50PCT_18X_MIN300', ['LIVE CASINO']],
  [1278, 'FT_REL_70PCT_18X_MIN300', ['LIVE CASINO']],
  [1279, 'FT_REL_30PCT_18X_MIN100', ['LIVE CASINO']],
  [1280, 'FT_REL_50PCT_18X_MIN100', ['LIVE CASINO']],
  [1281, 'FT_REL_70PCT_18X_MIN100', ['LIVE CASINO']],
];

// ── Run QPRO ──────────────────────────────────────────────────────────────────

console.log('═'.repeat(72));
console.log('  QPRO — fix promotion_category_turnover + game_provider_ids\n');

let qproOk = 0, qproFail = 0;

// Per-site caches to avoid redundant API calls
const catIdCache  = {};  // siteId → categoryName → catId
const gpIdsCache  = {};  // siteId → categoryKey → gpIds[]

for (const [siteId, promoId, code, categoriesOnly] of QPRO_TARGETS) {
  const site = getSite(siteId);
  const catKey = categoriesOnly.join('+');
  const label = `${siteId.padEnd(7)} [${String(promoId).padEnd(5)}] ${code.padEnd(28)} [${catKey}]`;
  process.stdout.write(`  ${label} → `);

  try {
    // Resolve category IDs (cached per site)
    if (!catIdCache[siteId]) catIdCache[siteId] = {};
    const resolvedCatIds = [];
    for (const catName of categoriesOnly) {
      if (catIdCache[siteId][catName] == null) {
        catIdCache[siteId][catName] = await resolveCatId(site, catName);
      }
      if (catIdCache[siteId][catName]) resolvedCatIds.push(catIdCache[siteId][catName]);
    }
    if (!resolvedCatIds.length) {
      console.log(`SKIP — category not found on ${siteId}`);
      qproFail++;
      continue;
    }

    // Resolve provider IDs by category (cached per site+category)
    if (!gpIdsCache[siteId]) gpIdsCache[siteId] = {};
    if (!gpIdsCache[siteId][catKey]) {
      gpIdsCache[siteId][catKey] = await resolveCategoryGpIds(site, categoriesOnly);
    }
    const newGpIds = gpIdsCache[siteId][catKey];
    if (!newGpIds?.length) {
      console.log(`SKIP — no providers matched category ${catKey} on ${siteId}`);
      qproFail++;
      continue;
    }

    if (!COMMIT) {
      console.log(`would set catTO=${JSON.stringify(resolvedCatIds)}  gpIds=${newGpIds.length} providers (was all)`);
      qproOk++;
      continue;
    }

    const [detailRes, popupRow] = await Promise.all([
      authedFetch(site, `/api/bo/promotion/${promoId}`).then(r => r?.data?.rows),
      getDialogPopup(site, promoId),
    ]);
    if (!detailRes) { console.log('SKIP — detail not found'); qproFail++; continue; }

    const putBody = buildQproPutBody(detailRes, resolvedCatIds, newGpIds, popupRow);
    const putRes  = await authedFetch(site, `/api/bo/promotion/${promoId}`, { method: 'PUT', body: putBody });

    if (putRes?.success || putRes?.data) { console.log(`✓ saved  catTO=${JSON.stringify(resolvedCatIds)}  gpIds=${newGpIds.length}`); qproOk++; }
    else { console.log(`✗ ${JSON.stringify(putRes).slice(0, 80)}`); qproFail++; }

  } catch (e) {
    console.log(`ERROR — ${e.message.split('\n')[0].slice(0, 70)}`);
    qproFail++;
  }
}

console.log(`\n  QPRO done: ok=${qproOk}  fail=${qproFail}\n`);

// ── Run QP2A ──────────────────────────────────────────────────────────────────

console.log('═'.repeat(72));
console.log('  QP2A (ibc22) — fix promotion_category_ids + game_provider_codes\n');

let qp2Ok = 0, qp2Fail = 0;
const qp2Site = getSite('ibc22');

// Resolve QP2A category IDs per category (cached)
const qp2CatIdCache = {};

async function resolveQp2CatIds(categoryNames) {
  const key = categoryNames.join('+');
  if (qp2CatIdCache[key]) return qp2CatIdCache[key];
  const r = await authedFetch(qp2Site, '/api/bo/categories?perPage=500');
  const rows = Object.values(r?.data?.rows ?? {});
  const catSet = new Set(categoryNames.map(n => n.toUpperCase()));
  const ids = rows
    .filter(c => catSet.has(String(c.name || '').toUpperCase()))
    .map(c => c.id);
  qp2CatIdCache[key] = ids;
  return ids;
}

for (const [promoId, code, categoriesOnly] of QP2_TARGETS) {
  const catKey = categoriesOnly.join('+');
  const label = `ibc22   [${String(promoId).padEnd(5)}] ${code.padEnd(28)} [${catKey}]`;
  process.stdout.write(`  ${label} → `);

  try {
    const catIds = await resolveQp2CatIds(categoriesOnly);
    if (!catIds.length) {
      console.log(`SKIP — category not found on QP2A`);
      qp2Fail++;
      continue;
    }
    const catIdsObj = arrayToIntObj(catIds);
    const categoryProviders = filterQp2ProvidersByCat(categoriesOnly);

    if (!COMMIT) {
      const codes = Object.values(categoryProviders.targetCodes);
      console.log(`would set catIds=${JSON.stringify(catIds)}  providers=${codes.length} (${codes.join(',')})`);
      qp2Ok++;
      continue;
    }

    const [detailRes, popupRow] = await Promise.all([
      authedFetch(qp2Site, `/api/bo/promotion/${promoId}`).then(r => r?.data?.rows),
      getDialogPopup(qp2Site, promoId),
    ]);
    if (!detailRes) { console.log('SKIP — detail not found'); qp2Fail++; continue; }

    const putBody = buildQp2PutBody(detailRes, catIdsObj, categoryProviders, popupRow);
    const putRes  = await authedFetch(qp2Site, `/api/bo/promotion/${promoId}`, { method: 'PUT', body: putBody });

    if (putRes?.success || putRes?.data) {
      const codes = Object.values(categoryProviders.targetCodes);
      console.log(`✓ saved  catIds=${JSON.stringify(catIds)}  providers=${codes.length}`);
      qp2Ok++;
    } else {
      console.log(`✗ ${JSON.stringify(putRes).slice(0, 80)}`);
      qp2Fail++;
    }

  } catch (e) {
    console.log(`ERROR — ${e.message.split('\n')[0].slice(0, 70)}`);
    qp2Fail++;
  }
}

console.log(`\n  QP2A done: ok=${qp2Ok}  fail=${qp2Fail}\n`);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('═'.repeat(72));
const totalOk   = qproOk   + qp2Ok;
const totalFail = qproFail + qp2Fail;
console.log(`  Total: ${totalOk} / ${totalOk + totalFail} saved   ${totalFail} failed`);
if (!COMMIT) console.log('  Run with --commit to apply.\n');
else console.log('  Done.\n');
