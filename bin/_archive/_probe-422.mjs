import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
const site = getSite('qpro1');
const arrToObj = a => { const o = {}; (a || []).forEach((v, i) => { o[String(i)] = v; }); return o; };
const fmtDate = d => d ? String(d).replace('T', ' ').replace(/\.\d+Z?$/, '') : d;
const b01 = v => (v === true ? 1 : v === false ? 0 : v);
const p = await authedFetch(site, '/api/bo/promotion/899').then(r => r.data?.rows);
const gp = (p.game_provider_ids || []).filter(x => x !== 21); if (!gp.includes(96)) gp.push(96);
const catTov = arrToObj((p.promotion_category || []).filter(c => c.target_type === 1).map(c => c.category_id));
const targetObj = {};
(p.target || []).forEach((t, i) => { targetObj[String(i)] = { type: t.type, multiplier: t.multiplier, game_provider_ids: arrToObj((t.game_provider_ids || []).filter(x => x !== 21).concat((t.game_provider_ids || []).includes(21) && !(t.game_provider_ids || []).includes(96) ? [96] : [])) }; });
console.log('promotion_ids on detail:', JSON.stringify(p.promotion_ids));
const body = {
  id: p.id, code: p.code, name: p.name,
  free_spin_game_provider_id: p.free_spin_game_provider_id ?? 0,
  ...(p.free_spin_game_code ? { free_spin_game_code: p.free_spin_game_code } : {}),
  promotion_category_turnover: catTov, promotion_category_winloss: [],
  promo_type: p.promo_type, promo_sub_type: Number(p.promo_sub_type),
  promotion_ids: [],
  valid_from: fmtDate(p.valid_from), validity: p.validity, reward_validity: p.reward_validity,
  frequency: p.frequency ?? [], frequency_type: Number(p.frequency_type),
  first_deposit: p.first_deposit ?? 0, member_group_ids: [],
  last_deposit: b01(p.last_deposit ?? 0), auto_approve: b01(p.auto_approve),
  visible_by_affiliate: p.visible_by_affiliate ?? 0, recurring: Number(p.recurring),
  max_per_player: p.max_per_player, daily_max: p.daily_max, status: p.status ?? 1,
  limit_transfer_in: b01(p.limit_transfer_in ?? 0), limit_transfer_out: b01(p.limit_transfer_out ?? 0),
  restrict_claim_round_active: b01(p.restrict_claim_round_active ?? 0),
  restrict_same_provider_launch: b01(p.restrict_same_provider_launch ?? 0),
  bonus_rate: p.bonus_rate != null ? String(Number(p.bonus_rate).toFixed(2)) : undefined,
  ...(p.reset_frequency ? { reset_frequency: p.reset_frequency } : {}),
  auto_unlock: b01(p.auto_unlock), allow_cancel: p.allow_cancel,
  game_provider_ids: arrToObj(gp), target: targetObj,
  message_template_id: p.message_template_id ?? 0, message_template_sms_id: p.message_template_sms_id ?? 0,
  eligible_types: Number(p.eligible_types),
  affiliate_group_ids: [], telemarketer_ids: [], normal_account_manager_ids: [], vip_account_manager_ids: [],
  requires_email: p.requires_email ?? 0, requires_mobile: p.requires_mobile ?? 0, requires_dob: p.requires_dob ?? 0, requires_fullname: p.requires_fullname ?? 0,
  transfer_unlock: b01(p.transfer_unlock ?? 0),
  kyc_basic: p.kyc_basic ?? 1, kyc_advanced: p.kyc_advanced ?? 1, kyc_pro: p.kyc_pro ?? 1,
  blacklist_id: p.blacklist_id, black_list_sub_categories: [],
  currencies_ids: p.currencies_ids ?? [],
  dialog_popup_list: [],
};
try { await authedFetch(site, '/api/bo/promotion/899', { method: 'PUT', body }); console.log('PUT OK'); }
catch (e) { console.log('FULL ERROR:\n' + e.message); }
