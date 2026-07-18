#!/usr/bin/env node
// Add SPORT category + ALL sport providers to the LC WELC/REL family on QPRO2,
// per operator instruction 2026-07-18 ("add sports as all for ACQ_REL and
// ACQ_WELC"). Mirrors the QP2D treatment where the operator also added the
// full sport set (incl. SBO2) by hand.
//   • Promos: 579-581 (ACQ_WELC_*_12X_LC) + 584-586 (ACQ_REL_*_12X_LC)
//   • categories → [2 LIVE CASINO, 1 SPORT]; blacklist_id 6 → 11 ("Live
//     Casino and Sports Only"); providers → current set ∪ ALL 10 sport
//     providers (9W,BTI,CMD,IM,2BC,MAX,SBO,SBO2,TF,WBET) — no exclusions,
//     operator said "all". WELC keeps its legacy PP(30); REL has none.
//   • MTs 507-509 + 512-514: category clause rewritten to the LC+Sports
//     wording (EN+ZH), same sentences as the QP2D fix.
// Echo-PUT body copied from bin/fix-cat-gp-estate.mjs buildQproBody (proven);
// promotion_currency never sent; dialog re-asserted from the listing;
// currency signature checked before/after for drift.

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('qpro2');
const DRY_RUN = !process.argv.includes('--commit');

const TARGETS = [
  { promoId: 579, mtId: 507 }, { promoId: 580, mtId: 508 }, { promoId: 581, mtId: 509 }, // WELC
  { promoId: 584, mtId: 512 }, { promoId: 585, mtId: 513 }, { promoId: 586, mtId: 514 }, // REL
];

const SPORT_GP_IDS = [67, 73, 5, 15, 60, 23, 48, 72, 38, 40]; // 9W,BTI,CMD,IM,2BC,MAX,SBO,SBO2,TF,WBET
const NEW_CAT_IDS = [2, 1]; // LIVE CASINO + SPORT
const NEW_BLACKLIST_ID = 11; // "Live Casino and Sports Only"

const OLD_EN = 'Live Casino category is eligible for this promotion except Blackjack.';
const NEW_EN = 'Live Casino and Sports categories are eligible for this promotion. Blackjack is excluded under Live Casino, and Virtual Sports and Number Games are excluded under Sports.';
const OLD_ZH = '本优惠适用于真人娱乐场游戏类别，惟二十一点除外。';
const NEW_ZH = '本优惠适用于真人娱乐场及体育游戏类别。真人娱乐场类别不包括二十一点；体育类别不包括虚拟体育及数字游戏。';

const objVals = (o) => (o == null ? [] : Array.isArray(o) ? o : Object.values(o));
const arrayToIntObj = (arr) => Object.fromEntries(arr.map((v, i) => [String(i), v]));
const toYmdHis = (iso) => (iso ? String(iso).replace('T', ' ').replace(/\.\d+Z?$/, '') : null);
const b01 = (v) => (v === true ? 1 : v === false ? 0 : v);

async function currencySig(promoId) {
  const r = await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${promoId}&perPage=20`);
  return (r.data?.rows || [])
    .map((c) => [c.id, c.currency, c.bonus_rate, c.min_transfer, c.max_bonus, c.status].join('|'))
    .sort().join(';');
}

async function dialogRow(code) {
  const r = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=10`);
  const row = objVals(r.data?.rows).find((x) => x.code === code);
  return (row?.dialog_popup_list || [])[0] ?? null;
}

function buildQproBody(d, popupRow, newGpIds, newCatIds) {
  const target0 = Array.isArray(d.target) ? d.target[0] : (d.target?.['0'] ?? {});
  const gpObj = arrayToIntObj(newGpIds);
  const body = {
    id: d.id, code: d.code, name: d.name,
    free_spin_game_provider_id: d.free_spin_game_provider_id ?? 0,
    promotion_category_turnover: arrayToIntObj(newCatIds),
    promotion_category_winloss: [],
    promo_type: d.promo_type,
    promo_sub_type: Number(d.promo_sub_type),
    promotion_ids: [],
    valid_from: toYmdHis(d.valid_from),
    validity: d.validity,
    reward_validity: d.reward_validity,
    frequency: d.frequency ?? [],
    frequency_type: Number(d.frequency_type ?? 1),
    first_deposit: b01(d.first_deposit) ?? 0,
    member_group_ids: d.member_group_ids ?? [],
    last_deposit: b01(d.last_deposit),
    auto_approve: b01(d.auto_approve),
    auto_reward_activation: d.auto_reward_activation ?? 1,
    visible_by_affiliate: d.visible_by_affiliate ?? 0,
    recurring: Number(d.recurring ?? 0),
    max_per_player: d.max_per_player ?? 99999,
    daily_max: d.daily_max ?? 1,
    status: d.status,
    limit_transfer_in: b01(d.limit_transfer_in),
    limit_transfer_out: b01(d.limit_transfer_out),
    restrict_claim_round_active: d.restrict_claim_round_active ?? 0,
    restrict_same_provider_launch: d.restrict_same_provider_launch ?? 0,
    auto_unlock: b01(d.auto_unlock),
    allow_cancel: d.allow_cancel ?? 0,
    game_provider_ids: gpObj,
    target: {
      '0': {
        type: target0.type ?? 1,
        multiplier: target0.multiplier ?? 0,
        game_provider_ids: gpObj,
      },
    },
    message_template_id: d.message_template_id ?? 0,
    message_template_sms_id: 0,
    eligible_types: d.eligible_types,
    affiliate_group_ids: [],
    telemarketer_ids: d.telemarketer_ids ?? [],
    normal_account_manager_ids: d.normal_account_manager_ids ?? [],
    vip_account_manager_ids: d.vip_account_manager_ids ?? [],
    requires_email: d.requires_email,
    requires_mobile: d.requires_mobile,
    requires_dob: d.requires_dob,
    requires_fullname: d.requires_fullname,
    transfer_unlock: d.transfer_unlock,
    kyc_basic: d.kyc_basic,
    kyc_advanced: d.kyc_advanced,
    kyc_pro: d.kyc_pro,
    blacklist_id: NEW_BLACKLIST_ID,
    black_list_sub_categories: [],
    dialog_popup_list: popupRow
      ? { '0': { id: popupRow.popup_id, start_date: popupRow.created_at ? toYmdHis(popupRow.created_at) : '', end_date: null, promotion_id: d.id, labelKey: '', code: '' } }
      : [],
  };
  if (d.bonus_rate != null) body.bonus_rate = String(Number(d.bonus_rate).toFixed(2));
  if (d.recurring && d.reset_frequency) body.reset_frequency = d.reset_frequency;
  return body;
}

console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'COMMIT'}\n`);

for (const t of TARGETS) {
  console.log(`━━ Promo ${t.promoId} / MT ${t.mtId} ━━`);
  const d = (await authedFetch(site, `/api/bo/promotion/${t.promoId}`))?.data?.rows;
  const curCats = (d.promotion_category || []).map((c) => c.category_id);
  const curGps = objVals(d.game_provider_ids).map(Number);
  const newGps = [...new Set([...curGps, ...SPORT_GP_IDS])];
  console.log(`  ${d.code}  cats=${JSON.stringify(curCats)}→${JSON.stringify(NEW_CAT_IDS)}  bl=${d.blacklist_id}→${NEW_BLACKLIST_ID}  gps ${curGps.length}→${newGps.length}  max_per_player=${d.max_per_player} daily_max=${d.daily_max}`);
  if (d.max_per_player == null || d.daily_max == null) { console.log('  ✗ claim caps missing from detail — ABORT this promo (echo would overwrite)'); continue; }

  const popupRow = await dialogRow(d.code);
  console.log(`  dialog: ${popupRow ? 'popup_id=' + popupRow.popup_id : 'NONE'}`);
  const sigBefore = await currencySig(t.promoId);

  if (DRY_RUN) {
    console.log('  [dry-run] would PUT promotion + MT clause update\n');
    continue;
  }

  const body = buildQproBody(d, popupRow, newGps, NEW_CAT_IDS);
  const putRes = await authedFetch(site, `/api/bo/promotion/${t.promoId}`, { method: 'PUT', body });
  console.log(`  PUT: ${putRes?.data?.rows?.id === t.promoId || putRes?.data?.success ? '✓' : JSON.stringify(putRes?.data?.message ?? '').slice(0, 80)}`);

  const v = (await authedFetch(site, `/api/bo/promotion/${t.promoId}`))?.data?.rows;
  const vCats = (v.promotion_category || []).map((c) => c.category_id).sort((a, b) => a - b);
  const vGps = objVals(v.game_provider_ids).map(Number);
  const vTargetGps = objVals((Array.isArray(v.target) ? v.target[0] : v.target)?.game_provider_ids).map(Number);
  const sigAfter = await currencySig(t.promoId);
  const dlgAfter = await dialogRow(v.code);
  console.log(`  verify: cats=${JSON.stringify(vCats)} bl=${v.blacklist_id} gps=${vGps.length} targetGps=${vTargetGps.length} max_per_player=${v.max_per_player} daily_max=${v.daily_max} status=${v.status}`);
  console.log(`  drift: currency=${sigBefore === sigAfter ? '✓ unchanged' : '✗ CHANGED'} dialog=${dlgAfter?.popup_id === popupRow?.popup_id ? '✓ preserved' : '✗ ' + JSON.stringify(dlgAfter?.popup_id)}`);

  // ── MT clause ──
  const mtRes = await authedFetch(site, `/api/bo/messagetemplate/${t.mtId}`, { method: 'GET' });
  const mtRow = mtRes?.data?.rows || mtRes?.data || mtRes;
  const tpl = mtRow.message_template;
  const details = mtRow.message_details;
  const newDetails = {};
  let changed = 0, abort = false;
  for (const [localeId, det] of Object.entries(details)) {
    const isZh = localeId === '3' || localeId === '7';
    let msg = det.message;
    const oldC = isZh ? OLD_ZH : OLD_EN;
    const newC = isZh ? NEW_ZH : NEW_EN;
    if (msg.includes(oldC)) { msg = msg.replace(oldC, newC); changed++; console.log(`  [MT] locale ${localeId}: clause replaced`); }
    else if (msg.includes(newC)) { console.log(`  [MT] locale ${localeId}: already updated`); }
    else { console.log(`  [MT] locale ${localeId}: ✗ clause NOT FOUND — aborting MT`); abort = true; }
    newDetails[localeId] = { settings_locale_id: Number(localeId), subject: det.subject, message: msg };
  }
  if (abort || changed === 0) { console.log(`  [MT] ${abort ? 'aborted' : 'nothing to change'}\n`); continue; }
  const mtPut = await authedFetch(site, `/api/bo/messagetemplate/${t.mtId}`, {
    method: 'PUT',
    body: { name: tpl.name, section: Number(tpl.section), type: Number(tpl.type), status: tpl.status, details: newDetails },
  });
  console.log('  [MT] PUT:', String(JSON.stringify(mtPut?.data?.message ?? mtPut?.data ?? mtPut)).slice(0, 80));
  const mtVRes = await authedFetch(site, `/api/bo/messagetemplate/${t.mtId}`, { method: 'GET' });
  const mtV = mtVRes?.data?.rows || mtVRes?.data || mtVRes;
  const clauseOk = Object.entries(mtV.message_details).every(([lid, det2]) =>
    det2.message.includes(lid === '3' || lid === '7' ? NEW_ZH : NEW_EN));
  console.log(`  [MT] verify: ${clauseOk ? '✓ all locales carry new clause' : '✗ MISMATCH'}\n`);
}
