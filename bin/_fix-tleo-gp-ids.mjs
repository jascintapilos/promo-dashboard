#!/usr/bin/env node
// Re-PUT all 50 QPRO TLEO saves to set target.0.game_provider_ids to the
// source-faithful list (12 LC providers or 31-32 Slot providers).
//
// Why: the initial replication run set gp_ids correctly on POST, but the
// follow-up PUT (built by api-mapper-qpro.buildUpdate) re-ran the mapper with
// the default Layer-1-excluded list (~54 providers), overwriting the override.
// This script reads each saved promo and PUTs back with the right gp_ids and
// preserves message_template_id.

import fs from 'node:fs';
import { authedFetch, findPromotionByCode, updatePromotion } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const CODES = [
  'FT_REL_TLEO_LC_20PCT_20MX_BR',
  'FT_REL_TLEO_LC_20PCT_300MX_BR',
  'FT_REL_TLEO_LC_20PCT_400MX_BR',
  'FT_REL_TLEO_20PCT_300MX_BR',
  'FT_REL_TLEO_20PCT_400MX_BR',
  'FT_REL_TLEO_LC_45PCT_138MX',
  'FT_REL_TLEO_LC_45PCT_228MX_BR',
  'FT_REL_TLEO_LC_45PCT_458MX_BR',
  'FT_REL_TLEO_45PCT_688MX',
  'FT_REL_TLEO_45PCT_888MX',
];

const BRANDS = ['qpro3', 'qpro4', 'qpro6', 'qpro8', 'qpro10'];

const raw = JSON.parse(fs.readFileSync('tmp/tleo-raw.json', 'utf8'));
const sourceCat = JSON.parse(fs.readFileSync('tmp/qpro2-catalog.json', 'utf8'));
const targetCats = JSON.parse(fs.readFileSync('tmp/target-catalogs.json', 'utf8'));

function mapGpIdsToTarget(sourceGpIds, targetId) {
  const targetCat = targetCats[targetId];
  const resolved = [];
  for (const id of sourceGpIds) {
    const srcProvider = sourceCat.providers_by_id[id];
    if (!srcProvider) continue;
    const code = String(srcProvider.code || '').toUpperCase();
    const targetEntry = targetCat.providers_by_code[code];
    if (!targetEntry) continue;
    resolved.push(targetEntry.id);
  }
  return resolved.sort((a, b) => a - b);
}

const arrayToIntObj = (arr) => Object.fromEntries(arr.map((id, i) => [String(i), id]));

const results = {};
for (const brandId of BRANDS) {
  console.log(`\n━━━ ${brandId} ━━━`);
  results[brandId] = {};
  const site = getSite(brandId);
  for (const code of CODES) {
    try {
      const sourceData = raw[code];
      const sourceGpIds = sourceData.main.target?.[0]?.game_provider_ids || [];
      const targetGpIds = mapGpIdsToTarget(sourceGpIds, brandId);

      // Find the saved promo
      const row = await findPromotionByCode(site, code);
      if (!row) { results[brandId][code] = { status: 'not_found' }; continue; }
      const promoId = row.id;
      // Fetch full detail to get the current PUT body shape
      const detRes = await authedFetch(site, `/api/bo/promotion/${promoId}`);
      const det = detRes.data.rows;
      // Build a minimal PUT body that ONLY overrides gp_ids — keep everything else
      // as-is. We have to re-emit the full POST shape since the BO replaces the
      // record on PUT. Build it from current detail.
      const target = det.target?.[0] || {};
      const newTarget = {
        '0': {
          type: target.type ?? 1,
          multiplier: target.multiplier ?? 0,
          game_provider_ids: arrayToIntObj(targetGpIds),
        },
      };
      // Pull current MT link to preserve it
      const messageTemplateId = det.message_template_id || null;

      // ISO -> Y-m-d H:i:s for PUT (BO rejects ISO format with .000000Z suffix)
      const isoToYmdHms = (iso) => {
        if (!iso) return iso;
        const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
        return m ? `${m[1]} ${m[2]}` : iso;
      };
      const putBody = {
        code: det.code,
        name: det.name,
        free_spin_game_provider_id: det.free_spin_game_provider_id ?? 0,
        promotion_category_turnover: arrayToIntObj((det.promotion_category || []).map((c) => c.category_id)),
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
        game_provider_ids: arrayToIntObj(targetGpIds),
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
        message_template_id: messageTemplateId,
        // Do NOT re-emit promotion_currency (memory rule: QPRO PUT must NOT re-send it)
        // dialog_popup_list omitted (no popups linked)
        // blacklist_template_id omitted (silently dropped on PUT anyway)
      };

      await updatePromotion(site, promoId, putBody);
      console.log(`  ✓ ${code} id=${promoId}: gp_ids ${(det.target?.[0]?.game_provider_ids?.length || 0)} → ${targetGpIds.length}`);
      results[brandId][code] = { status: 'fixed', id: promoId, gp_count_before: det.target?.[0]?.game_provider_ids?.length || 0, gp_count_after: targetGpIds.length };
    } catch (e) {
      console.log(`  ✗ ${code}: ${e.message.slice(0, 300)}`);
      results[brandId][code] = { status: 'error', error: String(e.message) };
    }
  }
}

fs.writeFileSync('tmp/tleo-fix-gp.json', JSON.stringify(results, null, 2));
console.log('\nWrote tmp/tleo-fix-gp.json');
