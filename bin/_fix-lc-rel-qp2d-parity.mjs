#!/usr/bin/env node
// QP2D parity fixes for ACQ_REL_*PCT_12X_LC (promos 1410-1412, MTs 1351-1353),
// replicating the treatment applied to the WELC source codes (1400-1402):
//   1. Add SGD currency row — same numeric values as MYR
//      (pattern: bin/_fix-lc-welc-add-sgd.mjs, executed successfully on this BO)
//   2. Add SPORT category + 5 non-hard-excluded SPORT providers + blacklist
//      template 11 "Live Casino and Sports Only"
//      (pattern: bin/_fix-lc-welc-add-sports.mjs). PP deliberately NOT added —
//      it survives on the WELC promos only as a legacy leftover; estate
//      hard-exclusion applies to new codes.
//   3. MT: rewrite the category clause to the LC+Sports wording (EN+ZH)
//      (pattern: bin/_fix-lc-welc-mt-clause4.mjs)
//   4. MT: add SG_EN(6)/SG_ZH(7) locale blocks — clause-updated MY bodies with
//      MYR→SGD (pattern: bin/_fix-lc-welc-mt-sgd.mjs)
// promotion_currency + black_list_sub_categories OMITTED from the promotion PUT
// per project_qp2_promotion_put_semantics.md; dialog_popup_list re-asserted.

import { authedFetch, getAllMerchantBankIds, readDialogForPreservation } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('ibc22');
const DRY_RUN = !process.argv.includes('--commit');

const TARGETS = [
  { promoId: 1410, mtId: 1351, bonus_rate: 120, min_deposit: 100, max_bonus: 120 },
  { promoId: 1411, mtId: 1352, bonus_rate: 150, min_deposit: 200, max_bonus: 300 },
  { promoId: 1412, mtId: 1353, bonus_rate: 180, min_deposit: 500, max_bonus: 900 },
];

// Current LC set on the REL promos (11 codes, no PP) + 5 SPORT codes.
// code -> PUT numeric id, from the proven QP2A RAW capture in api-mapper-qp2.js.
const PROVIDER_ID_MAP = {
  BG: 15, EVOK: 320, EZ: 25, MGP: 203, AG: 1, PTI: 308, PP2: 345,
  SA: 13, SEXY: 31, VIVO: 332, WM: 37,                 // existing LC (untouched)
  '9W': 139, CMD: 18, '2BC': 312, MAX: 8, WBET: 72,    // new (SPORT, non-excluded)
};
const NEW_CATEGORY_IDS = { '0': 2, '1': 1 }; // LIVE CASINO + SPORT
const NEW_GAME_PROVIDER_CODES = {};
Object.values(PROVIDER_ID_MAP).forEach((id, i) => { NEW_GAME_PROVIDER_CODES[String(i)] = id; });
const NEW_TARGET_CODES = {};
Object.keys(PROVIDER_ID_MAP).forEach((code, i) => { NEW_TARGET_CODES[String(i)] = code; });

const OLD_EN = 'Live Casino category is eligible for this promotion except Blackjack.';
const NEW_EN = 'Live Casino and Sports categories are eligible for this promotion. Blackjack is excluded under Live Casino, and Virtual Sports and Number Games are excluded under Sports.';
const OLD_ZH = '本优惠适用于真人娱乐场游戏类别，惟二十一点除外。';
const NEW_ZH = '本优惠适用于真人娱乐场及体育游戏类别。真人娱乐场类别不包括二十一点；体育类别不包括虚拟体育及数字游戏。';

function toYmdHis(isoStr) {
  if (!isoStr) return null;
  return String(isoStr).replace('T', ' ').replace(/\.\d+Z?$/, '');
}

console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'COMMIT'}\n`);

const sgdIds = await getAllMerchantBankIds(site, { currencyId: 3, purpose: 1 });
console.log(`SGD deposit_options: ${sgdIds.length} bank IDs\n`);

for (const t of TARGETS) {
  console.log(`━━ Promo ${t.promoId} / MT ${t.mtId} (rate=${t.bonus_rate}) ━━`);

  // ── 1. SGD currency row ──────────────────────────────────────────────
  const existing = await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${t.promoId}`);
  const curRows = existing?.data?.rows || [];
  if (curRows.some((r) => r.currency === 'SGD')) {
    console.log('  [1 SGD] already exists — skipping');
  } else if (DRY_RUN) {
    console.log(`  [1 SGD] would POST rate=${t.bonus_rate} min_dep=${t.min_deposit} max_bonus=${t.max_bonus}`);
  } else {
    const body = {
      promotion_id: t.promoId,
      settings_currency_id: 3,
      currency: 'SGD',
      currency_id: 3,
      gmt: '+8',
      start_time: '00:00:00',
      end_time: '23:59:59',
      max_total_applications: null,
      max_total_bonus: null,
      bonus_type: 2,
      bonus_amount: 0,
      bonus_rate: t.bonus_rate,
      min_transfer: t.min_deposit,
      min_deposit: t.min_deposit,
      bypass_min_deposit: 0,
      max_withdraw_type: 1,
      max_withdraw: null,
      max_bonus: t.max_bonus,
      min_bonus: 0,
      threshold: 0,
      rounds: 0,
      amount_per_line: 0,
      lines: 0,
      coins: 0,
      status: 1,
      reset: 0,
      reset_name: 'None',
      promo_type: 2,
      deposit_options: sgdIds,
      merchant_bank_ids: Object.fromEntries(sgdIds.map((id, i) => [String(i), id])),
    };
    try {
      const res = await authedFetch(site, '/api/bo/promotioncurrency', { method: 'POST', body });
      console.log('  [1 SGD] POST ✓ id=' + (res.data?.rows?.id ?? '?'));
    } catch (e) {
      console.log('  [1 SGD] POST ✗ FAILED —', e.message.slice(0, 200));
    }
    const verify = await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${t.promoId}`);
    const vRows = verify?.data?.rows || [];
    const sgd = vRows.find((r) => r.currency === 'SGD');
    console.log(`  [1 SGD] verify: currencies=[${vRows.map((r) => r.currency).join(',')}] SGD rate=${sgd?.bonus_rate} min_dep=${sgd?.min_deposit} max_bonus=${sgd?.max_bonus}`);
  }

  // ── 2. SPORT category + providers + blacklist template 11 ───────────
  const detRes = await authedFetch(site, `/api/bo/promotion/${t.promoId}`, { method: 'GET' });
  const det = detRes?.data?.rows || detRes?.data || detRes;
  console.log(`  [2 SPORT] current cats=${JSON.stringify(det.promotion_category_ids)} bl=${det.blacklist_template_id}`);

  const dialog = await readDialogForPreservation(site, det.code || det.promo_code);
  const rawMerchants = Array.isArray(det.merchant_ids) ? det.merchant_ids.map((m) => (typeof m === 'object' ? m.id : m)) : [];
  const merchantIdsObj = {};
  rawMerchants.forEach((id, i) => { merchantIdsObj[String(i)] = id; });
  const dlObj = {};
  if (dialog) dlObj['0'] = dialog.fullRow ? { ...dialog.fullRow, promotion_id: t.promoId } : { id: dialog.id, promotion_id: t.promoId };

  const putBody = {
    id: det.id,
    code: det.code,
    name: det.name,
    bonus_settings: det.bonus_settings ?? 1,
    promo_type: det.promo_type,
    promo_sub_type: det.promo_sub_type,
    promotion_ids: [],
    valid_from: toYmdHis(det.valid_from),
    valid_to: toYmdHis(det.valid_to),
    validity: det.validity ?? 1,
    reward_validity: det.reward_validity ?? 1,
    frequency_type: det.frequency_type ?? 1,
    frequency: det.frequency ?? [],
    limit_transfer_out: det.limit_transfer_out ?? 0,
    limit_transfer_in: det.limit_transfer_in ?? 0,
    auto_unlock: det.auto_unlock ?? 1,
    allow_cancel: det.allow_cancel ?? 0,
    withdrawal_unlock: det.withdrawal_unlock ?? 0,
    auto_approve: det.auto_approve ?? 1,
    auto_reward_activation: det.auto_reward_activation ?? 0,
    recurring: det.recurring ?? 0,
    reset_frequency: det.reset_frequency || 1,
    reset_month: det.reset_month || 1,
    max_per_player: det.max_per_player ?? 1,
    daily_max: det.daily_max ?? 1,
    members_only: det.members_only ?? 0,
    fingerprint_check: det.fingerprint_check ?? 0,
    freespin_check: det.freespin_check ?? 0,
    allow_deposit: det.allow_deposit ?? 0,
    allow_continuous_claim: det.allow_continuous_claim ?? 0,
    message_template_id: det.message_template_id ?? 0,
    message_template_sms_id: det.message_template_sms_id ?? 0,
    bonus_rate: det.bonus_rate ?? 0,
    deposit_count: det.deposit_count ?? 0,
    active_period: det.active_period ?? 0,
    eligible_types: det.eligible_types ?? 1,
    deposit_status: det.last_deposit ? 4 : 1,
    free_spin_game_provider_id: det.free_spin_game_provider_id ?? 0,
    ...(det.free_spin_game_code != null ? { free_spin_game_code: det.free_spin_game_code } : {}),
    blacklist_template_id: 11, // "Live Casino and Sports Only"
    promotion_category_ids: NEW_CATEGORY_IDS,
    game_provider_codes: NEW_GAME_PROVIDER_CODES,
    target: {
      ...((Array.isArray(det.target) ? det.target[0] : det.target) || { type: 1, multiplier: '1.00' }),
      game_provider_codes: NEW_TARGET_CODES,
    },
    member_group_ids: det.member_group_ids ?? [],
    affiliate_group_ids: det.affiliate_group_ids ?? [],
    affiliate_ids: det.affiliate_ids ?? [],
    telemarketer_ids: det.telemarketer_ids ?? [],
    requires_email: det.requires_email ?? 0,
    requires_mobile: det.requires_mobile ?? 0,
    requires_dob: det.requires_dob ?? 0,
    requires_fullname: det.requires_fullname ?? 0,
    kyc_listing: det.kyc_listing ?? 0,
    // black_list_sub_categories OMITTED — server re-derives from blacklist_template_id
    // promotion_currency OMITTED — existing per-currency rows preserved
    merchant_ids: merchantIdsObj,
    dialog_popup_list: dlObj,
    status: det.status ?? 1,
  };

  if (DRY_RUN) {
    console.log(`  [2 SPORT] would PUT cats=${JSON.stringify(NEW_CATEGORY_IDS)} bl=11 providers=${Object.keys(PROVIDER_ID_MAP).join(',')} dialog=${dialog ? dialog.id : 'none'}`);
  } else {
    const putRes = await authedFetch(site, `/api/bo/promotion/${t.promoId}`, { method: 'PUT', body: putBody });
    const ok = putRes?.data?.rows?.id === t.promoId;
    console.log(`  [2 SPORT] PUT ${ok ? '✓' : '✗ unexpected response'}`);
    const verify = await authedFetch(site, `/api/bo/promotion/${t.promoId}`, { method: 'GET' });
    const vRow = verify?.data?.rows || verify?.data || verify;
    console.log(`  [2 SPORT] verify: cats=${JSON.stringify(vRow.promotion_category_ids)} bl=${vRow.blacklist_template_id} gps=${JSON.stringify(vRow.game_provider_codes)} status=${vRow.status}`);
  }

  // ── 3+4. MT: clause rewrite (EN+ZH) + SG_EN/SG_ZH locale blocks ──────
  const mtRes = await authedFetch(site, `/api/bo/messagetemplate/${t.mtId}`, { method: 'GET' });
  const mtRow = mtRes?.data?.rows || mtRes?.data || mtRes;
  const tpl = mtRow.message_template;
  const details = mtRow.message_details;
  const en = details['1'];
  const zh = details['3'];
  if (!en || !zh) { console.log('  [3 MT] ✗ missing MY_EN or MY_ZH block — skipping MT'); continue; }

  const fixClause = (msg, isZh) => {
    const oldC = isZh ? OLD_ZH : OLD_EN;
    const newC = isZh ? NEW_ZH : NEW_EN;
    if (msg.includes(oldC)) return { msg: msg.replace(oldC, newC), status: 'replaced' };
    if (msg.includes(newC)) return { msg, status: 'already updated' };
    return { msg, status: 'NOT FOUND' };
  };

  const enFix = fixClause(en.message, false);
  const zhFix = fixClause(zh.message, true);
  console.log(`  [3 MT] clause EN: ${enFix.status} | ZH: ${zhFix.status}`);
  if (enFix.status === 'NOT FOUND' || zhFix.status === 'NOT FOUND') {
    console.log('  [3 MT] ✗ aborted (unexpected content) — MT untouched');
    continue;
  }

  const hasSg = Boolean(details['6'] || details['7']);
  const newDetails = {
    '1': { settings_locale_id: 1, subject: en.subject, message: enFix.msg },
    '3': { settings_locale_id: 3, subject: zh.subject, message: zhFix.msg },
    '6': hasSg
      ? { settings_locale_id: 6, subject: details['6'].subject, message: fixClause(details['6'].message, false).msg }
      : { settings_locale_id: 6, subject: en.subject, message: enFix.msg.replaceAll('MYR', 'SGD') },
    '7': hasSg
      ? { settings_locale_id: 7, subject: details['7'].subject, message: fixClause(details['7'].message, true).msg }
      : { settings_locale_id: 7, subject: zh.subject, message: zhFix.msg.replaceAll('MYR', 'SGD') },
  };
  console.log(`  [4 MT] SG blocks: ${hasSg ? 'already present (clause-fixed only)' : 'adding SG_EN/SG_ZH (MYR→SGD)'}`);

  if (DRY_RUN) {
    console.log('  [MT] would PUT locales 1,3,6,7\n');
    continue;
  }

  const mtPut = await authedFetch(site, `/api/bo/messagetemplate/${t.mtId}`, {
    method: 'PUT',
    body: { name: tpl.name, section: Number(tpl.section), type: Number(tpl.type), status: tpl.status, details: newDetails },
  });
  console.log('  [MT] PUT:', String(JSON.stringify(mtPut?.data?.message ?? mtPut?.data ?? mtPut)).slice(0, 80));

  const mtVerify = await authedFetch(site, `/api/bo/messagetemplate/${t.mtId}`, { method: 'GET' });
  const vDetails = mtVerify?.data?.rows?.message_details || mtVerify?.data?.message_details || {};
  const localesOk = ['1', '3', '6', '7'].every((l) => vDetails[l]);
  const clauseOk = Object.entries(vDetails).every(([lid, d]) =>
    d.message.includes(lid === '3' || lid === '7' ? NEW_ZH : NEW_EN));
  const sgdOk = ['6', '7'].every((l) => vDetails[l] && !vDetails[l].message.includes('MYR') && vDetails[l].message.includes('SGD'));
  console.log(`  [MT] verify: locales(1,3,6,7)=${localesOk ? '✓' : '✗'} clause=${clauseOk ? '✓' : '✗'} SG uses SGD=${sgdOk ? '✓' : '✗'}\n`);
}
