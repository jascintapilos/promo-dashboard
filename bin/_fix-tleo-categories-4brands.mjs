#!/usr/bin/env node
// Populate promotion_category on all 54 TLEO codes × 4 brands (qpro5/7/15/16).
// The BO Edit modal renders Game Categories / Game Providers sections empty when
// promotion_category is []. Source qpro2 also has this (data pre-existing); but
// for the new brands we want the UI to render correctly.
//
// Category mapping (LC=2, SL=3 — verified same on all 4 brands):
//   lc    → [LC]
//   slots → [SL]
//   both  → [LC, SL]
//
// Source-of-truth: blacklist_name on qpro2 source ("Live Casino only" / "Slots
// Only" / "Live Casino and Slot"). Falls back to code-pattern matching.
//
// Preserves everything else via buildQproPutBody (proven shape used in popup
// re-link + FC blacklist fix scripts).

import fs from 'node:fs';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const BRANDS = ['qpro5', 'qpro7', 'qpro15', 'qpro16'];
const CAT_LC = 2, CAT_SL = 3;

// Optional canary: pass --canary to run only on 3 codes (LC, Slots, FC) on qpro16
const isCanary = process.argv.includes('--canary');
// Canary: pick one code with linked popup to verify popup preservation
const CANARY_CODES = ['FT_REL_TLEO_LC_45PCT_48MX'];
const CANARY_BRANDS = ['qpro16'];

const SOURCE = JSON.parse(fs.readFileSync('tmp/qpro2-tleo-source.json', 'utf8'));

function classifyCategory(code, src) {
  const bn = (src?.blacklist_name || '').toLowerCase();
  if (bn === 'live casino only') return 'lc';
  if (bn === 'slots only') return 'slots';
  if (bn.includes('live casino and slot') || bn.includes('slot and live casino')) return 'both';
  // code-pattern fallback
  if (/_FC\d/.test(code)) return 'both';        // FC = Slot + LC
  if (/_LC(_|$)/.test(code) || /_LC_BR$/.test(code)) return 'lc';
  if (/_SL(_|OT|T_|$)|_SLOT$|_SLOT_/.test(code)) return 'slots';
  return null;
}

const arrToObj = a => { const o = {}; (a || []).forEach((v, i) => { o[String(i)] = v; }); return o; };
const fmtDate = d => d ? String(d).replace('T', ' ').replace(/\.\d+Z?$/, '') : d;
const b01 = v => (v === true ? 1 : v === false ? 0 : v);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hasPopup = p => { const d = p.dialog_popup_list; return Array.isArray(d) ? d.length > 0 : (d && Object.keys(d || {}).length > 0); };

// Same shape as proven scripts — but accepts an override for promotion_category_turnover
// dialogEntry is fully-formed entry (id, code, start_date, etc.) or null
function buildQproPutBody(p, { catIds = null, dialogEntry = null } = {}) {
  // catIds = array of category_ids to set (target_type=1). If null, preserve existing.
  const catTov = catIds != null ? arrToObj(catIds) : arrToObj((p.promotion_category || []).filter(c => c.target_type === 1).map(c => c.category_id));
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
    message_template_id: p.message_template_id ?? 0, message_template_sms_id: p.message_template_sms_id ?? 0,
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

const brands = isCanary ? CANARY_BRANDS : BRANDS;
let ok = 0, fail = 0, skip = 0; const failures = [];

for (const brand of brands) {
  const site = getSite(brand);
  console.log(`\n━━━ ${brand.toUpperCase()} ━━━`);
  const r = await authedFetch(site, '/api/bo/promotion?code=TLEO&perPage=200&page=1');
  let list = Object.values(r.data?.rows || {}).filter(p => p.code?.includes('TLEO'));
  if (isCanary) list = list.filter(p => CANARY_CODES.includes(p.code));

  // Pre-load brand's popups (need code+start_date for dialogEntry) — list endpoint
  // returns dialog_popup_list with popup_id only.
  const popById = new Map();
  for (let pg = 1; pg <= 6; pg++) {
    const pr = await authedFetch(site, `/api/bo/popups?perPage=300&page=${pg}`);
    const arr = Object.values(pr.data?.rows || {});
    if (!arr.length) break;
    arr.forEach(p => popById.set(p.id, p));
    if (arr.length < 300) break;
  }
  console.log(`  loaded ${popById.size} popups`);

  for (const lp of list) {
    const src = SOURCE[lp.code];
    if (!src) { console.log(`  ⊘ ${lp.code}: no source — skip`); skip++; continue; }
    const cat = classifyCategory(lp.code, src);
    if (!cat) { console.log(`  ⊘ ${lp.code}: cannot classify — skip`); skip++; continue; }
    const catIds = cat === 'lc' ? [CAT_LC] : cat === 'slots' ? [CAT_SL] : [CAT_LC, CAT_SL];
    try {
      const det = (await authedFetch(site, `/api/bo/promotion/${lp.id}`)).data?.rows;
      const existing = (det.promotion_category || []).filter(c => c.target_type === 1).map(c => c.category_id).sort();
      const want = [...catIds].sort();
      if (existing.length === want.length && existing.every((v, i) => v === want[i])) {
        console.log(`  ✓ ${lp.code} [${cat}]: already set [${existing.join(',')}]`);
        ok++; continue;
      }
      // Resolve dialogEntry from list-row's dialog_popup_list (detail doesn't return it)
      let dialogEntry = null;
      const listLink = Array.isArray(lp.dialog_popup_list) ? lp.dialog_popup_list[0] : null;
      if (listLink?.popup_id) {
        const pop = popById.get(listLink.popup_id);
        if (pop) {
          dialogEntry = { id: pop.id, start_date: fmtDate(pop.start_date), end_date: null, promotion_id: lp.id, labelKey: `${pop.code} (${String(lp.name||'').slice(0,14)} . . . )`, code: pop.code };
        }
      }
      const body = buildQproPutBody(det, { catIds, dialogEntry });
      await authedFetch(site, `/api/bo/promotion/${lp.id}`, { method: 'PUT', body });
      await sleep(120);
      // verify via list (popup link only visible in list)
      const vl = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(lp.code)}&perPage=5`);
      const vlRow = Object.values(vl.data?.rows||{}).find(x => x.id === lp.id);
      const v = (await authedFetch(site, `/api/bo/promotion/${lp.id}`)).data?.rows;
      const got = (v.promotion_category || []).filter(c => c.target_type === 1).map(c => c.category_id).sort();
      const hadPopup = !!dialogEntry;
      const hasPopupNow = hasPopup(vlRow);
      const popupOk = hadPopup ? hasPopupNow : true;
      if (got.length === want.length && got.every((id, i) => id === want[i]) && popupOk) {
        console.log(`  ✓ ${lp.code} [${cat}] → cat=[${got.join(',')}] gp=${(v.game_provider_ids||[]).length} popup=${hasPopupNow?'Y':'N'}${hadPopup?'':' (none)'}`);
        ok++;
      } else {
        console.log(`  ⚠ ${lp.code} [${cat}] → cat=[${got.join(',')}] want=[${want.join(',')}] popupOk=${popupOk} (had=${hadPopup} has=${hasPopupNow})`);
        fail++; failures.push(`${brand} ${lp.code}: got=[${got.join(',')}] want=[${want.join(',')}] popupOk=${popupOk}`);
      }
    } catch (e) {
      console.error(`  ✗ ${lp.code} ERROR: ${e.message.split('\n')[0]}`);
      fail++; failures.push(`${brand} ${lp.code}: ${e.message.split('\n')[0]}`);
    }
  }
}
console.log(`\n=== SUMMARY ===  OK: ${ok}  Failed: ${fail}  Skipped: ${skip}`);
if (failures.length) failures.forEach(f => console.log('  ' + f));
