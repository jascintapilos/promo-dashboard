#!/usr/bin/env node
// Fix TLEO promotions on QPRO + QP2:
//   1. Set correct blacklist_template_id based on catType (all/lc/slots)
//   2. For slots-only codes: remove PP from game_provider_ids (keep PP2 only)
//
// catType rules:
//   /_LC_/ or /_LC$/        → lc   → "Live Casino Only" template
//   /_SL_/ or /_SLOT$/ etc  → slots → "Slots Only" template; remove PP from gp
//   else                    → all   → "Slots, Live Casino, Sports" template
//
// QPRO: blacklist endpoint /api/bo/blacklist works; resolved dynamically per brand.
// QP2:  blacklist endpoint 404. Mapping from probe: all=5, lc=3, slots=6? TBD.
//       For now: attempt to set bt on PUT body + fix game_provider_codes.

import { authedFetch, getAllGameProviders } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { resolveBlacklistTemplateId } from '../src/blacklist-template.js';

const QPRO_SITES = ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10'];

// ── helpers ───────────────────────────────────────────────────────────────────

function catType(code) {
  if (/_LC_/.test(code) || /_LC$/.test(code)) return 'lc';
  if (/_SL_/.test(code) || /_SLOT_/.test(code) || /_SLOT$/.test(code)) return 'slots';
  return 'all';
}

function fmtDate(d) {
  if (!d) return d;
  return String(d).replace('T', ' ').replace(/\.\d+Z?$/, '');
}

function arrToObj(arr) {
  const o = {};
  (arr || []).forEach((v, i) => { o[String(i)] = v; });
  return o;
}

// Resolve blacklist_template_id for QPRO (throws if no match found)
async function resolveQproBt(site, cat) {
  if (cat === 'lc')    return resolveBlacklistTemplateId(site, { categoryNames: ['LIVE CASINO'], isFs: false });
  if (cat === 'slots') return resolveBlacklistTemplateId(site, { categoryNames: [], isFs: true });
  return resolveBlacklistTemplateId(site, { categoryNames: ['SLOTS', 'LIVE CASINO', 'SPORT'], isFs: false });
}

// Build QPRO promotion PUT body from GET detail + new blacklist_template_id + fixed gpIds
function buildQproPutBody(p, newBtId, newGpIds) {
  const gpIds  = newGpIds ?? p.game_provider_ids ?? [];
  const catTov = arrToObj(
    (p.promotion_category || []).filter(c => c.target_type === 1).map(c => c.category_id)
  );
  const targetObj = {};
  (p.target || []).forEach((t, i) => {
    targetObj[String(i)] = {
      type:              t.type,
      multiplier:        t.multiplier,
      game_provider_ids: arrToObj(t.game_provider_ids || []),
    };
  });
  const b01 = v => (v === true ? 1 : v === false ? 0 : v);
  return {
    id:    p.id,
    code:  p.code,
    name:  p.name,
    free_spin_game_provider_id: p.free_spin_game_provider_id ?? 0,
    ...(p.free_spin_game_code ? { free_spin_game_code: p.free_spin_game_code } : {}),
    promotion_category_turnover: catTov,
    promotion_category_winloss:  [],
    promo_type:     p.promo_type,
    promo_sub_type: Number(p.promo_sub_type),
    promotion_ids:  [],
    valid_from:     fmtDate(p.valid_from),
    validity:       p.validity,
    reward_validity: p.reward_validity,
    frequency:      p.frequency ?? [],
    frequency_type: Number(p.frequency_type),
    first_deposit:  p.first_deposit ?? 0,
    member_group_ids: [],
    last_deposit:   b01(p.last_deposit ?? 0),
    auto_approve:   b01(p.auto_approve),
    visible_by_affiliate: p.visible_by_affiliate ?? 0,
    recurring:      Number(p.recurring),
    max_per_player: p.max_per_player,
    daily_max:      p.daily_max,
    status:         p.status ?? 1,
    limit_transfer_in:  b01(p.limit_transfer_in ?? 0),
    limit_transfer_out: b01(p.limit_transfer_out ?? 0),
    restrict_claim_round_active:   b01(p.restrict_claim_round_active ?? 0),
    restrict_same_provider_launch: b01(p.restrict_same_provider_launch ?? 0),
    bonus_rate: p.bonus_rate != null ? String(Number(p.bonus_rate).toFixed(2)) : undefined,
    ...(p.reset_frequency != null ? { reset_frequency: p.reset_frequency } : {}),
    auto_unlock:  b01(p.auto_unlock),
    allow_cancel: p.allow_cancel,
    game_provider_ids: arrToObj(gpIds),
    target: targetObj,
    message_template_id:     p.message_template_id ?? 0,
    message_template_sms_id: p.message_template_sms_id ?? 0,
    eligible_types: Number(p.eligible_types),
    affiliate_group_ids:        [],
    telemarketer_ids:           [],
    normal_account_manager_ids: [],
    vip_account_manager_ids:    [],
    requires_email:    p.requires_email ?? 0,
    requires_mobile:   p.requires_mobile ?? 0,
    requires_dob:      p.requires_dob ?? 0,
    requires_fullname: p.requires_fullname ?? 0,
    transfer_unlock:   b01(p.transfer_unlock ?? 0),
    kyc_basic:    p.kyc_basic ?? 1,
    kyc_advanced: p.kyc_advanced ?? 1,
    kyc_pro:      p.kyc_pro ?? 1,
    blacklist_id:            newBtId,   // GET/PUT field is blacklist_id
    black_list_sub_categories: [],
    currencies_ids: p.currencies_ids ?? [],
    // NOTE: do NOT include promotion_currency — PUT wipes non-MYR rows
  };
}

// ── QPRO fix ─────────────────────────────────────────────────────────────────

const report = [];
let totalSaved = 0, totalErrors = 0;

for (const siteId of QPRO_SITES) {
  const site = getSite(siteId);
  console.log(`\n=== ${siteId} ===`);

  // Get PP and PP2 IDs for this brand (for slots fix)
  let ppId = null, pp2Id = null;
  try {
    const { rows: gps } = await getAllGameProviders(site);
    ppId  = gps.find(g => g.code === 'PP')?.id  ?? null;
    pp2Id = gps.find(g => g.code === 'PP2')?.id ?? null;
    console.log(`  PP=${ppId}  PP2=${pp2Id}`);
  } catch (e) {
    console.warn(`  WARN: could not resolve PP/PP2 IDs: ${e.message}`);
  }

  // Cache blacklist template IDs per catType for this site
  const btCache = {};

  // Fetch all TLEO promos
  let tleo = [];
  try {
    const r = await authedFetch(site, '/api/bo/promotion?code=FT_REL_TLEO&perPage=200&page=1');
    const rows = r.data?.rows || [];
    tleo = (Array.isArray(rows) ? rows : Object.values(rows)).filter(p => p.code?.includes('TLEO'));
  } catch (e) {
    console.error(`  ERROR fetching promos: ${e.message}`);
    continue;
  }
  console.log(`  Found ${tleo.length} TLEO promos`);

  for (const promo of tleo) {
    const cat = catType(promo.code);

    // Resolve blacklist_template_id (cached)
    if (!btCache[cat]) {
      try {
        btCache[cat] = await resolveQproBt(site, cat);
      } catch (e) {
        console.error(`  ERROR resolving BT for cat=${cat}: ${e.message}`);
        btCache[cat] = null;
      }
    }
    const newBtId = btCache[cat];
    if (newBtId === null) {
      console.error(`  SKIP ${promo.code} — no blacklist template for cat=${cat}`);
      report.push({ siteId, pid: promo.id, code: promo.code, cat, status: 'NO_BT' });
      totalErrors++;
      continue;
    }

    // GET full promo detail
    let p;
    try {
      const r = await authedFetch(site, `/api/bo/promotion/${promo.id}`);
      p = r.data?.rows;
    } catch (e) {
      console.error(`  ERROR fetching pid=${promo.id}: ${e.message}`);
      report.push({ siteId, pid: promo.id, code: promo.code, cat, status: `FETCH_ERR:${e.message.split('\n')[0]}` });
      totalErrors++;
      continue;
    }

    // For slots: remove PP from game_provider_ids
    let newGpIds = null;
    let gpChange = '';
    if (cat === 'slots' && ppId !== null) {
      const currentGp = p.game_provider_ids || [];
      const hadPP = currentGp.includes(ppId);
      const hadPP2 = currentGp.includes(pp2Id);
      if (hadPP) {
        newGpIds = currentGp.filter(id => id !== ppId);
        gpChange = `removed PP(${ppId})${!hadPP2 && pp2Id ? '; PP2 not in list!' : ''}`;
      } else {
        gpChange = 'PP not in gp_ids (ok)';
      }
    }

    // Also update target[].game_provider_ids for slots
    if (cat === 'slots' && ppId !== null && newGpIds !== null) {
      // patch target entries too
      p.target = (p.target || []).map(t => ({
        ...t,
        game_provider_ids: (t.game_provider_ids || []).filter(id => id !== ppId),
      }));
    }

    // Check if update needed  (GET field is blacklist_id, not blacklist_template_id)
    const currentBtId = p.blacklist_id;
    const btChanged = currentBtId !== newBtId;
    const gpChanged = newGpIds !== null;

    if (!btChanged && !gpChanged) {
      console.log(`  OK   ${promo.code} (pid=${promo.id}) cat=${cat} bt=${currentBtId} ← no change needed`);
      report.push({ siteId, pid: promo.id, code: promo.code, cat, status: 'OK_NO_CHANGE', bt: currentBtId });
      continue;
    }

    // Build PUT body
    const putBody = buildQproPutBody(p, newBtId, newGpIds);

    // PUT
    try {
      await authedFetch(site, `/api/bo/promotion/${promo.id}`, {
        method: 'PUT',
        body: putBody,
      });
      const changes = [btChanged ? `bt:${currentBtId}→${newBtId}` : '', gpChange].filter(Boolean).join(', ');
      console.log(`  ✓    ${promo.code} (pid=${promo.id}) cat=${cat} [${changes}]`);
      report.push({ siteId, pid: promo.id, code: promo.code, cat, status: 'UPDATED', bt: newBtId, changes });
      totalSaved++;
    } catch (e) {
      console.error(`  ✗    ${promo.code} (pid=${promo.id}): ${e.message.split('\n')[0]}`);
      report.push({ siteId, pid: promo.id, code: promo.code, cat, status: `PUT_ERR:${e.message.split('\n')[0]}` });
      totalErrors++;
    }
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n\n=== SUMMARY ===');
console.log(`Total saved: ${totalSaved}  Errors: ${totalErrors}`);
console.log('\nBy site + catType:');
for (const siteId of QPRO_SITES) {
  const site_rows = report.filter(r => r.siteId === siteId);
  const saved     = site_rows.filter(r => r.status === 'UPDATED').length;
  const noChange  = site_rows.filter(r => r.status === 'OK_NO_CHANGE').length;
  const errs      = site_rows.filter(r => r.status.includes('ERR') || r.status === 'NO_BT').length;
  console.log(`  ${siteId}: ${saved} updated, ${noChange} no-change, ${errs} errors (total ${site_rows.length})`);
}

console.log('\nErrors/warnings:');
for (const r of report.filter(r => r.status !== 'UPDATED' && r.status !== 'OK_NO_CHANGE')) {
  console.log(`  ${r.siteId} pid=${r.pid} code=${r.code}: ${r.status}`);
}
