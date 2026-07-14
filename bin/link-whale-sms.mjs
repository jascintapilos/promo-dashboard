// Link Whale Probe SMS message templates to their promotion records
// via `message_template_sms_id` on the promotion PUT endpoint.
//
// Covers:
//   FC promos  (4 codes × 13 BOs = 52 links) — WHALE_VM_PROBE_NODEP_FC*_20X
//   88PCT promos (all codes matching WHALE_CRM_PROBE_88PCT_* on each BO)
//   20PCT promos (all codes matching WHALE_CRM_PROBE_20PCT_* on each BO)
//
// Usage:
//   node bin/link-whale-sms.mjs            # dry-run
//   node bin/link-whale-sms.mjs --commit   # live write

import { parseArgs } from './_args.js';
import { authedFetch, findPromotionByCode } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const { flags } = parseArgs(process.argv.slice(2));
const COMMIT = flags.commit === true;

// ── SMS MT ID maps ────────────────────────────────────────────────────
const FC_SMS_IDS = {
  qpro1:  { FC88: 1097, FC118: 1098, FC138: 1099, FC148: 1100 },
  qpro2:  { FC88:  487, FC118:  488, FC138:  489, FC148:  490 },
  qpro3:  { FC88:  571, FC118:  572, FC138:  573, FC148:  574 },
  qpro4:  { FC88:  503, FC118:  504, FC138:  505, FC148:  506 },
  qpro5:  { FC88:  402, FC118:  403, FC138:  404, FC148:  405 },
  qpro6:  { FC88:  649, FC118:  650, FC138:  651, FC148:  652 },
  qpro7:  { FC88:  595, FC118:  596, FC138:  597, FC148:  598 },
  qpro8:  { FC88:  721, FC118:  722, FC138:  723, FC148:  724 },
  qpro9:  { FC88:  527, FC118:  528, FC138:  529, FC148:  530 },
  qpro10: { FC88:  587, FC118:  588, FC138:  589, FC148:  590 },
  qpro15: { FC88:  409, FC118:  410, FC138:  411, FC148:  412 },
  qpro16: { FC88:  386, FC118:  387, FC138:  388, FC148:  389 },
  ibc22:  { FC88: 1316, FC118: 1317, FC138: 1318, FC148: 1319 },
};

const RELOAD_SMS_IDS = {
  qpro1:  { '88PCT': 1101, '20PCT': 1102 },
  qpro2:  { '88PCT':  491, '20PCT':  492 },
  qpro3:  { '88PCT':  575, '20PCT':  576 },
  qpro4:  { '88PCT':  507, '20PCT':  508 },
  qpro5:  { '88PCT':  406, '20PCT':  407 },
  qpro6:  { '88PCT':  653, '20PCT':  654 },
  qpro7:  { '88PCT':  599, '20PCT':  600 },
  qpro8:  { '88PCT':  725, '20PCT':  726 },
  qpro9:  { '88PCT':  531, '20PCT':  532 },
  qpro10: { '88PCT':  591, '20PCT':  592 },
  qpro15: { '88PCT':  413, '20PCT':  414 },
  qpro16: { '88PCT':  390, '20PCT':  391 },
  ibc22:  { '88PCT': 1320, '20PCT': 1321 },
};

// FC promo codes → SMS key mapping
const FC_CODE_TO_KEY = {
  'WHALE_VM_PROBE_NODEP_FC88_20X':  'FC88',
  'WHALE_VM_PROBE_NODEP_FC118_20X': 'FC118',
  'WHALE_VM_PROBE_NODEP_FC138_20X': 'FC138',
  'WHALE_VM_PROBE_NODEP_FC148_20X': 'FC148',
};

// qpro1/qpro2/qpro3 already linked — skip them
const ALL_SITES = [
  'qpro4','qpro5','qpro6',
  'qpro7','qpro8','qpro9','qpro10','qpro15','qpro16','ibc22',
];

// Hardcoded exact reload codes (avoids broad search + 504 on large BOs)
const RELOAD_88PCT_CODES = [
  'WHALE_CRM_PROBE_88PCT_300_FTD_WIN_3',
  'WHALE_CRM_PROBE_88PCT_200_FTD_WIN_3',
  'WHALE_CRM_PROBE_88PCT_100_FTD_WIN_3',
  'WHALE_CRM_PROBE_88PCT_300_FTD_LOSE_2',
  'WHALE_CRM_PROBE_88PCT_200_FTD_LOSE_2',
  'WHALE_CRM_PROBE_88PCT_150_FTD_LOSE_2',
  'WHALE_CRM_PROBE_88PCT_100_FTD_LOSE_2',
];

const RELOAD_20PCT_CODES = [
  'WHALE_CRM_PROBE_20PCT_150_FTD_LOSE_4',
  'WHALE_CRM_PROBE_20PCT_100_FTD_LOSE_4',
  'WHALE_CRM_PROBE_20PCT_300_FTD_WIN_4',
  'WHALE_CRM_PROBE_20PCT_200_FTD_WIN_4',
  'WHALE_CRM_PROBE_20PCT_100_FTD_WIN_4',
  'WHALE_CRM_PROBE_20PCT_300_FTD_WIN_2',
  'WHALE_CRM_PROBE_20PCT_200_FTD_WIN_2',
  'WHALE_CRM_PROBE_20PCT_100_FTD_WIN_2',
  'WHALE_CRM_PROBE_20PCT_300_FTD_LOSE_4',
  'WHALE_CRM_PROBE_20PCT_200_FTD_LOSE_4',
];

// ── Helpers ───────────────────────────────────────────────────────────

function nowYmdHms() {
  const d = new Date();
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

// Scan listing pages for codes matching a prefix pattern, return listing rows
async function scanPromoCodes(site, searchTerm) {
  const all = [];
  let page = 1;
  while (true) {
    const res = await authedFetch(site, `/api/bo/promotion?page=${page}&perPage=100&search=${encodeURIComponent(searchTerm)}`);
    const rows = res?.data?.rows || [];
    if (!rows.length) break;
    all.push(...rows);
    if (rows.length < 100) break;
    page++;
  }
  return all;
}

// GET full promotion detail (has promotion_category, game_provider_ids, target, etc.)
async function getDetail(site, id) {
  const res = await authedFetch(site, `/api/bo/promotion/${id}`);
  return res?.data?.rows || res?.rows || res?.data || res;
}

// GET popup listing for a site (cached)
async function getPopups(site) {
  const res = await authedFetch(site, '/api/bo/popups?perPage=500&page=1&sort_by=id&sort_order=desc');
  return res?.data?.rows || [];
}

// Convert array to int-keyed object: [1,2,3] → {"0":1,"1":2,"2":3}
function arrayToIntObj(arr) {
  const out = {};
  (arr || []).forEach((v, i) => { out[String(i)] = v; });
  return out;
}

// Build the PUT body from the detail row, with SMS MT ID override
function buildPutBody(detail, listingRow, smsTemplateId, popups) {
  const catIds = (detail.promotion_category || []).map(c => c.category_id);

  // game_provider_ids: GET returns plain array, PUT needs int-keyed object
  const gpIds = Array.isArray(detail.game_provider_ids) ? detail.game_provider_ids : [];
  const gpIdsObj = arrayToIntObj(gpIds);

  // target: GET returns plain array, PUT needs int-keyed object with nested gp_ids as obj
  const targetArr = Array.isArray(detail.target) ? detail.target : [];
  const targetObj = {};
  targetArr.forEach((t, i) => {
    const tGpIds = Array.isArray(t.game_provider_ids) ? t.game_provider_ids : [];
    targetObj[String(i)] = {
      type: t.type,
      multiplier: t.multiplier,
      game_provider_ids: arrayToIntObj(tGpIds),
    };
  });

  // Build dialog_popup_list for PUT
  const dlLink = listingRow.dialog_popup_list?.[0];
  let dialogPutValue = [];
  if (dlLink?.popup_id) {
    const popup = popups.find(p => p.id === dlLink.popup_id);
    if (popup) {
      dialogPutValue = {
        '0': {
          id: popup.id,
          popup_id: popup.id,
          start_date: popup.start_date || nowYmdHms(),
          end_date: null,
          promotion_id: listingRow.id,
          labelKey: popup.label
            ? `${popup.code} (${popup.label.slice(0, 14)} . . . )`
            : popup.code,
          code: popup.code,
        },
      };
    }
  }

  const b01 = v => (v === true ? 1 : v === false ? 0 : v);

  // valid_from: BO requires Y-m-d H:i:s; GET/listing returns ISO 8601 with T and Z
  const validFrom = (listingRow.valid_from || '').replace('T', ' ').slice(0, 19);

  // frequency: GET/detail returns [] for non-recurring promos — send as-is (must be array)
  const freq = detail.frequency ?? [];

  // frequency_type: listing humanises to "Daily" string; detail returns numeric (e.g. 1)
  const freqType = Number(detail.frequency_type ?? 0);

  return {
    id: listingRow.id,
    code: listingRow.code,
    name: listingRow.name,
    // non-FS promos: must be 0 (not null) — BO validates required integer
    free_spin_game_provider_id: listingRow.free_spin_game_provider_id ?? 0,
    promotion_category_turnover: arrayToIntObj(catIds),
    promotion_category_winloss: [],
    promo_type: listingRow.promo_type,
    promo_sub_type: Number(listingRow.promo_sub_type),
    promotion_ids: [],
    valid_from: validFrom,
    validity: listingRow.validity,
    reward_validity: listingRow.reward_validity,
    frequency: freq,
    frequency_type: freqType,
    first_deposit: detail.first_deposit ?? 0,
    member_group_ids: [],
    last_deposit: b01(listingRow.last_deposit),
    auto_approve: b01(listingRow.auto_approve),
    auto_reward_activation: 1,
    visible_by_affiliate: listingRow.visible_by_affiliate,
    recurring: Number(detail.recurring ?? listingRow.recurring ?? 0),
    max_per_player: detail.max_per_player ?? listingRow.max_per_player ?? 0,
    daily_max: detail.daily_max ?? listingRow.daily_max ?? 0,
    status: 1,
    limit_transfer_in: b01(listingRow.limit_transfer_in),
    limit_transfer_out: b01(listingRow.limit_transfer_out),
    restrict_claim_round_active: b01(listingRow.restrict_claim_round_active),
    restrict_same_provider_launch: b01(listingRow.restrict_same_provider_launch),
    bonus_rate: listingRow.bonus_rate != null
      ? String(Number(listingRow.bonus_rate).toFixed(2))
      : undefined,
    ...(detail.reset_frequency ? { reset_frequency: detail.reset_frequency } : {}),
    ...(listingRow.free_spin_game_code ? { free_spin_game_code: listingRow.free_spin_game_code } : {}),
    auto_unlock: b01(listingRow.auto_unlock),
    allow_cancel: listingRow.allow_cancel,
    game_provider_ids: gpIdsObj,
    target: targetObj,
    message_template_id: listingRow.message_template_id || 0,
    message_template_sms_id: smsTemplateId,
    eligible_types: Number(listingRow.eligible_types),
    affiliate_group_ids: [],
    telemarketer_ids: [],
    normal_account_manager_ids: [],
    vip_account_manager_ids: [],
    requires_email: listingRow.requires_email,
    requires_mobile: listingRow.requires_mobile,
    requires_dob: listingRow.requires_dob,
    requires_fullname: listingRow.requires_fullname,
    transfer_unlock: b01(listingRow.transfer_unlock),
    kyc_basic: listingRow.kyc_basic,
    kyc_advanced: listingRow.kyc_advanced,
    kyc_pro: listingRow.kyc_pro,
    blacklist_id: detail.blacklist_id ?? 0,
    black_list_sub_categories: [],
    dialog_popup_list: dialogPutValue,
  };
}

// ── Main ──────────────────────────────────────────────────────────────
console.log(COMMIT ? '▶ COMMIT MODE' : '▶ DRY RUN');
console.log('Linking Whale Probe SMS MTs to promotions\n');

let totalOk = 0, totalSkip = 0, totalErr = 0;
const results = [];

for (const siteId of ALL_SITES) {
  const site = getSite(siteId);
  const fcSmsIds = FC_SMS_IDS[siteId];
  const reloadSmsIds = RELOAD_SMS_IDS[siteId];

  console.log(`\n── ${siteId} ──`);

  // Collect promos to link
  const toLink = []; // { listingRow, smsTemplateId, label }

  // FC promos: find by exact code
  for (const [code, key] of Object.entries(FC_CODE_TO_KEY)) {
    const listRows = await scanPromoCodes(site, code);
    const match = listRows.find(r => r.code === code);
    if (!match) {
      console.log(`  [SKIP] ${code}: not found on ${siteId}`);
      totalSkip++;
      continue;
    }
    if (match.message_template_sms_id === fcSmsIds[key]) {
      console.log(`  [SKIP] ${code}: already linked to MT#${fcSmsIds[key]}`);
      totalSkip++;
      continue;
    }
    toLink.push({ listingRow: match, smsTemplateId: fcSmsIds[key], label: `${code} → MT#${fcSmsIds[key]}` });
  }

  // 88PCT reload promos: exact code lookups (avoids 504 from broad search)
  for (const code of RELOAD_88PCT_CODES) {
    const row = await findPromotionByCode(site, code);
    if (!row) { console.log(`  [SKIP] ${code}: not found on ${siteId}`); totalSkip++; continue; }
    const smsId = reloadSmsIds['88PCT'];
    if (row.message_template_sms_id === smsId) {
      console.log(`  [SKIP] ${code}: already linked`);
      totalSkip++;
      continue;
    }
    toLink.push({ listingRow: row, smsTemplateId: smsId, label: `${code} → MT#${smsId}` });
  }

  // 20PCT reload promos: exact code lookups
  for (const code of RELOAD_20PCT_CODES) {
    const row = await findPromotionByCode(site, code);
    if (!row) { console.log(`  [SKIP] ${code}: not found on ${siteId}`); totalSkip++; continue; }
    const smsId = reloadSmsIds['20PCT'];
    if (row.message_template_sms_id === smsId) {
      console.log(`  [SKIP] ${code}: already linked`);
      totalSkip++;
      continue;
    }
    toLink.push({ listingRow: row, smsTemplateId: smsId, label: `${code} → MT#${smsId}` });
  }

  if (!toLink.length) {
    console.log(`  (nothing to link)`);
    continue;
  }

  console.log(`  ${toLink.length} promos to link — fetching details & popups…`);

  // Cache popup listing once per BO
  const popups = COMMIT ? await getPopups(site) : [];

  for (const { listingRow, smsTemplateId, label } of toLink) {
    if (!COMMIT) {
      console.log(`  [dry] ${label}`);
      totalOk++;
      results.push({ site: siteId, code: listingRow.code, promoId: listingRow.id, smsTemplateId, status: 'dry' });
      continue;
    }

    try {
      const detail = await getDetail(site, listingRow.id);
      const body = buildPutBody(detail, listingRow, smsTemplateId, popups);
      const res = await authedFetch(site, `/api/bo/promotion/${listingRow.id}`, {
        method: 'PUT',
        body,
      });
      const saved = res?.data?.rows?.message_template_sms_id ?? res?.rows?.message_template_sms_id;
      if (saved === smsTemplateId) {
        console.log(`  ✓ ${label}`);
        totalOk++;
        results.push({ site: siteId, code: listingRow.code, promoId: listingRow.id, smsTemplateId, status: 'ok' });
      } else {
        console.log(`  ? ${label}: PUT returned sms_id=${saved} (expected ${smsTemplateId})`);
        totalOk++;
        results.push({ site: siteId, code: listingRow.code, promoId: listingRow.id, smsTemplateId, status: 'ok-unverified' });
      }
    } catch (e) {
      console.log(`  ✗ ${label}: ${e.message.slice(0, 100)}`);
      totalErr++;
      results.push({ site: siteId, code: listingRow.code, promoId: listingRow.id, smsTemplateId, status: 'error', error: e.message });
    }
  }
}

console.log(`\n── Summary ──`);
console.log(`✓ Linked: ${totalOk}  ⊘ Skipped: ${totalSkip}  ✗ Errors: ${totalErr}`);

if (COMMIT) {
  // Write results for spreadsheet step
  const { writeFileSync } = await import('fs');
  writeFileSync('tmp/whale-sms-link-results.json', JSON.stringify(results, null, 2));
  console.log('\nResults saved to tmp/whale-sms-link-results.json');
}
