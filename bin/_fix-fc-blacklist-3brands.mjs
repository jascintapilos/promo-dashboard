#!/usr/bin/env node
// Fix FC code blacklist exclusions on qpro5/15/16 to match qpro2 source.
// qpro7 is already correct (matches source). qpro16 FC codes have NO restriction
// (blacklist_id=null + 0 sub-cats); qpro5/15 have wrong template inherited.
//
// Approach (proven by canary on qpro16 FC228):
//   1. If target's blacklist_id != null: PUT promo with blacklist_id=null
//      (BO rejects updateblacklistgame while a template is inherited).
//   2. POST /api/bo/promotion/updateblacklistgame with source-matched exclusions.
//   3. Verify per-promo sub_cats now match source.

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const BRANDS = ['qpro5', 'qpro15', 'qpro16']; // qpro7 already correct
const FC_CODES = [
  'FT_TLEO_FC10_10X', 'FT_TLEO_FC48_10X', 'FT_TLEO_FC88_10X', 'FT_TLEO_FC138_10X',
  'FT_TLEO_FC228_10X', 'FT_TLEO_FC228_10X_BR', 'FT_TLEO_FC458_10X', 'FT_TLEO_FC458_10X_BR',
  'FT_TLEO_FC688_10X', 'FT_TLEO_FC888_10X', 'FT_TLEO_FC888_10X_BR', 'FT_TLEO_FC1088_10X',
];

const arrToObj = a => { const o={}; (a||[]).forEach((v,i)=>{o[String(i)]=v;}); return o; };
const fmtDate = d => d ? String(d).replace('T',' ').replace(/\.\d+Z?$/,'') : d;
const b01 = v => (v===true?1:v===false?0:v);
const sleep = ms => new Promise(r=>setTimeout(r,ms));

// QPRO PUT body — preserves everything; lets caller override blacklist_id (and dialog_popup_list if needed)
function buildQproPutBody(p, { blacklistIdOverride = undefined, dialogEntry = undefined } = {}) {
  const catTov = arrToObj((p.promotion_category||[]).filter(c=>c.target_type===1).map(c=>c.category_id));
  const targetObj = {};
  (p.target||[]).forEach((t,i)=>{ targetObj[String(i)] = { type: t.type, multiplier: t.multiplier, game_provider_ids: arrToObj(t.game_provider_ids||[]) }; });
  return {
    id: p.id, code: p.code, name: p.name,
    free_spin_game_provider_id: p.free_spin_game_provider_id ?? 0,
    ...(p.free_spin_game_code ? { free_spin_game_code: p.free_spin_game_code } : {}),
    promotion_category_turnover: catTov, promotion_category_winloss: [],
    promo_type: p.promo_type, promo_sub_type: Number(p.promo_sub_type), promotion_ids: [],
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
    ...(p.reset_frequency != null ? { reset_frequency: p.reset_frequency } : {}),
    auto_unlock: b01(p.auto_unlock), allow_cancel: p.allow_cancel,
    game_provider_ids: arrToObj(p.game_provider_ids||[]), target: targetObj,
    message_template_id: p.message_template_id ?? 0, message_template_sms_id: p.message_template_sms_id ?? 0,
    eligible_types: Number(p.eligible_types),
    affiliate_group_ids: [], telemarketer_ids: [], normal_account_manager_ids: [], vip_account_manager_ids: [],
    requires_email: p.requires_email ?? 0, requires_mobile: p.requires_mobile ?? 0,
    requires_dob: p.requires_dob ?? 0, requires_fullname: p.requires_fullname ?? 0,
    transfer_unlock: b01(p.transfer_unlock ?? 0),
    kyc_basic: p.kyc_basic ?? 1, kyc_advanced: p.kyc_advanced ?? 1, kyc_pro: p.kyc_pro ?? 1,
    blacklist_id: blacklistIdOverride !== undefined ? blacklistIdOverride : p.blacklist_id,
    black_list_sub_categories: [],
    currencies_ids: p.currencies_ids ?? [],
    dialog_popup_list: dialogEntry ? { '0': dialogEntry } : [],
  };
}

// 1) Load source qpro2 FC exclusions per code: code -> { provider_code -> Set<sub_cat_name> }
const s2 = getSite('qpro2');
const srcByCode = {};
for (const code of FC_CODES) {
  const r = await authedFetch(s2, `/api/bo/promotion?code=${code}&perPage=3`);
  const p = Object.values(r.data?.rows||{}).find(x=>x.code===code);
  if (!p) { console.log(`source ${code}: not found`); continue; }
  const d = (await authedFetch(s2, `/api/bo/promotion/${p.id}`)).data?.rows;
  const map = {};
  for (const e of (d.blacklist_sub_categories||[])) {
    const names = String(e.sub_category_name||'').split(',').map(s=>s.trim()).filter(Boolean);
    map[e.game_provider_code] = new Set(names.map(n=>n.toLowerCase()));
  }
  srcByCode[code] = { map, count: (d.blacklist_sub_categories||[]).length };
}
console.log(`Loaded source for ${Object.keys(srcByCode).length} FC codes\n`);

// 2) Per brand x code: clear template (if set) + apply exclusions
let ok=0, fail=0; const failures = [];
for (const brand of BRANDS) {
  const site = getSite(brand);
  const cats = Object.values((await authedFetch(site, '/api/bo/categories?perPage=500')).data?.rows||{}).map(c=>c.name).filter(n=>!/^(SHOW ALL|NEW MEMBER|APPS|WINNER|Test)$/i.test(n));
  console.log(`\n━━━ ${brand.toUpperCase()} ━━━`);
  for (const code of FC_CODES) {
    try {
      const src = srcByCode[code]; if (!src) { console.log(`  skip ${code}: no source`); continue; }
      const lr = await authedFetch(site, `/api/bo/promotion?code=${code}&perPage=3`);
      const lp = Object.values(lr.data?.rows||{}).find(x=>x.code===code);
      if (!lp) { console.log(`  ✗ ${code}: not found on ${brand}`); fail++; continue; }
      const det = (await authedFetch(site, `/api/bo/promotion/${lp.id}`)).data?.rows;
      // (a) clear blacklist_id if set — PRESERVE popup via list-row lookup
      if (det.blacklist_id) {
        let dialogEntry;
        const link = Array.isArray(lp.dialog_popup_list) ? lp.dialog_popup_list[0] : null;
        if (link?.popup_id) {
          const pr = await authedFetch(site, `/api/bo/popups/${link.popup_id}`).catch(()=>null);
          const pop = pr?.data?.rows || pr?.data || null;
          if (pop) dialogEntry = { id: pop.id, start_date: fmtDate(pop.start_date), end_date: null, promotion_id: lp.id, labelKey: `${pop.code} (${String(lp.name||'').slice(0,14)} . . . )`, code: pop.code };
        }
        const body = buildQproPutBody(det, { blacklistIdOverride: null, dialogEntry });
        await authedFetch(site, `/api/bo/promotion/${lp.id}`, { method: 'PUT', body });
        await sleep(100);
      }
      // (b) apply per-promo exclusions
      const bg = await authedFetch(site, '/api/bo/promotion/blacklistgame', {
        method: 'POST',
        body: { promotion_id: lp.id, game_provider_ids: det.game_provider_ids, categories: cats }
      });
      const rows = bg.data?.rows || [];
      let marked = 0;
      for (const row of rows) {
        const set = src.map[row.game_provider_code]; if (!set) continue;
        for (const sc of (row.sub_categories||[])) {
          if (set.has(String(sc.name).toLowerCase())) { sc.status = 1; marked++; }
        }
      }
      await authedFetch(site, '/api/bo/promotion/updateblacklistgame', { method: 'POST', body: { promotion_id: lp.id, black_list_sub_categories: rows }});
      await sleep(100);
      // (c) verify
      const v = (await authedFetch(site, `/api/bo/promotion/${lp.id}`)).data?.rows;
      const got = (v.blacklist_sub_categories || []).length;
      if (got === src.count && v.blacklist_id == null) {
        console.log(`  ✓ ${code} → blacklist_id=null sub_cats=${got} (src=${src.count})`);
        ok++;
      } else {
        console.log(`  ⚠ ${code} → blacklist_id=${v.blacklist_id} sub_cats=${got} (src=${src.count})`);
        fail++; failures.push(`${brand} ${code}: bt=${v.blacklist_id} sub=${got}/${src.count}`);
      }
    } catch (e) {
      console.error(`  ✗ ${code}: ${e.message.split('\n')[0]}`);
      fail++; failures.push(`${brand} ${code}: ${e.message.split('\n')[0]}`);
    }
  }
}
console.log(`\n=== SUMMARY ===  OK: ${ok}  Failed: ${fail}`);
if (failures.length) failures.forEach(f=>console.log('  ' + f));
