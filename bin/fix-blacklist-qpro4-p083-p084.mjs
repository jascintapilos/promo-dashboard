#!/usr/bin/env node
// Retroactively set "Sports and Slots Only" blacklist on QPRO4
// P083 (id=454, WEL_WC26_100PCT_50_25x) and P084 (id=455, WELC_188PCT_25X).
//
// Run this AFTER the "Sports and Slots Only" template has been created manually
// on QPRO4 BO. Script auto-detects the template ID — no hardcoding needed.

import { getSite } from '../src/sites.js';
import { authedFetch } from '../src/api-client.js';

const PROMO_IDS = [454, 455];
const site = getSite('qpro4');

function arrayToIntObj(arr) {
  const out = {};
  arr.forEach((v, i) => { out[String(i)] = v; });
  return out;
}

function b01(v) {
  return v === true ? 1 : v === false ? 0 : v;
}

// Auto-detect "Sports and Slots Only" template on QPRO4
const blRes = await authedFetch(site, '/api/bo/blacklist');
const templates = blRes?.data?.rows || [];
const found = templates.find((t) => {
  const n = (t.name || '').toLowerCase().replace(/\bonly\b/g, '').trim();
  const parts = n.split(/[,+&]|\band\b/).map((s) => s.trim()).filter(Boolean);
  const has = (kw) => parts.some((p) => p.includes(kw));
  return parts.length === 2 && has('sport') && has('slot');
});

if (!found) {
  console.log('⚠ "Sports and Slots Only" template NOT found on QPRO4 yet.');
  console.log('Current templates:');
  for (const t of templates) console.log('  id=' + t.id + '  name=' + t.name);
  console.log('\nCreate the template on QPRO4 BO first, then re-run this script.');
  process.exit(1);
}

const BLACKLIST_ID = found.id;
console.log(`Found template: id=${BLACKLIST_ID} name="${found.name}"\n`);

for (const promoId of PROMO_IDS) {
  console.log(`── Promo ${promoId} ──`);
  const r = await authedFetch(site, `/api/bo/promotion/${promoId}`);
  const p = r?.data?.rows;
  if (!p) { console.log('  ERROR: no data'); continue; }

  console.log(`  code=${p.code}  current blacklist_id=${p.blacklist_id}`);

  const catIds = (p.promotion_category || [])
    .filter((c) => c.target_type === 1)
    .map((c) => c.category_id);

  const body = {
    id: p.id,
    code: p.code,
    name: p.name,
    free_spin_game_provider_id: p.free_spin_game_provider_id || 0,
    promotion_category_turnover: arrayToIntObj(catIds),
    promotion_category_winloss: [],
    promo_type: p.promo_type,
    promo_sub_type: Number(p.promo_sub_type),
    promotion_ids: [],
    valid_from: p.valid_from ? p.valid_from.replace('T', ' ').replace(/\.\d+Z$/, '') : null,
    validity: p.validity,
    reward_validity: p.reward_validity,
    frequency: p.frequency || [],
    frequency_type: Number(p.frequency_type),
    first_deposit: p.first_deposit || 0,
    member_group_ids: [],
    last_deposit: b01(p.last_deposit),
    auto_approve: b01(p.auto_approve),
    visible_by_affiliate: p.visible_by_affiliate || 0,
    recurring: Number(p.recurring),
    max_per_player: p.max_per_player,
    daily_max: p.daily_max,
    status: 1,
    limit_transfer_in: b01(p.limit_transfer_in),
    limit_transfer_out: b01(p.limit_transfer_out),
    restrict_claim_round_active: b01(p.restrict_claim_round_active),
    restrict_same_provider_launch: b01(p.restrict_same_provider_launch),
    bonus_rate: p.bonus_rate != null ? String(Number(p.bonus_rate).toFixed(2)) : undefined,
    auto_unlock: b01(p.auto_unlock),
    allow_cancel: p.allow_cancel || 0,
    game_provider_ids: arrayToIntObj(p.game_provider_ids || []),
    target: p.target,
    message_template_id: p.message_template_id || 0,
    message_template_sms_id: 0,
    eligible_types: Number(p.eligible_types),
    affiliate_group_ids: [],
    telemarketer_ids: [],
    normal_account_manager_ids: [],
    vip_account_manager_ids: [],
    requires_email: p.requires_email || 0,
    requires_mobile: p.requires_mobile || 0,
    requires_dob: p.requires_dob || 0,
    requires_fullname: p.requires_fullname || 0,
    transfer_unlock: b01(p.transfer_unlock),
    kyc_basic: p.kyc_basic,
    kyc_advanced: p.kyc_advanced,
    kyc_pro: p.kyc_pro,
    blacklist_id: BLACKLIST_ID,
    black_list_sub_categories: [],
    // promotion_currency deliberately omitted — PUT wipes non-MYR rows if re-sent
  };

  const res = await authedFetch(site, `/api/bo/promotion/${promoId}`, {
    method: 'PUT',
    body,
  });
  console.log('  PUT result:', JSON.stringify(res?.data || res).slice(0, 200));

  const verify = await authedFetch(site, `/api/bo/promotion/${promoId}`);
  const updated = verify?.data?.rows;
  console.log(`  QC blacklist_id after PUT: ${updated?.blacklist_id} (expected ${BLACKLIST_ID})`,
    updated?.blacklist_id === BLACKLIST_ID ? '✓' : '✗ MISMATCH');
}
