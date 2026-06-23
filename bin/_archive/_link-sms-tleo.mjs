#!/usr/bin/env node
// Link SMS message templates to TLEO Silver Slots codes on QPRO3/4/6/8/10
// and LC Bronze codes on QPRO2.
//
// Each brand already has PROMOTIONS.SMS.FT_REL_TLEO_GENERIC_BR — just link it.
// Preserves existing dialog_popup_list (read from list endpoint).

import { authedFetch, updatePromotion } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const arrayToIntObj = (arr) => Object.fromEntries(arr.map((id, i) => [String(i), id]));
const isoToYmdHms  = (iso)  => { const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/); return m ? `${m[1]} ${m[2]}` : iso; };
const nowYmdHms    = ()     => new Date().toISOString().slice(0,19).replace('T',' ');

// brand → { code → sms_mt_id to link, promo_id }
const TASKS = [
  // Silver Slots on QPRO3/4/6/8/10 — use brand-local GENERIC_BR SMS MT
  { brand: 'qpro3',  smsMtId: 453, codes: ['FT_REL_TLEO_45PCT_228MX','FT_REL_TLEO_45PCT_458MX'] },
  { brand: 'qpro4',  smsMtId: 376, codes: ['FT_REL_TLEO_45PCT_228MX','FT_REL_TLEO_45PCT_458MX'] },
  { brand: 'qpro6',  smsMtId: 575, codes: ['FT_REL_TLEO_45PCT_228MX','FT_REL_TLEO_45PCT_458MX'] },
  { brand: 'qpro8',  smsMtId: 617, codes: ['FT_REL_TLEO_45PCT_228MX','FT_REL_TLEO_45PCT_458MX'] },
  { brand: 'qpro10', smsMtId: 497, codes: ['FT_REL_TLEO_45PCT_228MX','FT_REL_TLEO_45PCT_458MX'] },
  // LC Bronze on QPRO2 — use QPRO2 GENERIC_BR SMS MT 352
  { brand: 'qpro2',  smsMtId: 352, codes: ['FT_REL_TLEO_LC_45PCT_138MX','FT_REL_TLEO_LC_45PCT_48MX'] },
];

for (const task of TASKS) {
  console.log(`\n${'━'.repeat(60)}\n  ${task.brand.toUpperCase()}\n${'━'.repeat(60)}`);
  const site = getSite(task.brand);

  for (const code of task.codes) {
    // 1. Fetch from list endpoint (exposes dialog_popup_list)
    const listRes = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=5`);
    const listRow = (listRes.data?.rows || []).find(r => r.code === code);
    if (!listRow) { console.log(`  ${code}: NOT FOUND`); continue; }
    const promoId = listRow.id;

    if (listRow.message_template_sms_id && listRow.message_template_sms_id !== 0) {
      console.log(`  ${code} (id=${promoId}): SKIP — already has sms_mt_id=${listRow.message_template_sms_id}`);
      continue;
    }

    // Preserve existing dialog_popup_list
    const existingDpl = listRow.dialog_popup_list?.[0];
    const dplBody = existingDpl?.popup_id ? {
      '0': {
        id: existingDpl.popup_id,
        start_date: existingDpl.start_date || nowYmdHms(),
        end_date: null,
        promotion_id: promoId,
        labelKey: existingDpl.code ? `${existingDpl.code} (Time Limited Ex . . . )` : '',
        code: existingDpl.code || '',
      },
    } : [];

    // 2. Read full promo detail
    const det = (await authedFetch(site, `/api/bo/promotion/${promoId}`)).data.rows;
    const gpIds = (det.target?.[0]?.game_provider_ids || []).map(Number);
    const catIds = (det.promotion_category || []).map(c => c.category_id);

    // 3. PUT with sms_mt_id set + all fields preserved
    const putBody = {
      code: det.code,
      name: det.name,
      free_spin_game_provider_id: det.free_spin_game_provider_id ?? 0,
      promotion_category_turnover: arrayToIntObj(catIds),
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
      game_provider_ids: arrayToIntObj(gpIds),
      target: { '0': {
        type: det.target?.[0]?.type ?? 3,
        multiplier: det.target?.[0]?.multiplier ?? 3,
        game_provider_ids: arrayToIntObj(gpIds),
      }},
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
      bonus_rate:   Number(det.bonus_rate) || 0,
      message_template_id: det.message_template_id || 0,
      message_template_sms_id: task.smsMtId,
      dialog_popup_list: dplBody,
    };

    await updatePromotion(site, promoId, putBody);
    console.log(`  ✓ ${code} (id=${promoId}) → sms_mt_id=${task.smsMtId} | dialog preserved=${!!existingDpl?.popup_id}`);
  }
}

// QC
console.log(`\n${'━'.repeat(70)}\n  QC\n${'━'.repeat(70)}`);
console.log('Brand'.padEnd(8) + 'Code'.padEnd(38) + 'ID'.padEnd(7) + 'Inbox MT'.padEnd(10) + 'SMS MT'.padEnd(10) + 'Dialog');
console.log('─'.repeat(80));
for (const task of TASKS) {
  const site = getSite(task.brand);
  for (const code of task.codes) {
    const listRes = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=5`);
    const row = (listRes.data?.rows || []).find(r => r.code === code);
    if (!row) { console.log(task.brand.padEnd(8) + code.padEnd(38) + 'NOT FOUND'); continue; }
    const det = (await authedFetch(site, `/api/bo/promotion/${row.id}`)).data.rows;
    const dpl = row.dialog_popup_list;
    const dlStr = (!dpl || dpl.length === 0) ? '(none)' : `p_id=${dpl[0].popup_id}`;
    console.log(
      task.brand.padEnd(8) + code.padEnd(38) + String(row.id).padEnd(7) +
      String(det.message_template_id).padEnd(10) + String(det.message_template_sms_id).padEnd(10) + dlStr
    );
  }
}
