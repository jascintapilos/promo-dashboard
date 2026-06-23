#!/usr/bin/env node
// Create FT_REL_TLEO_LC_45PCT_48MX on QPRO2.
// Source: QPRO3 id=476 (same code, Bronze LC tier)
// GP IDs: 12 LC providers from QPRO2 id=452 (FT_REL_TLEO_LC_20PCT_60MX_BR)
// MT:     Cloned from MT 406 (FT_REL_TLEO_LC_45PCT_138MX) with amounts adjusted 300→100, 138→48

import { authedFetch, createPromotion, addPromotionName, createMessageTemplate, updatePromotion, findPromotionByCode } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const CODE    = 'FT_REL_TLEO_LC_45PCT_48MX';
const site    = getSite('qpro2');

const arrayToIntObj = (arr) => Object.fromEntries(arr.map((id, i) => [String(i), id]));
const isoToYmdHms  = (iso)  => { const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/); return m ? `${m[1]} ${m[2]}` : iso; };
const nowYmdHms    = ()     => new Date().toISOString().slice(0,19).replace('T',' ');

const LC_GP_IDS = [45,62,10,25,3,59,70,30,32,33,66,42];
const MIN_DEP   = 100;
const MAX_BONUS = 48;
const RATE      = 45;
const EXAMPLE_BONUS = 45;
const EXAMPLE_TOTAL = 145;
const EXAMPLE_TO    = 1160;

// 1. Idempotency check
const existing = await findPromotionByCode(site, CODE);
if (existing) { console.log(`SKIP: already exists id=${existing.id}`); process.exit(0); }

// 2. Fetch MT 406 and adjust amounts
const srcMt = await authedFetch(site, `/api/bo/messagetemplate/406`);
const srcDetails = srcMt.data?.message_details || {};

function adjustMsg(msg, ccy) {
  return msg
    .replace(new RegExp(`${ccy} 300`, 'g'), `${ccy} ${MIN_DEP}`)
    .replace(new RegExp(`${ccy} 138`, 'g'), `${ccy} ${MAX_BONUS}`)
    .replace(new RegExp(`${ccy} 135`, 'g'), `${ccy} ${EXAMPLE_BONUS}`)
    .replace(new RegExp(`${ccy} 435`, 'g'), `${ccy} ${EXAMPLE_TOTAL}`)
    .replace(new RegExp(`${ccy} 3,480`, 'g'), `${ccy} ${EXAMPLE_TO.toLocaleString()}`);
}

const newDetails = {};
for (const [lid, v] of Object.entries(srcDetails)) {
  const ccy = (lid === '6' || lid === '7') ? 'SGD' : 'MYR';
  newDetails[lid] = {
    settings_locale_id: Number(lid),
    subject: v.subject,
    message: adjustMsg(v.message, ccy),
  };
}

// 3. Build promo POST body
const promoCurrencies = {
  '0': { currency_id: '1', currency: 'MYR', min_transfer: MIN_DEP, max_bonus: MAX_BONUS, max_total_applications: 0, max_total_bonus: 0, status: '1', max_transfer_out: 0, promo_type: 2, current_players: 0, used_budget: 0 },
  '1': { currency_id: '3', currency: 'SGD', min_transfer: MIN_DEP, max_bonus: MAX_BONUS, max_total_applications: 0, max_total_bonus: 0, status: '1', max_transfer_out: 0, promo_type: 2, current_players: 0, used_budget: 0 },
};

const promoBody = {
  code:         CODE,
  name:         `Live Casino only, Bronze 1-3 (${RATE}%, Reload Bonus, min dep ${MIN_DEP}, max bns ${MAX_BONUS}, TO8x)`,
  promo_type:   2,
  promo_sub_type: '1',
  valid_from:   nowYmdHms(),
  validity:     1,
  reward_validity: 1,
  recurring:    '1',
  reset_frequency: 1,
  frequency_type: '1',
  frequency:    [],
  max_per_player: 999999,
  daily_max:    999999,
  first_deposit: 0,
  last_deposit: 1,
  auto_approve: 1,
  auto_unlock:  0,
  allow_cancel: 0,
  eligible_types: '1',
  visible_by_affiliate: 0,
  restrict_claim_round_active: 0,
  restrict_same_provider_launch: 0,
  limit_transfer_in: 0,
  limit_transfer_out: 0,
  bonus_rate:   RATE,
  free_spin_game_provider_id: 0,
  fixed_amount: 0,
  deposit_count: 0,
  message_template_id: 0,
  requires_email:    false,
  requires_mobile:   false,
  requires_dob:      false,
  requires_fullname: false,
  transfer_unlock:   false,
  kyc_basic:    true,
  kyc_advanced: true,
  kyc_pro:      true,
  telemarketer_ids: [],
  normal_account_manager_ids: [],
  vip_account_manager_ids: [],
  game_provider_ids: arrayToIntObj(LC_GP_IDS),
  target: { '0': { type: 1, multiplier: 8, game_provider_ids: arrayToIntObj(LC_GP_IDS) } },
  promotion_currency: promoCurrencies,
  promotion_category_turnover: { '0': 2 },
};

// 4. POST promotion
const created = await createPromotion(site, promoBody);
const promoId = created.data?.rows?.id || created.data?.id;
if (!promoId) throw new Error(`No id in response: ${JSON.stringify(created).slice(0,300)}`);
console.log(`✓ POST promotion → id=${promoId}`);

// 5. POST message template
const mtRes = await createMessageTemplate(site, {
  code:    `PROMOTIONS.MESSAGE.${CODE}`,
  name:    CODE,
  section: '8',
  type:    '1',
  status:  1,
  details: newDetails,
});
const newMtId = mtRes.data?.rows?.id || mtRes.data?.id;
if (!newMtId) throw new Error(`No MT id: ${JSON.stringify(mtRes).slice(0,200)}`);
console.log(`✓ POST message_template → id=${newMtId}`);

// 6. POST 4 promotion names
const nameRows = [
  { promotion_id: promoId, currency_id: 1, settings_locale_id: 1, promotion_name: 'Time Limited Exclusive Offer - 45% Reload Bonus', rewards_name: 'Time Limited Exclusive Offer - 45% Reload Bonus' },
  { promotion_id: promoId, currency_id: 1, settings_locale_id: 3, promotion_name: '限时独家优惠 - 45% 充値奖金', rewards_name: '限时独家优惠 - 45% 充値奖金' },
  { promotion_id: promoId, currency_id: 3, settings_locale_id: 6, promotion_name: 'Time Limited Exclusive Offer - 45% Reload Bonus', rewards_name: 'Time Limited Exclusive Offer - 45% Reload Bonus' },
  { promotion_id: promoId, currency_id: 3, settings_locale_id: 7, promotion_name: '限时独家优惠 - 45% 充値奖金', rewards_name: '限时独家优惠 - 45% 充値奖金' },
];
for (const nb of nameRows) await addPromotionName(site, nb);
console.log(`✓ POST names \xd7 ${nameRows.length}`);

// 7. PUT to link MT (explicit LC gp_ids to prevent overwrite)
const det = (await authedFetch(site, `/api/bo/promotion/${promoId}`)).data.rows;
const putBody = {
  code: det.code,
  name: det.name,
  free_spin_game_provider_id: det.free_spin_game_provider_id ?? 0,
  promotion_category_turnover: arrayToIntObj((det.promotion_category||[]).map(c => c.category_id)),
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
  game_provider_ids: arrayToIntObj(LC_GP_IDS),
  target: { '0': { type: det.target?.[0]?.type ?? 1, multiplier: det.target?.[0]?.multiplier ?? 8, game_provider_ids: arrayToIntObj(LC_GP_IDS) } },
  deposit_count: 0,
  eligible_types: String(det.eligible_types ?? '1'),
  telemarketer_ids: det.telemarketer_ids || [],
  normal_account_manager_ids: det.normal_account_manager_ids || [],
  vip_account_manager_ids: det.vip_account_manager_ids || [],
  requires_email:    det.requires_email ?? false,
  requires_mobile:   det.requires_mobile ?? false,
  requires_dob:      det.requires_dob ?? false,
  requires_fullname: det.requires_fullname ?? false,
  transfer_unlock:   det.transfer_unlock ?? false,
  kyc_basic:    det.kyc_basic ?? true,
  kyc_advanced: det.kyc_advanced ?? true,
  kyc_pro:      det.kyc_pro ?? true,
  bonus_rate:   Number(det.bonus_rate) || RATE,
  message_template_id: newMtId,
};
await updatePromotion(site, promoId, putBody);
console.log(`✓ PUT → linked MT id=${newMtId}`);

// 8. Apply blacklist from id=493 (FT_REL_TLEO_LC_45PCT_138MX — same LC providers)
const srcDet = await authedFetch(site, `/api/bo/promotion/493`);
const blsc = srcDet.data.rows.blacklist_sub_categories || [];
console.log(`\nApplying blacklist from id=493 (${blsc.length} entries)...`);

if (blsc.length > 0) {
  const srcMap = {};
  for (const item of blsc) {
    const arr = Array.isArray(item.sub_category_name) ? item.sub_category_name : [item.sub_category_name];
    srcMap[item.game_provider_code] = new Set(arr.map(s => String(s).toLowerCase()));
  }
  const bg = await authedFetch(site, '/api/bo/promotion/blacklistgame', {
    method: 'POST',
    body: { promotion_id: promoId, game_provider_ids: LC_GP_IDS, categories: ['LIVE CASINO'] },
  });
  const rows = bg.data?.rows || [];
  let marked = 0;
  const providersHit = new Set();
  for (const r of rows) {
    const srcSubs = srcMap[r.game_provider_code];
    if (!srcSubs) continue;
    for (const sc of r.sub_categories) {
      if (srcSubs.has(String(sc.name).toLowerCase())) { sc.status = 1; marked++; providersHit.add(r.game_provider_code); }
    }
  }
  await authedFetch(site, '/api/bo/promotion/updateblacklistgame', {
    method: 'POST',
    body: { promotion_id: promoId, black_list_sub_categories: rows },
  });
  console.log(`✓ Blacklist: marked ${marked} sub-cats across ${providersHit.size} providers`);
} else {
  console.log(`ℹ Blacklist source empty`);
}

// 9. QC
const ck = await authedFetch(site, `/api/bo/promotion/${promoId}`);
const q = ck.data.rows;
console.log(`\nQC:`);
console.log(`  id:                   ${q.id}`);
console.log(`  code:                 ${q.code}`);
console.log(`  status:               ${q.status}`);
console.log(`  bonus_rate:           ${q.bonus_rate}`);
console.log(`  message_template_id:  ${q.message_template_id}`);
console.log(`  gp_ids (target[0]):   ${q.target?.[0]?.game_provider_ids?.length}`);
console.log(`  blacklist_sub_cats:   ${(q.blacklist_sub_categories||[]).length}`);
console.log(q.target?.[0]?.game_provider_ids?.length === 12 && q.message_template_id === newMtId ? '✓ ALL OK' : '✗ UNEXPECTED STATE');
