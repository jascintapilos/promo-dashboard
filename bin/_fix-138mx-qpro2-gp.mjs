#!/usr/bin/env node
// Fix gp_ids for FT_REL_TLEO_LC_45PCT_138MX on QPRO2 (id=493).
// The initial PUT via buildUpdate() overwrote the 12 LC gp_ids with ~54 full list.
// Re-PUT with the exact source gp_ids from id=442.

import { authedFetch, updatePromotion } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const PROMO_ID = 493;
const SOURCE_GP_IDS = [45, 62, 10, 25, 3, 59, 70, 30, 32, 33, 66, 42]; // from id=442

const site = getSite('qpro2');
const arrayToIntObj = (arr) => Object.fromEntries(arr.map((id, i) => [String(i), id]));
const isoToYmdHms = (iso) => {
  const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : iso;
};

const detRes = await authedFetch(site, `/api/bo/promotion/${PROMO_ID}`);
const det = detRes.data.rows;

const newTarget = {
  '0': {
    type: det.target?.[0]?.type ?? 1,
    multiplier: det.target?.[0]?.multiplier ?? 8,
    game_provider_ids: arrayToIntObj(SOURCE_GP_IDS),
  },
};

const putBody = {
  code: det.code,
  name: det.name,
  free_spin_game_provider_id: det.free_spin_game_provider_id ?? 0,
  promotion_category_turnover: arrayToIntObj((det.promotion_category || []).map(c => c.category_id)),
  promo_type: det.promo_type,
  promo_sub_type: String(det.promo_sub_type),
  valid_from: isoToYmdHms(det.valid_from),
  validity: det.validity,
  reward_validity: det.reward_validity,
  frequency: det.frequency || [],
  frequency_type: String(det.frequency_type ?? '1'),
  first_deposit: det.first_deposit ?? 0,
  last_deposit: det.last_deposit ?? 1,
  auto_approve: det.auto_approve ? 1 : 0,
  visible_by_affiliate: det.visible_by_affiliate ?? 0,
  recurring: String(det.recurring ?? 0),
  reset_frequency: det.reset_frequency ?? 1,
  max_per_player: det.max_per_player,
  daily_max: det.daily_max,
  limit_transfer_in: det.limit_transfer_in ? 1 : 0,
  limit_transfer_out: det.limit_transfer_out ? 1 : 0,
  restrict_claim_round_active: det.restrict_claim_round_active ?? 0,
  restrict_same_provider_launch: det.restrict_same_provider_launch ?? 0,
  auto_unlock: det.auto_unlock ? 1 : 0,
  allow_cancel: det.allow_cancel ?? 0,
  fixed_amount: 0,
  game_provider_ids: arrayToIntObj(SOURCE_GP_IDS),
  target: newTarget,
  deposit_count: 0,
  eligible_types: String(det.eligible_types ?? '1'),
  telemarketer_ids: det.telemarketer_ids || [],
  normal_account_manager_ids: det.normal_account_manager_ids || [],
  vip_account_manager_ids: det.vip_account_manager_ids || [],
  requires_email: det.requires_email ?? false,
  requires_mobile: det.requires_mobile ?? false,
  requires_dob: det.requires_dob ?? false,
  requires_fullname: det.requires_fullname ?? false,
  transfer_unlock: det.transfer_unlock ?? false,
  kyc_basic: det.kyc_basic ?? true,
  kyc_advanced: det.kyc_advanced ?? true,
  kyc_pro: det.kyc_pro ?? true,
  bonus_rate: Number(det.bonus_rate) || 0,
  message_template_id: det.message_template_id,
};

console.log(`Fixing gp_ids for id=${PROMO_ID} on QPRO2...`);
console.log(`  gp_ids before: ${det.target?.[0]?.game_provider_ids?.length}`);
await updatePromotion(site, PROMO_ID, putBody);

// Verify
const ck = await authedFetch(site, `/api/bo/promotion/${PROMO_ID}`);
const gpAfter = ck.data.rows.target?.[0]?.game_provider_ids?.length;
console.log(`  gp_ids after:  ${gpAfter}`);
console.log(`  MT linked:     ${ck.data.rows.message_template_id}`);
console.log(`  blacklist:     ${(ck.data.rows.blacklist_sub_categories||[]).length}`);
console.log(gpAfter === 12 ? '  ✓ FIXED' : `  ✗ UNEXPECTED count ${gpAfter}`);
