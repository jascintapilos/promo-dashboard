// One-off: deactivate the orphaned QP2C/ibc22 promotion id=1188 that was
// saved with the unintended bare code "REL_30PCT_8X" (auto-namer slip).
// Reuses the proven QP2 PUT shape from bin/deactivate-test-promos.mjs.
import { authedFetch, updatePromotion } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

function toYmdHis(isoStr) {
  if (!isoStr) return null;
  return String(isoStr).replace('T', ' ').replace(/\.\d+Z?$/, '');
}

function buildQp2DeactivateBody(det, newStatus = 0) {
  const rawMerchants = Array.isArray(det.merchant_ids)
    ? det.merchant_ids.map((m) => (typeof m === 'object' ? m.id : m))
    : [];
  const merchantIdsObj = {};
  rawMerchants.forEach((id, i) => { merchantIdsObj[String(i)] = id; });

  const targetArr = Array.isArray(det.target) ? det.target : (det.target ? [det.target] : []);
  const targetObj = targetArr[0] || { type: 1, multiplier: '1.00', game_provider_codes: [] };

  const dlArr = Array.isArray(det.dialog_popup_list) ? det.dialog_popup_list : [];
  const dlObj = {};
  dlArr.forEach((d, i) => { dlObj[String(i)] = d; });

  return {
    id:                       det.id,
    code:                     det.code,
    name:                     det.name,
    bonus_settings:           det.bonus_settings ?? 1,
    promo_type:               det.promo_type,
    promo_sub_type:           det.promo_sub_type,
    promotion_ids:            [],
    valid_from:               toYmdHis(det.valid_from),
    valid_to:                 toYmdHis(det.valid_to),
    validity:                 det.validity ?? 1,
    reward_validity:          det.reward_validity ?? 1,
    frequency_type:           det.frequency_type ?? 1,
    frequency:                det.frequency ?? [],
    limit_transfer_out:       det.limit_transfer_out ?? 0,
    limit_transfer_in:        det.limit_transfer_in ?? 0,
    auto_unlock:              det.auto_unlock ?? 1,
    allow_cancel:             det.allow_cancel ?? 0,
    withdrawal_unlock:        det.withdrawal_unlock ?? 0,
    auto_approve:             det.auto_approve ?? 1,
    auto_reward_activation:   det.auto_reward_activation ?? 0,
    recurring:                det.recurring ?? 0,
    reset_frequency:          det.reset_frequency || 1,
    reset_month:              det.reset_month || 1,
    max_per_player:           det.max_per_player ?? 1,
    daily_max:                det.daily_max ?? 1,
    members_only:             det.members_only ?? 0,
    fingerprint_check:        det.fingerprint_check ?? 0,
    freespin_check:           det.freespin_check ?? 0,
    allow_deposit:            det.allow_deposit ?? 0,
    allow_continuous_claim:   det.allow_continuous_claim ?? 0,
    message_template_id:      det.message_template_id ?? 0,
    message_template_sms_id:  det.message_template_sms_id ?? 0,
    bonus_rate:               det.bonus_rate ?? 0,
    deposit_count:            det.deposit_count ?? 0,
    active_period:            det.active_period ?? 0,
    eligible_types:           det.eligible_types ?? 1,
    deposit_status:           det.last_deposit ? 4 : 1,
    free_spin_game_provider_id: det.free_spin_game_provider_id ?? 0,
    ...(det.free_spin_game_code != null ? { free_spin_game_code: det.free_spin_game_code } : {}),
    blacklist_template_id:    det.blacklist_template_id,
    promotion_category_ids:   det.promotion_category_ids ?? [],
    game_provider_codes:      det.game_provider_codes ?? [],
    target:                   targetObj,
    member_group_ids:         det.member_group_ids ?? [],
    affiliate_group_ids:      det.affiliate_group_ids ?? [],
    affiliate_ids:            det.affiliate_ids ?? [],
    telemarketer_ids:         det.telemarketer_ids ?? [],
    requires_email:           det.requires_email ?? 0,
    requires_mobile:          det.requires_mobile ?? 0,
    requires_dob:             det.requires_dob ?? 0,
    requires_fullname:        det.requires_fullname ?? 0,
    kyc_listing:              det.kyc_listing ?? 0,
    black_list_sub_categories: [],
    promotion_currency: { '0': { currency_id: 1, bonus_type: 1, max_total_applications: 0, max_total_bonus: 0, max_withdraw: 0, min_deposit: 0, bonus_value: 0, min_transfer_out: 0 } },
    merchant_ids:             merchantIdsObj,
    dialog_popup_list:        dlObj,
    status:                   newStatus,
  };
}

const site = getSite('ibc22');
const id = 1188;
const det = (await authedFetch(site, `/api/bo/promotion/${id}`)).data.rows;
console.log(`Before: id=${id} code=${det.code} status=${det.status}`);
const body = buildQp2DeactivateBody(det, 0);
await updatePromotion(site, id, body);
console.log('✓ id=1188 set status=0 (inactive)');
