import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('ibc22');
// Patch remaining 3 QP2C promos
for (const promoId of [1294, 1295, 1296]) {
  await patchOne(promoId);
}

async function patchOne(promoId) {
const det = await authedFetch(site, `/api/bo/promotion/${promoId}`).then(r => r?.data?.rows);

function isoToBoDatetime(iso) {
  return (iso || '').replace('T', ' ').replace(/\.\d+Z$/, '');
}
function asObj(arr) {
  const out = {};
  (arr||[]).forEach((v,i) => { out[String(i)] = v; });
  return out;
}

const mgIds = [...(det.member_group_ids||[])].sort((a,b) => a-b);
const t0 = Array.isArray(det.target) ? det.target[0] : {};

const body = {
  id: det.id, code: det.code, name: det.name,
  free_spin_game_provider_id: 0,
  promotion_category_ids: {'0': 1},
  bonus_settings: 1,
  promo_type: Number(det.promo_type),
  promo_sub_type: Number(det.promo_sub_type),
  promotion_ids: [],
  valid_from: isoToBoDatetime(det.valid_from),
  validity: det.validity, reward_validity: det.reward_validity,
  frequency: [], frequency_type: 1,
  member_group_ids: asObj(mgIds),
  members_only: 0, fingerprint_check: 0, freespin_check: 0,
  auto_approve: 1, auto_reward_activation: 1,
  recurring: det.recurring ?? 0, reset_frequency: 1, reset_month: 1,
  max_per_player: det.max_per_player ?? 1, daily_max: det.daily_max ?? 1, status: 1,
  limit_transfer_in: 0, limit_transfer_out: 0, bonus_rate: 0,
  auto_unlock: 1, allow_cancel: 0, withdrawal_unlock: 0,
  game_provider_codes: {'0':18,'1':8,'2':34,'3':353,'4':117,'5':72,'6':312},
  target: {
    type: 1,
    multiplier: Number(t0.multiplier || 0).toFixed(2),
    game_provider_codes: {'0':'CMD','1':'MAX','2':'SBO','3':'SBO2','4':'TF','5':'WBET','6':'2BC'},
  },
  message_template_id: det.message_template_id ?? 0, message_template_sms_id: 0,
  deposit_count: 0, active_period: 0,
  merchant_ids: {'0': 3},
  allow_deposit: 0, allow_continuous_claim: 0, deposit_status: 1, eligible_types: 1,
  affiliate_group_ids: [], telemarketer_ids: [],
  requires_mobile: 0, requires_dob: 0, requires_fullname: 0,
  black_list_sub_categories: [],
  blacklist_template_id: det.blacklist_template_id ?? 2,
  dialog_popup_list: [],
};

console.log('valid_from sent:', body.valid_from);
console.log('promo_type:', body.promo_type, typeof body.promo_type);

try {
  const r = await authedFetch(site, `/api/bo/promotion/${promoId}`, { method: 'PUT', body });
  console.log(`[${promoId}] SUCCESS: ${JSON.stringify(r).slice(0, 100)}`);
} catch(e) {
  console.log(`[${promoId}] ERROR: ${e.message.slice(0, 300)}`);
}
} // end patchOne
