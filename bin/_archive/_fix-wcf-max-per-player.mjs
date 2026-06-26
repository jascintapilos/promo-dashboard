#!/usr/bin/env node
// Fix WCF_* promos on all QPRO + QP2 BOs: set max_per_player = 1

import { getSite } from '../../src/sites.js';
import { authedFetch, updatePromotion } from '../../src/api-client.js';

function arrToObj(arr) {
  const o = {};
  (arr || []).forEach((v, i) => { o[String(i)] = v; });
  return o;
}
const b01 = (v) => (v === true ? 1 : v === false ? 0 : v);
const toBoDate = (iso) => iso ? iso.replace('T', ' ').replace(/\.\d+Z?$/, '') : null;

// ── QPRO patcher ──────────────────────────────────────────────────────────────
async function patchQpro(siteId, promoList) {
  const site = await getSite(siteId);
  const results = [];
  for (const { id, code } of promoList) {
    try {
      const detRes = await authedFetch(site, `/api/bo/promotion/${id}`);
      const r = detRes?.data?.rows;
      const listRes = await authedFetch(site, `/api/bo/promotion?code=${code}&list=1`);
      const listRow = listRes?.data?.rows?.[0];
      const existingPopup = listRow?.dialog_popup_list?.[0];
      const catIds = (r.promotion_category || []).filter(c => c.target_type === 1).map(c => c.category_id);
      const dialogPopupList = existingPopup ? {
        '0': { id: existingPopup.popup_id, start_date: toBoDate(existingPopup.created_at), end_date: null, promotion_id: id, labelKey: code, code }
      } : [];
      const body = {
        id, code: r.code, name: r.name,
        free_spin_game_provider_id: r.free_spin_game_provider_id,
        promotion_category_turnover: arrToObj(catIds),
        promotion_category_winloss: [],
        promo_type: r.promo_type, promo_sub_type: Number(r.promo_sub_type),
        promotion_ids: [], valid_from: toBoDate(r.valid_from),
        validity: r.validity, reward_validity: r.reward_validity,
        frequency: r.frequency, frequency_type: Number(r.frequency_type),
        first_deposit: r.first_deposit, member_group_ids: [],
        last_deposit: b01(r.last_deposit), auto_approve: b01(r.auto_approve),
        auto_reward_activation: 1, visible_by_affiliate: r.visible_by_affiliate,
        recurring: Number(r.recurring),
        max_per_player: 1,
        daily_max: r.daily_max,
        status: 1,
        limit_transfer_in: b01(r.limit_transfer_in), limit_transfer_out: b01(r.limit_transfer_out),
        restrict_claim_round_active: b01(r.restrict_claim_round_active),
        restrict_same_provider_launch: b01(r.restrict_same_provider_launch),
        bonus_rate: r.bonus_rate != null ? String(Number(r.bonus_rate).toFixed(2)) : undefined,
        ...(r.reset_frequency != null && r.reset_frequency !== 0 ? { reset_frequency: r.reset_frequency } : {}),
        ...(r.free_spin_game_code ? { free_spin_game_code: r.free_spin_game_code } : {}),
        auto_unlock: b01(r.auto_unlock), allow_cancel: r.allow_cancel,
        game_provider_ids: arrToObj(r.game_provider_ids || []),
        target: r.target, message_template_id: r.message_template_id || 0,
        message_template_sms_id: 0, eligible_types: Number(r.eligible_types),
        affiliate_group_ids: [], telemarketer_ids: [],
        normal_account_manager_ids: [], vip_account_manager_ids: [],
        requires_email: r.requires_email, requires_mobile: r.requires_mobile,
        requires_dob: r.requires_dob, requires_fullname: r.requires_fullname,
        transfer_unlock: b01(r.transfer_unlock),
        kyc_basic: r.kyc_basic, kyc_advanced: r.kyc_advanced, kyc_pro: r.kyc_pro,
        blacklist_id: r.blacklist_id, black_list_sub_categories: [],
        dialog_popup_list: dialogPopupList,
      };
      await updatePromotion(site, id, body);
      results.push({ code, ok: true });
    } catch(e) {
      results.push({ code, ok: false, error: e.message.split('\n')[0].slice(0, 120) });
    }
  }
  return results;
}

// ── QP2 patcher ───────────────────────────────────────────────────────────────
const CODE_TO_PUT_ID = {
  '365G':178,'9W':139,'AP':341,'AVI':196,'BG':15,'BOOM':268,'BNG':328,'BTG':292,
  'CMD':18,'CQ9':14,'EVOK':320,'EZ':25,'FS':122,'FP':304,'FC':184,'GXW':324,
  'HSG':197,'IM':23,'2BC':312,'JDB':110,'JILI':111,'JK':7,'KA':190,'LIVE':21,
  'LUCKY':284,'MAHA':313,'MGP':203,'MONKEY':274,'NET2':256,'NEXT':22,'NLC':257,
  'PNG':17,'AG':1,'PTI':308,'PP':35,'PP2':345,'RT2':258,'RG':349,'SA':13,
  'MAX':8,'SBO':34,'SBO2':353,'SEXY':31,'SIMPLE':10,'SG':9,'SPRIBE':187,
  'TF':117,'VIVO':332,'WBET':72,'WM':37,'XE':33,'YB':297,'YL':36,
};

async function getPromoCurrency(site, pid) {
  const r = await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${pid}&perPage=20&page=1`);
  return r.data?.rows || [];
}

function buildPromoCurrencyForPut(currencyRows) {
  const cur = {};
  currencyRows.forEach((row, i) => {
    cur[String(i)] = {
      currency_id: String(row.settings_currency_id),
      bonus_amount: 0,
      bonus_rate: Number(row.bonus_rate),
      bypass_min_deposit: row.bypass_min_deposit ?? 0,
      max_balance_claim: null,
      status: String(row.status ?? 1),
      reset: row.reset ?? 0,
      start_time: row.start_time || '00:00:00',
      end_time: row.end_time || '23:59:59',
      min_transfer: Number(row.min_transfer ?? 0),
      min_deposit: Number(row.min_deposit ?? 0),
      max_withdraw_type: String(row.max_withdraw_type ?? 1),
      max_withdraw: row.max_withdraw,
      max_total_applications: 0,
      max_total_bonus: 0,
      bonus_type: row.bonus_type ?? 2,
      promo_type: row.promo_type ?? null,
      currency: row.currency,
      reset_name: row.reset_name || 'None',
      max_bonus: Number(row.max_bonus ?? 0),
      total_players: 0, current_players: 0,
      total_used_budget: 0, current_used_budget: 0,
      ...(row.deposit_options?.length ? { deposit_options: row.deposit_options } : {}),
    };
  });
  return cur;
}

async function patchQp2(promoList) {
  const site = await getSite('ibc22');
  const results = [];
  for (const { id, code } of promoList) {
    try {
      const detRes = await authedFetch(site, `/api/bo/promotion/${id}`);
      const p = detRes?.data?.rows;
      const currencyRows = await getPromoCurrency(site, id);
      const gpCodes = p.game_provider_codes || [];
      const gpPutIds = arrToObj(gpCodes.map(c => CODE_TO_PUT_ID[c]).filter(Boolean));
      const tgtCodes = arrToObj(gpCodes);
      const merchantIds = arrToObj((p.merchant_ids || []).map(m => m.id ?? m));
      const memberGroupIds = arrToObj(p.member_group_ids || []);
      const promoCurrency = buildPromoCurrencyForPut(currencyRows);

      const body = {
        id: p.id, bonus_settings: p.bonus_settings,
        code: p.code, name: p.name,
        free_spin_game_provider_id: p.free_spin_game_provider_id ?? 0,
        ...(p.free_spin_game_code ? { free_spin_game_code: p.free_spin_game_code } : {}),
        blacklist_id: p.blacklist_id,
        promotion_category_ids: p.promotion_category_ids ?? [],
        promo_type: p.promo_type, promo_sub_type: p.promo_sub_type,
        promotion_ids: [],
        valid_from: toBoDate(p.valid_from),
        validity: p.validity, reward_validity: p.reward_validity,
        frequency: p.frequency ?? [], frequency_type: p.frequency_type,
        member_group_ids: memberGroupIds,
        members_only: p.members_only ?? 0,
        fingerprint_check: p.fingerprint_check ?? 0,
        freespin_check: p.freespin_check ?? 0,
        auto_approve: p.auto_approve, auto_reward_activation: p.auto_reward_activation ?? 1,
        recurring: p.recurring, reset_frequency: p.reset_frequency,
        reset_month: p.reset_month ?? 1,
        max_per_player: 1,
        daily_max: p.daily_max,
        status: p.status ?? 1,
        limit_transfer_in: p.limit_transfer_in ?? 0,
        limit_transfer_out: p.limit_transfer_out ?? 0,
        bonus_rate: 0,
        auto_unlock: p.auto_unlock, allow_cancel: p.allow_cancel,
        withdrawal_unlock: p.withdrawal_unlock ?? 0,
        game_provider_codes: gpPutIds,
        target: {
          type: (p.target?.[0]?.type) ?? 1,
          multiplier: String(Number(p.target?.[0]?.multiplier ?? 0).toFixed(2)),
          game_provider_codes: tgtCodes,
        },
        message_template_id: p.message_template_id ?? 0,
        message_template_sms_id: p.message_template_sms_id ?? 0,
        deposit_count: p.deposit_count ?? 0,
        active_period: p.active_period ?? 0,
        merchant_ids: merchantIds,
        allow_deposit: p.allow_deposit ?? 0,
        allow_continuous_claim: p.allow_continuous_claim ?? 0,
        deposit_status: p.last_deposit === 1 ? 4 : 1,
        eligible_types: p.eligible_types ?? 1,
        affiliate_group_ids: [], telemarketer_ids: [],
        requires_mobile: p.requires_mobile ?? 0,
        requires_dob: p.requires_dob ?? 0,
        requires_fullname: p.requires_fullname ?? 0,
        black_list_sub_categories: [],
        promotion_currency: promoCurrency,
        dialog_popup_list: [],
      };

      await authedFetch(site, `/api/bo/promotion/${id}`, { method: 'PUT', body });
      results.push({ code, ok: true });
    } catch(e) {
      results.push({ code, ok: false, error: e.message.split('\n')[0].slice(0, 120) });
    }
  }
  return results;
}

// ── Site → promo ID map ───────────────────────────────────────────────────────
const qproSites = {
  qpro2:  [{id:495,code:'WCF_FREEBET5'},{id:496,code:'WCF_FREEBET8'},{id:497,code:'WCF_FREEBET10'},{id:498,code:'WCF_VIP100GET20'},{id:499,code:'WCF_VIP200GET50'},{id:500,code:'WCF_VIP300GET60'},{id:501,code:'WCF_VIP400GET70'},{id:502,code:'WCF_VIP500GET88'},{id:503,code:'WCF_VIP1000GET888'}],
  qpro3:  [{id:509,code:'WCF_FREEBET5'},{id:510,code:'WCF_FREEBET8'},{id:511,code:'WCF_FREEBET10'},{id:512,code:'WCF_VIP100GET20'},{id:514,code:'WCF_VIP200GET50'},{id:513,code:'WCF_VIP300GET60'},{id:515,code:'WCF_VIP400GET70'},{id:516,code:'WCF_VIP500GET88'},{id:517,code:'WCF_VIP1000GET888'}],
  qpro4:  [{id:445,code:'WCF_FREEBET5'},{id:446,code:'WCF_FREEBET8'},{id:447,code:'WCF_FREEBET10'},{id:448,code:'WCF_VIP100GET20'},{id:449,code:'WCF_VIP200GET50'},{id:450,code:'WCF_VIP300GET60'},{id:451,code:'WCF_VIP400GET70'},{id:452,code:'WCF_VIP500GET88'},{id:453,code:'WCF_VIP1000GET888'}],
  qpro5:  [{id:405,code:'WCF_FREEBET5'},{id:406,code:'WCF_FREEBET8'},{id:407,code:'WCF_FREEBET10'},{id:408,code:'WCF_VIP100GET20'},{id:409,code:'WCF_VIP200GET50'},{id:410,code:'WCF_VIP300GET60'},{id:411,code:'WCF_VIP400GET70'},{id:412,code:'WCF_VIP500GET88'},{id:413,code:'WCF_VIP1000GET888'}],
  qpro6:  [{id:460,code:'WCF_FREEBET5'},{id:461,code:'WCF_FREEBET8'},{id:462,code:'WCF_FREEBET10'},{id:463,code:'WCF_VIP100GET20'},{id:464,code:'WCF_VIP200GET50'},{id:465,code:'WCF_VIP300GET60'},{id:466,code:'WCF_VIP400GET70'},{id:467,code:'WCF_VIP500GET88'},{id:468,code:'WCF_VIP1000GET888'}],
  qpro7:  [{id:397,code:'WCF_FREEBET5'},{id:398,code:'WCF_FREEBET8'},{id:399,code:'WCF_FREEBET10'},{id:400,code:'WCF_VIP100GET20'},{id:401,code:'WCF_VIP200GET50'},{id:402,code:'WCF_VIP300GET60'},{id:403,code:'WCF_VIP400GET70'},{id:404,code:'WCF_VIP500GET88'},{id:405,code:'WCF_VIP1000GET888'}],
  qpro8:  [{id:516,code:'WCF_FREEBET5'},{id:517,code:'WCF_FREEBET8'},{id:518,code:'WCF_FREEBET10'},{id:519,code:'WCF_VIP100GET20'},{id:520,code:'WCF_VIP200GET50'},{id:521,code:'WCF_VIP300GET60'},{id:522,code:'WCF_VIP400GET70'},{id:523,code:'WCF_VIP500GET88'},{id:524,code:'WCF_VIP1000GET888'}],
  qpro9:  [{id:333,code:'WCF_FREEBET5'},{id:334,code:'WCF_FREEBET8'},{id:335,code:'WCF_FREEBET10'},{id:336,code:'WCF_VIP100GET20'},{id:337,code:'WCF_VIP200GET50'},{id:338,code:'WCF_VIP300GET60'},{id:339,code:'WCF_VIP400GET70'},{id:340,code:'WCF_VIP500GET88'},{id:341,code:'WCF_VIP1000GET888'}],
  qpro10: [{id:313,code:'WCF_FREEBET5'},{id:314,code:'WCF_FREEBET8'},{id:315,code:'WCF_FREEBET10'},{id:316,code:'WCF_VIP100GET20'},{id:317,code:'WCF_VIP200GET50'},{id:318,code:'WCF_VIP300GET60'},{id:319,code:'WCF_VIP400GET70'},{id:320,code:'WCF_VIP500GET88'},{id:321,code:'WCF_VIP1000GET888'}],
  qpro11: [{id:188,code:'WCF_FREEBET5'},{id:189,code:'WCF_FREEBET8'},{id:190,code:'WCF_FREEBET10'},{id:191,code:'WCF_VIP100GET20'},{id:192,code:'WCF_VIP200GET50'},{id:193,code:'WCF_VIP300GET60'},{id:194,code:'WCF_VIP400GET70'},{id:195,code:'WCF_VIP500GET88'},{id:196,code:'WCF_VIP1000GET888'}],
  qpro12: [{id:153,code:'WCF_FREEBET5'},{id:154,code:'WCF_FREEBET8'},{id:155,code:'WCF_FREEBET10'},{id:156,code:'WCF_VIP100GET20'},{id:157,code:'WCF_VIP200GET50'},{id:158,code:'WCF_VIP300GET60'},{id:159,code:'WCF_VIP400GET70'},{id:160,code:'WCF_VIP500GET88'},{id:161,code:'WCF_VIP1000GET888'}],
  qpro15: [{id:304,code:'WCF_FREEBET5'},{id:305,code:'WCF_FREEBET8'},{id:306,code:'WCF_FREEBET10'},{id:307,code:'WCF_VIP100GET20'},{id:308,code:'WCF_VIP200GET50'},{id:309,code:'WCF_VIP300GET60'},{id:310,code:'WCF_VIP400GET70'},{id:311,code:'WCF_VIP500GET88'},{id:312,code:'WCF_VIP1000GET888'}],
  qpro16: [{id:272,code:'WCF_FREEBET5'},{id:273,code:'WCF_FREEBET8'},{id:274,code:'WCF_FREEBET10'},{id:275,code:'WCF_VIP100GET20'},{id:276,code:'WCF_VIP200GET50'},{id:277,code:'WCF_VIP300GET60'},{id:278,code:'WCF_VIP400GET70'},{id:279,code:'WCF_VIP500GET88'},{id:280,code:'WCF_VIP1000GET888'}],
  qpro17: [{id:143,code:'WCF_FREEBET5'},{id:144,code:'WCF_FREEBET8'},{id:145,code:'WCF_FREEBET10'},{id:146,code:'WCF_VIP100GET20'},{id:147,code:'WCF_VIP200GET50'},{id:148,code:'WCF_VIP300GET60'},{id:149,code:'WCF_VIP400GET70'},{id:150,code:'WCF_VIP500GET88'},{id:151,code:'WCF_VIP1000GET888'}],
};

const qp2Promos = [
  {id:1246,code:'WCF_FREEBET5'},{id:1248,code:'WCF_FREEBET8'},{id:1249,code:'WCF_FREEBET10'},
  {id:1250,code:'WCF_VIP100GET20'},{id:1251,code:'WCF_VIP200GET50'},{id:1252,code:'WCF_VIP300GET60'},
  {id:1253,code:'WCF_VIP400GET70'},{id:1254,code:'WCF_VIP500GET88'},{id:1255,code:'WCF_VIP1000GET888'},
];

// ── Execute ───────────────────────────────────────────────────────────────────
console.log('Patching 14 QPRO sites + ibc22 (QP2) in parallel...\n');

const [qproResults, qp2Results] = await Promise.all([
  Promise.all(Object.entries(qproSites).map(([siteId, promos]) =>
    patchQpro(siteId, promos).then(res => ({ siteId, res }))
  )),
  patchQp2(qp2Promos).then(res => ({ siteId: 'ibc22', res })),
]);

const allResults = [...qproResults, qp2Results];
let totalOk = 0, totalFail = 0;

for (const { siteId, res } of allResults) {
  const ok = res.filter(r => r.ok).length;
  const fail = res.filter(r => !r.ok);
  totalOk += ok; totalFail += fail.length;
  const icon = fail.length === 0 ? 'OK' : 'FAIL';
  process.stdout.write(`${icon.padEnd(4)} ${siteId}: ${ok}/9`);
  if (fail.length) process.stdout.write(' | ' + fail.map(f => `${f.code}(${f.error})`).join(', '));
  process.stdout.write('\n');
}

console.log(`\nTotal: ${totalOk} saved, ${totalFail} failed`);
