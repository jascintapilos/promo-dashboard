#!/usr/bin/env node
// Re-link the orphaned popups on qpro5/7/15/16: 42 reload codes per brand have
// dialog_popup_list empty even though the popup exists (matched by label==code).
// Uses the proven buildQproPutBody shape from _add-dialog-popup-tleo.mjs
// (which worked on 225/225 earlier brands) — the mapper's buildUpdate silently
// dropped dialog_popup_list for reload codes.

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const BRANDS = ['qpro5', 'qpro7', 'qpro15', 'qpro16'];

const arrToObj = a => { const o = {}; (a || []).forEach((v, i) => { o[String(i)] = v; }); return o; };
const fmtDate = d => d ? String(d).replace('T', ' ').replace(/\.\d+Z?$/, '') : d;
const b01 = v => (v === true ? 1 : v === false ? 0 : v);
const hasPopup = p => { const d = p.dialog_popup_list; return Array.isArray(d) ? d.length > 0 : (d && Object.keys(d || {}).length > 0); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function buildQproPutBody(p, dialogEntry) {
  const catTov = arrToObj((p.promotion_category || []).filter(c => c.target_type === 1).map(c => c.category_id));
  const targetObj = {};
  (p.target || []).forEach((t, i) => { targetObj[String(i)] = { type: t.type, multiplier: t.multiplier, game_provider_ids: arrToObj(t.game_provider_ids || []) }; });
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
    game_provider_ids: arrToObj(p.game_provider_ids || []), target: targetObj,
    message_template_id: p.message_template_id ?? 0,
    message_template_sms_id: p.message_template_sms_id ?? 0,
    eligible_types: Number(p.eligible_types),
    affiliate_group_ids: [], telemarketer_ids: [], normal_account_manager_ids: [], vip_account_manager_ids: [],
    requires_email: p.requires_email ?? 0, requires_mobile: p.requires_mobile ?? 0,
    requires_dob: p.requires_dob ?? 0, requires_fullname: p.requires_fullname ?? 0,
    transfer_unlock: b01(p.transfer_unlock ?? 0),
    kyc_basic: p.kyc_basic ?? 1, kyc_advanced: p.kyc_advanced ?? 1, kyc_pro: p.kyc_pro ?? 1,
    blacklist_id: p.blacklist_id, black_list_sub_categories: [],
    currencies_ids: p.currencies_ids ?? [],
    dialog_popup_list: dialogEntry ? { '0': dialogEntry } : [],
  };
}

let totalOk = 0, totalFail = 0; const failures = [];

for (const brand of BRANDS) {
  const site = getSite(brand);
  console.log(`\n━━━ ${brand.toUpperCase()} ━━━`);
  // promos
  const r = await authedFetch(site, '/api/bo/promotion?code=TLEO&perPage=200&page=1');
  const all = Object.values(r.data?.rows || {}).filter(p => p.code?.includes('TLEO'));
  const unlinked = all.filter(p => !hasPopup(p));
  // popups by label
  const labelToPopup = new Map();
  for (let pg = 1; pg <= 6; pg++) {
    const pr = await authedFetch(site, `/api/bo/popups?perPage=300&page=${pg}`);
    const arr = Object.values(pr.data?.rows || {});
    if (!arr.length) break;
    arr.forEach(p => { if (p.label) labelToPopup.set(p.label, p); });
    if (arr.length < 300) break;
  }
  console.log(`  unlinked: ${unlinked.length}  popups loaded: ${labelToPopup.size}`);

  for (const lp of unlinked) {
    const pop = labelToPopup.get(lp.code);
    if (!pop) { console.log(`  ✗ ${lp.code}: no popup with matching label`); totalFail++; failures.push(`${brand} ${lp.code}: no popup`); continue; }
    try {
      const det = (await authedFetch(site, `/api/bo/promotion/${lp.id}`)).data?.rows;
      const dialogEntry = { id: pop.id, start_date: fmtDate(pop.start_date), end_date: null, promotion_id: lp.id, labelKey: `${pop.code} (${String(lp.name||'').slice(0, 14)} . . . )`, code: pop.code };
      const body = buildQproPutBody(det, dialogEntry);
      await authedFetch(site, `/api/bo/promotion/${lp.id}`, { method: 'PUT', body });
      await sleep(120);
      // verify
      const vl = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(lp.code)}&perPage=5`);
      const vrow = Object.values(vl.data?.rows || {}).find(x => x.id === lp.id);
      if (hasPopup(vrow)) { console.log(`  ✓ ${lp.code} → popup ${pop.id}`); totalOk++; }
      else { console.log(`  ⚠ ${lp.code}: PUT OK but popup still not linked in list`); totalFail++; failures.push(`${brand} ${lp.code}: verify`); }
    } catch (e) { console.error(`  ✗ ${lp.code} ERROR: ${e.message.split('\n')[0]}`); totalFail++; failures.push(`${brand} ${lp.code}: ${e.message.split('\n')[0]}`); }
  }
}
console.log(`\n=== SUMMARY ===  OK: ${totalOk}  Failed: ${totalFail}`);
if (failures.length) failures.forEach(f => console.log('  ' + f));
