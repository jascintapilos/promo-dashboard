// Re-link QPRO2 promotion id=474 (REL_TLEO_SL_20PCT_10MX) to popup id=158
// (OJFYD) which was its original popup before my bonus_rate fix wiped
// the dialog_popup_list earlier today.

import { authedFetch, updatePromotion } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const commit = process.argv.includes('--commit');
const site = getSite('qpro2');

// Fetch popup 158 metadata via listing
let popup = null;
for (let page = 1; page <= 5; page++) {
  const r = await authedFetch(site, `/api/bo/popups?perPage=100&page=${page}`);
  popup = (r.data.rows || []).find(x => x.id === 158);
  if (popup) break;
}
if (!popup) { console.error('popup 158 not found'); process.exit(1); }
console.log(`popup 158: code=${popup.code} label=${popup.label} start=${popup.start_date}`);

// Fetch promotion 474
const det = await authedFetch(site, '/api/bo/promotion/474');
const row = det.data.rows;
const fmtDate = (iso) => iso ? String(iso).replace(/T/, ' ').replace(/\.\d+Z?$/, '').slice(0, 19) : null;
const catIds = (row.promotion_category || []).map(x => x.category_id);
const body = {
  id: row.id, code: row.code, name: row.name,
  free_spin_game_provider_id: row.free_spin_game_provider_id ?? 0,
  promotion_category_turnover: catIds,
  promotion_category_winloss: [],
  promo_type: row.promo_type,
  promo_sub_type: Number(row.promo_sub_type),
  promotion_ids: [],
  valid_from: fmtDate(row.valid_from),
  valid_to: fmtDate(row.valid_to),
  validity: row.validity,
  reward_validity: row.reward_validity,
  frequency_type: row.frequency_type,
  frequency: row.frequency,
  limit_transfer_out: row.limit_transfer_out,
  limit_transfer_in: row.limit_transfer_in,
  restrict_claim_round_active: row.restrict_claim_round_active,
  restrict_same_provider_launch: row.restrict_same_provider_launch,
  bonus_rate: row.bonus_rate,
  auto_unlock: row.auto_unlock,
  transfer_unlock: row.transfer_unlock,
  allow_cancel: row.allow_cancel,
  last_deposit: row.last_deposit,
  auto_approve: row.auto_approve,
  recurring: Number(row.recurring),
  reset_frequency: row.reset_frequency,
  reset_day: row.reset_day,
  max_per_player: row.max_per_player,
  daily_max: row.daily_max,
  eligible_types: row.eligible_types,
  kyc_basic: row.kyc_basic,
  kyc_advanced: row.kyc_advanced,
  kyc_pro: row.kyc_pro,
  requires_email: row.requires_email,
  requires_mobile: row.requires_mobile,
  requires_dob: row.requires_dob,
  requires_fullname: row.requires_fullname,
  visible_by_affiliate: row.visible_by_affiliate,
  blacklist_id: row.blacklist_id,
  target: row.target,
  member_group_ids: row.member_group_ids || [],
  game_provider_ids: row.game_provider_ids || [],
  message_template_id: row.message_template_id,
  message_template_sms_id: row.message_template_sms_id,
  dialog_popup_list: {
    '0': {
      id: popup.id,
      start_date: fmtDate(popup.start_date),
      end_date: null,
      promotion_id: 474,
      labelKey: popup.label ? `${popup.code} (${String(popup.label).slice(0, 14)} . . . )` : popup.code,
      code: popup.code,
    },
  },
};

console.log(`Mode: ${commit ? 'LIVE (--commit)' : 'DRY-RUN'}`);
console.log(`Planned: PUT /api/bo/promotion/474 with dialog_popup_list[0].id=158 (${popup.code})`);

if (!commit) { console.log('Dry-run only.'); process.exit(0); }

await updatePromotion(site, 474, body);
console.log('✓ Re-linked. Verifying...');
const verify = await authedFetch(site, '/api/bo/promotion?code=REL_TLEO_SL_20PCT_10MX&perPage=5');
const dpl = verify?.data?.rows?.[0]?.dialog_popup_list;
console.log('post-PUT dialog_popup_list:', JSON.stringify(dpl));
