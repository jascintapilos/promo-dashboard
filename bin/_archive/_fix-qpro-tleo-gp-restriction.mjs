#!/usr/bin/env node
// Restrict unrestricted TLEO codes on qpro3/4/6/8/10 to their game category.
//   LC codes   → 12-provider Live Casino set
//   Slot codes → 31-provider Slot set (PP excluded, PP2 + RG included — operator 2026-05-27)
// Provider sets are resolved to each brand's numeric IDs via /api/bo/gameprovider.
//
// SAFETY:
//   • QPRO PUT body preserves blacklist_id, message_template_id/sms, categories,
//     currencies (NOT re-sent — QPRO wipes them if sent), status, caps, etc.
//   • dialog_popup_list is RECONSTRUCTED (6-field shape) from the existing popup so
//     the PUT does not wipe the Login Popup (QPRO detail GET drops this field).
//   • only game_provider_ids + target[].game_provider_ids change.
//   • per-code verify: provider count == canonical, popup still linked, bt/mt/sms intact.
//
// Run: node bin/_fix-qpro-tleo-gp-restriction.mjs --dry-run
//      node bin/_fix-qpro-tleo-gp-restriction.mjs --limit=1     (canary one code)
//      node bin/_fix-qpro-tleo-gp-restriction.mjs               (all)

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const BRANDS = ['qpro3', 'qpro4', 'qpro6', 'qpro8', 'qpro10'];
const DRY = process.argv.includes('--dry-run');
const LIMIT = (() => { const a = process.argv.find(x => x.startsWith('--limit=')); return a ? Number(a.split('=')[1]) : Infinity; })();

const LC_CODES   = ['AG','BG','EVOK','EZ','MGP','PP','PP2','PTI','SA','SEXY','VIVO','WM'];
const SLOT_CODES = ['AG','AP','BNG','BOOM','BTG','CQ9','FC','FP','FS','HSG','JDB','JILI','JK','KA','LIVE','LUCKY','MAHA','MGP','MONKEY','NET2','NEXT','NLC','PNG','PP2','PTI','RG','RT2','SG','SIMPLE','XE','YB'];

function catOf(c){c=(c||'').toUpperCase();const lc=/LC/.test(c)||/LIVE/.test(c),sl=/SL/.test(c)||/SLOT/.test(c);if(lc&&sl)return'both';if(lc)return'lc';if(sl)return'slots';return'all';}
const arrToObj = a => { const o = {}; (a || []).forEach((v, i) => { o[String(i)] = v; }); return o; };
const fmtDate = d => d ? String(d).replace('T', ' ').replace(/\.\d+Z?$/, '') : d;
const b01 = v => (v === true ? 1 : v === false ? 0 : v);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function buildQproPutBody(p, gpIds, dialogEntry) {
  const catTov = arrToObj((p.promotion_category || []).filter(c => c.target_type === 1).map(c => c.category_id));
  const gpObj = arrToObj(gpIds);
  const targetObj = {};
  (p.target || []).forEach((t, i) => {
    targetObj[String(i)] = { type: t.type, multiplier: t.multiplier, game_provider_ids: gpObj };
  });
  return {
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
    ...(p.reset_frequency != null ? { reset_frequency: p.reset_frequency } : {}),
    auto_unlock: b01(p.auto_unlock), allow_cancel: p.allow_cancel,
    game_provider_ids: gpObj,
    target: targetObj,
    message_template_id: p.message_template_id ?? 0,
    message_template_sms_id: p.message_template_sms_id ?? 0,
    eligible_types: Number(p.eligible_types),
    affiliate_group_ids: [], telemarketer_ids: [],
    normal_account_manager_ids: [], vip_account_manager_ids: [],
    requires_email: p.requires_email ?? 0, requires_mobile: p.requires_mobile ?? 0,
    requires_dob: p.requires_dob ?? 0, requires_fullname: p.requires_fullname ?? 0,
    transfer_unlock: b01(p.transfer_unlock ?? 0),
    kyc_basic: p.kyc_basic ?? 1, kyc_advanced: p.kyc_advanced ?? 1, kyc_pro: p.kyc_pro ?? 1,
    blacklist_id: p.blacklist_id, black_list_sub_categories: [],
    currencies_ids: p.currencies_ids ?? [],
    dialog_popup_list: dialogEntry ? { '0': dialogEntry } : [],
  };
}

let totalOk = 0, totalFail = 0, totalSkip = 0;
const failures = [];

for (const brand of BRANDS) {
  const site = getSite(brand);
  console.log(`\n========== ${brand.toUpperCase()} ==========`);

  // catalog code→id
  const gpResp = await authedFetch(site, '/api/bo/gameprovider?perPage=300&page=1');
  const byCode = {}; Object.values(gpResp.data?.rows || {}).forEach(g => { byCode[g.code] = g.id; });
  const lcIds = LC_CODES.map(c => byCode[c]).filter(x => x !== undefined);
  const slIds = SLOT_CODES.map(c => byCode[c]).filter(x => x !== undefined);
  const lcMissing = LC_CODES.filter(c => byCode[c] === undefined);
  const slMissing = SLOT_CODES.filter(c => byCode[c] === undefined);
  if (lcMissing.length) console.log(`  ⚠ LC codes missing from catalog: ${lcMissing.join(',')}`);
  if (slMissing.length) console.log(`  ⚠ Slot codes missing from catalog: ${slMissing.join(',')}`);
  console.log(`  canonical: LC=${lcIds.length} ids, Slot=${slIds.length} ids`);

  // promo list (codes + dialog_popup_list + game_provider for universe)
  const listResp = await authedFetch(site, '/api/bo/promotion?code=FT_REL_TLEO&perPage=200&page=1');
  const list = Object.values(listResp.data?.rows || {}).filter(p => p.code?.includes('TLEO'));
  const uni = new Set(); list.forEach(p => (p.game_provider || '').split(',').map(s => s.trim()).filter(Boolean).forEach(x => uni.add(x)));
  const U = uni.size;
  // A code needs fixing if its provider CODE set != the canonical set for its
  // category (catches full-universe codes AND already-restricted codes that
  // still carry PP / lack PP2). Codes already matching canonical are skipped.
  const lcSet = new Set(LC_CODES.filter(c => byCode[c] !== undefined));
  const slSet = new Set(SLOT_CODES.filter(c => byCode[c] !== undefined));
  const setEq = (a, b) => { if (a.size !== b.size) return false; for (const x of a) if (!b.has(x)) return false; return true; };
  const broken = list.filter(p => {
    const cat = catOf(p.category);
    if (cat !== 'lc' && cat !== 'slots') return false;
    const cur = new Set((p.game_provider || '').split(',').map(s => s.trim()).filter(Boolean));
    return !setEq(cur, cat === 'lc' ? lcSet : slSet);
  });

  // popups catalog id→{code,start_date,title}
  const popMap = new Map();
  for (let pg = 1; pg <= 6; pg++) {
    const pr = await authedFetch(site, `/api/bo/popups?perPage=300&page=${pg}`);
    const arr = Object.values(pr.data?.rows || {});
    if (!arr.length) break;
    arr.forEach(p => popMap.set(p.id, p));
  }

  console.log(`  universe=${U}  broken codes to fix: ${broken.length}`);

  let processed = 0;
  for (const lp of broken) {
    if (processed >= LIMIT) { console.log(`  (limit ${LIMIT} reached for ${brand})`); break; }
    const cat = catOf(lp.category);
    if (cat !== 'lc' && cat !== 'slots') { console.log(`  skip ${lp.code} (cat=${cat})`); totalSkip++; continue; }
    const gpIds = cat === 'lc' ? lcIds : slIds;

    // reconstruct dialog entry from existing popup
    const dpList = Array.isArray(lp.dialog_popup_list) ? lp.dialog_popup_list : [];
    let dialogEntry = null;
    if (dpList.length) {
      const popupId = dpList[0].popup_id;
      const pop = popMap.get(popupId);
      if (pop) {
        const title = (pop.contents?.[0]?.title) || pop.label || '';
        dialogEntry = { id: pop.id, start_date: fmtDate(pop.start_date), end_date: null, promotion_id: lp.id, labelKey: `${pop.code} (${String(title).slice(0, 14)} . . . )`, code: pop.code };
      } else {
        console.log(`  ⚠ ${lp.code}: popup ${popupId} not in catalog — popup link cannot be reconstructed; SKIP to avoid wipe`);
        totalSkip++; continue;
      }
    }

    const detail = await authedFetch(site, `/api/bo/promotion/${lp.id}`);
    const p = detail.data?.rows;
    const curCount = (p.game_provider_ids || []).length;

    if (DRY) {
      console.log(`  DRY ${lp.code} [${cat}] ${curCount} → ${gpIds.length} ids; popup=${dialogEntry ? `keep ${dialogEntry.code}` : 'none'}; bt=${p.blacklist_id} mt=${p.message_template_id} sms=${p.message_template_sms_id}`);
      totalOk++; processed++; continue;
    }

    try {
      const body = buildQproPutBody(p, gpIds, dialogEntry);
      await authedFetch(site, `/api/bo/promotion/${lp.id}`, { method: 'PUT', body });
      await sleep(150);
      // verify
      const vl = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(lp.code)}&perPage=10&page=1`);
      const vrow = Object.values(vl.data?.rows || {}).find(x => x.id === lp.id);
      const vCount = (vrow.game_provider || '').split(',').map(s => s.trim()).filter(Boolean).length;
      const vDp = Array.isArray(vrow.dialog_popup_list) ? vrow.dialog_popup_list.length > 0 : false;
      const vd = (await authedFetch(site, `/api/bo/promotion/${lp.id}`)).data?.rows;
      const btOk = vd.blacklist_id === p.blacklist_id, mtOk = vd.message_template_id === p.message_template_id, smsOk = vd.message_template_sms_id === p.message_template_sms_id;
      const popOk = dialogEntry ? vDp : true;
      const cntOk = vCount === gpIds.length;
      console.log(`  ${cntOk && popOk && btOk && mtOk && smsOk ? '✓' : '✗'} ${lp.code} [${cat}] gp ${curCount}→${vCount}/${gpIds.length} popup=${vDp} bt=${vd.blacklist_id} mt=${vd.message_template_id} sms=${vd.message_template_sms_id}`);
      if (cntOk && popOk && btOk && mtOk && smsOk) { totalOk++; } else { totalFail++; failures.push(`${brand} ${lp.code} (cnt=${cntOk} pop=${popOk} bt=${btOk} mt=${mtOk} sms=${smsOk})`); }
    } catch (e) {
      console.error(`  ✗ ${lp.code} ERROR: ${e.message.split('\n')[0]}`);
      totalFail++; failures.push(`${brand} ${lp.code}: ${e.message.split('\n')[0]}`);
    }
    processed++;
  }
}

console.log(`\n=== SUMMARY ===  OK: ${totalOk}  Failed: ${totalFail}  Skipped: ${totalSkip}${DRY ? '  (DRY RUN)' : ''}`);
if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  ' + f)); }
