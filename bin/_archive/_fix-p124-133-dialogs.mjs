#!/usr/bin/env node
// Fix #1: create + link missing dialog popups for P124-P133 (QPRO1-4 + QP2A).
// Confirmed pre-existing gap (not caused by today's edits) — these 46 records
// never had a working dialog link since original creation. Uses the standard
// "How to Apply" template via the mapper's own buildDialogPopupBody(), same
// content generator used for correct fresh creates.
//
// QP2A only (not B/C/D) — user-scoped decision 2026-07-03. dialog_popup_list
// on QP2 is per-merchant (site_id); B/C/D left as a known follow-up.
//
// Usage: node bin/_fix-p124-133-dialogs.mjs           # dry-run
//        node bin/_fix-p124-133-dialogs.mjs --commit  # live
//        node bin/_fix-p124-133-dialogs.mjs --commit --handle=P124-r125  # single handle

import { readFile } from 'node:fs/promises';
import { getSite } from '../src/sites.js';
import { authedFetch, findPromotionByCode, createDialogPopup } from '../src/api-client.js';
import { buildDialogPopupBody as buildDialogQpro } from '../src/api-mapper-qpro.js';
import { buildDialogPopupBody as buildDialogQp2 } from '../src/api-mapper-qp2.js';

const COMMIT = process.argv.includes('--commit');
const handleFilterArg = process.argv.find(a => a.startsWith('--handle='));
const handleFilter = handleFilterArg ? handleFilterArg.split('=')[1].split(',') : null;

const TARGETS = [
  { handle: 'P124-r125', qpro1Code: 'REL_BASE_60FS_GOOSS_12X_V2B', sharedCode: 'REL_BASE_60FS_GOOSS_12X_V2', qp2Id: 1269 },
  { handle: 'P125-r126', qpro1Code: 'REL_BOOSTER_80FS_GOOSS_15X_V2', sharedCode: 'REL_BOOSTER_80FS_GOOSS_15X', qp2Id: 1270 },
  { handle: 'P126-r127', qpro1Code: 'RET_GOOSS_BASE_50FS_10X_V2', sharedCode: 'RET_GOOSS_BASE_50FS_10X', qp2Id: 1271 },
  { handle: 'P127-r128', qpro1Code: 'RET_GOOSS_BOOST_60FS_12X_V2', sharedCode: 'RET_GOOSS_BOOST_60FS_12X', qp2Id: 1272 },
  { handle: 'P128-r129', qpro1Code: 'RET_LC_BASE_15PCT', sharedCode: 'RET_LC_BASE_15PCT', qp2Id: 860 },
  { handle: 'P129-r130', qpro1Code: 'RET_LC_BOOST_18PCT', sharedCode: 'RET_LC_BOOST_18PCT', qp2Id: 861 },
  { handle: 'P130-r131', qpro1Code: 'RET_SPORTS_BASE_12PCT', sharedCode: 'RET_SPORTS_BASE_12PCT', qp2Id: 859 },
  { handle: 'P131-r132', qpro1Code: 'RET_SPORTS_BOOST_15PCT', sharedCode: 'RET_SPORTS_BOOST_15PCT', qp2Id: 862 },
  { handle: 'P132-r133', qpro1Code: 'REL_BASE_12PCT_5X', sharedCode: 'REL_BASE_12PCT_5X', qp2Id: 898 },
  { handle: 'P133-r134', qpro1Code: 'REL_BOOSTER_15PCT_5X', sharedCode: 'REL_BOOSTER_15PCT_5X', qp2Id: 899 },
];

const QPRO_BRANDS = [
  { brand: 'QPRO1', site: 'qpro1' },
  { brand: 'QPRO2', site: 'qpro2' },
  { brand: 'QPRO3', site: 'qpro3' },
  { brand: 'QPRO4', site: 'qpro4' },
];

function nowYmdHms() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}
function isoToYmdHms(iso) {
  if (!iso || typeof iso !== 'string') return iso;
  return iso.replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '');
}
function arrToIdxObj(arr) {
  if (!Array.isArray(arr)) return arr;
  return Object.fromEntries(arr.map((v, i) => [String(i), v]));
}
function normalizeQproBody(body, dialogArg) {
  if (body.valid_from) body.valid_from = isoToYmdHms(body.valid_from);
  if (body.valid_to)   body.valid_to   = isoToYmdHms(body.valid_to);
  const nullDrops = ['free_spin_game_code','promo_p1_id','promo_p2_id','promo_p2_code','promo_p2_name','reset_day','reset_month','free_spin_game_provider_id','blacklist_template_id','bonus_rate'];
  for (const k of nullDrops) if (body[k] == null) delete body[k];
  const getOnly = ['created_at','updated_at','created_by','updated_by','deleted_at','promotion_category','currencies','message_templates','sms_message_templates','bonus_type','member_group','target_type','game_provider','category','currencies_bonus_type','kyc_type','phase_game_provider_code','phase_game_provider_category','kyc_listing','bonus_settings','site_name','merchant_name','platform_name','frequency_text','before_ftd','ftd','deposit_count_reset_frequency','deposit_count_reset_day','fingerprint_check','freespin_check','allow_deposit','allow_continuous_claim','auto_reward_activation','withdrawal_unlock','active_period','members_only'];
  for (const k of getOnly) delete body[k];
  if (body.reset_frequency === 0) delete body.reset_frequency;
  body.dialog_popup_list = {
    '0': {
      id: dialogArg.id,
      start_date: dialogArg.start_date,
      end_date: null,
      promotion_id: body.id,
      labelKey: dialogArg.label ? `${dialogArg.code} (${dialogArg.label.slice(0,14)} . . . )` : dialogArg.code,
      code: dialogArg.code,
    },
  };
  return body;
}
function normalizeQp2Body(body, fullPopupRow) {
  if (body.valid_from) body.valid_from = isoToYmdHms(body.valid_from);
  if (body.valid_to)   body.valid_to   = isoToYmdHms(body.valid_to);
  if (body.deposit_status == null) body.deposit_status = body.last_deposit ? 4 : 1;
  if (body.deposit_count_reset_frequency == null) body.deposit_count_reset_frequency = 0;
  if (body.deposit_count_reset_day == null) body.deposit_count_reset_day = 0;
  if (Array.isArray(body.merchant_ids)) {
    body.merchant_ids = Object.fromEntries(body.merchant_ids.map((m,i)=>[String(i), typeof m==='object'?m.id:m]));
  }
  if (Array.isArray(body.member_ids)) {
    body.member_ids = Object.fromEntries(body.member_ids.map((m,i)=>[String(i), typeof m==='object'?m.id:m]));
  }
  if (Array.isArray(body.target) && body.target[0]) {
    const t = body.target[0];
    body.target = { type: t.type, multiplier: t.multiplier, game_provider_codes: arrToIdxObj(t.game_provider_codes) };
  } else if (body.target && Array.isArray(body.target.game_provider_codes)) {
    body.target.game_provider_codes = arrToIdxObj(body.target.game_provider_codes);
  }
  for (const k of ['game_provider_codes','promotion_category_ids','member_group_ids','currencies_ids','affiliate_ids','affiliate_group_ids','telemarketer_ids','blacklist_sub_categories','promo_linked_ids']) {
    if (Array.isArray(body[k])) body[k] = arrToIdxObj(body[k]);
  }
  const dropKeys = ['created_at','updated_at','created_by','updated_by','deleted_at','promotion_category','currencies','message_templates','sms_message_templates','bonus_type','member_group','target_type','game_provider','category','currencies_bonus_type','kyc_type','phase_game_provider_code','phase_game_provider_category','kyc_listing','bonus_settings','site_name','merchant_name','platform_name','frequency_text','before_ftd','ftd','promo_p1_id','promo_p2_id','promo_p2_code','promo_p2_name'];
  for (const k of dropKeys) delete body[k];
  const nullDrops = ['free_spin_game_code','reset_day','reset_month','valid_to'];
  for (const k of nullDrops) if (body[k] == null) delete body[k];
  if (body.reset_frequency === 0) delete body.reset_frequency;
  body.dialog_popup_list = {
    '0': { ...(fullPopupRow || {}), promotion_id: body.id },
  };
  return body;
}

console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`FIX #1 — DIALOG POPUPS (P124-P133, QPRO1-4 + QP2A) — ${COMMIT ? 'LIVE (--commit)' : 'DRY-RUN'}`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

const filteredTargets = handleFilter ? TARGETS.filter(t => handleFilter.includes(t.handle)) : TARGETS;
const results = [];

for (const t of filteredTargets) {
  const resolved = JSON.parse(await readFile(`captures/requests/${t.handle}.json`, 'utf-8'));
  console.log(`\n══ ${t.handle} ══`);

  // ---- QPRO1-4 ----
  for (const qb of QPRO_BRANDS) {
    const code = qb.brand === 'QPRO1' ? t.qpro1Code : t.sharedCode;
    const site = getSite(qb.site);
    const found = await findPromotionByCode(site, code);
    if (!found) { console.log(`  ${qb.brand}: NOT FOUND (code=${code})`); results.push({ ...t, brand: qb.brand, ok: false }); continue; }

    let popupBody;
    try {
      popupBody = await buildDialogQpro(resolved, qb.brand);
    } catch (e) {
      console.log(`  ${qb.brand}: buildDialogPopupBody threw: ${e.message.slice(0,200)}`);
      results.push({ ...t, brand: qb.brand, ok: false }); continue;
    }
    if (!popupBody) { console.log(`  ${qb.brand}: buildDialogPopupBody returned null (popup_dialog!=true or cashback) — skipping`); results.push({ ...t, brand: qb.brand, ok: false }); continue; }

    const localeCount = Object.keys(popupBody.contents).length;
    console.log(`  ${qb.brand} (id=${found.id}): popup ready, ${localeCount} locale(s), label="${popupBody.label}"`);

    if (!COMMIT) { results.push({ ...t, brand: qb.brand, ok: true, dry: true }); continue; }

    let popRes;
    try {
      popRes = await createDialogPopup(site, popupBody);
    } catch (e) {
      console.log(`    ✗ POST /popups failed: ${e.message.split('\n')[0].slice(0,200)}`);
      results.push({ ...t, brand: qb.brand, ok: false }); continue;
    }
    const popupId = popRes?.data?.rows?.id ?? popRes?.data?.id;
    const popupCode = popRes?.data?.rows?.code ?? popRes?.data?.code;
    if (!popupId) {
      console.log(`    ✗ POST /popups — no id in response: ${JSON.stringify(popRes).slice(0,300)}`);
      results.push({ ...t, brand: qb.brand, ok: false }); continue;
    }
    console.log(`    ✓ popup created id=${popupId} code=${popupCode}`);

    const detail = await authedFetch(site, `/api/bo/promotion/${found.id}`);
    const body = detail?.data?.rows;
    if (!body) { console.log(`    ✗ GET promotion detail failed`); results.push({ ...t, brand: qb.brand, ok: false }); continue; }

    const dialogArg = { id: popupId, code: popupCode || '', start_date: popupBody.start_date, label: popupBody.label };
    try {
      normalizeQproBody(body, dialogArg);
      const putRes = await authedFetch(site, `/api/bo/promotion/${found.id}`, { method: 'PUT', body });
      const ok = putRes?.success !== false;
      console.log(`    → PUT (link dialog): ${ok ? '✅ OK' : '❌ ' + JSON.stringify(putRes).slice(0,200)}`);
      results.push({ ...t, brand: qb.brand, ok, popupId });
    } catch (e) {
      console.log(`    → PUT: ❌ ${e.message.split('\n')[0].slice(0,300)}`);
      results.push({ ...t, brand: qb.brand, ok: false, err: e.message });
    }
  }

  // ---- QP2A ----
  {
    const site = getSite('ibc22');
    const found = await findPromotionByCode(site, t.sharedCode, { merchantId: 1 });
    const brand = 'QP2A';
    if (!found) { console.log(`  ${brand}: NOT FOUND (code=${t.sharedCode})`); results.push({ ...t, brand, ok: false }); continue; }

    let popupBody;
    try {
      popupBody = await buildDialogQp2(resolved, brand);
    } catch (e) {
      console.log(`  ${brand}: buildDialogPopupBody threw: ${e.message.slice(0,200)}`);
      results.push({ ...t, brand, ok: false }); continue;
    }
    if (!popupBody) { console.log(`  ${brand}: buildDialogPopupBody returned null — skipping`); results.push({ ...t, brand, ok: false }); continue; }

    const localeCount = Object.keys(popupBody.contents).length;
    console.log(`  ${brand} (id=${found.id}): popup ready, ${localeCount} locale(s), label="${popupBody.label}"`);

    if (!COMMIT) { results.push({ ...t, brand, ok: true, dry: true }); continue; }

    let popRes;
    try {
      popRes = await createDialogPopup(site, popupBody);
    } catch (e) {
      console.log(`    ✗ POST /popups failed: ${e.message.split('\n')[0].slice(0,200)}`);
      results.push({ ...t, brand, ok: false }); continue;
    }
    const popupRow = popRes?.data?.rows ?? popRes?.data;
    if (!popupRow?.id) {
      console.log(`    ✗ POST /popups — no id in response: ${JSON.stringify(popRes).slice(0,300)}`);
      results.push({ ...t, brand, ok: false }); continue;
    }
    console.log(`    ✓ popup created id=${popupRow.id}`);

    const detail = await authedFetch(site, `/api/bo/promotion/${found.id}`);
    const body = detail?.data?.rows;
    if (!body) { console.log(`    ✗ GET promotion detail failed`); results.push({ ...t, brand, ok: false }); continue; }

    try {
      normalizeQp2Body(body, popupRow);
      const putRes = await authedFetch(site, `/api/bo/promotion/${found.id}`, { method: 'PUT', body });
      const ok = putRes?.success !== false;
      console.log(`    → PUT (link dialog): ${ok ? '✅ OK' : '❌ ' + JSON.stringify(putRes).slice(0,200)}`);
      results.push({ ...t, brand, ok, popupId: popupRow.id });
    } catch (e) {
      console.log(`    → PUT: ❌ ${e.message.split('\n')[0].slice(0,300)}`);
      results.push({ ...t, brand, ok: false, err: e.message });
    }
  }
}

console.log(`\n\nSummary: ${results.filter(r=>r.ok).length}/${results.length} ${COMMIT ? 'created+linked' : 'would create+link'}`);
if (!COMMIT) console.log('Re-run with --commit to apply. Use --handle=P124-r125 to test a single handle first.');
