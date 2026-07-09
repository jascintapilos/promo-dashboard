#!/usr/bin/env node
// Remediation for bin/sweep-cat-gp-estate.mjs hits — category-restricted
// promos still carrying the FULL provider catalog (pre-4843b74 mapper bug).
//
// Echo-style round trip per promo (NOT the June builder, which hardcodes
// members_only/member_group_ids/status): GET detail → change ONLY the
// game-provider fields → PUT back → re-GET and verify counts + drift.
//   • QP2 (ibc22): pattern proven by bin/fix-wc-slvr-qp2-providers.mjs.
//     Top-level game_provider_codes = NUMERIC ids; target.game_provider_codes
//     = STRING codes; multiplier 2-decimal string; promotion_currency omitted;
//     dialog re-asserted via readDialogForPreservation.
//   • QPRO: pattern proven by bin/_archive/_fix-tleo-gp-ids.mjs (echo PUT)
//     + the June script's 6-field dialog_popup_list shape when a popup is
//     linked. promotion_currency never re-sent.
//
// Provider targets are recomputed from the promo's LIVE categories at fix
// time (not the sweep snapshot):
//   • QPRO: /api/bo/gameprovider rows whose categories[] match (per-site).
//   • QP2:  filterQp2ProvidersByCat() from src/api-mapper-qp2.js.
//
//   node bin/fix-cat-gp-estate.mjs                       ← dry-run, all hits
//   node bin/fix-cat-gp-estate.mjs --sites qpro5,ibc22   ← subset
//   node bin/fix-cat-gp-estate.mjs --only 100FC_10X      ← by code(s)
//   node bin/fix-cat-gp-estate.mjs --commit              ← live PUTs
//
// Commit mode stops the whole batch on the first verification failure.

import { authedFetch, readDialogForPreservation } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { filterQp2ProvidersByCat } from '../src/api-mapper-qp2.js';
import { readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const argVal = (flag) => {
  const i = args.findIndex((a) => a === flag || a.startsWith(`${flag}=`));
  if (i < 0) return null;
  return args[i].includes('=') ? args[i].split('=').slice(1).join('=') : args[i + 1];
};
const SITES_ARG = argVal('--sites')?.split(',').map((s) => s.trim());
const ONLY_ARG = argVal('--only')?.split(',').map((s) => s.trim());
const SWEEP_FILE = argVal('--sweep') || 'tmp/estate-cat-gp-sweep.json';

const INCLUDE_OVERBROAD = args.includes('--include-overbroad');

const sweep = JSON.parse(readFileSync(SWEEP_FILE, 'utf8'));
let hits = [...(sweep.hits || []), ...(INCLUDE_OVERBROAD ? sweep.overbroad || [] : [])];
if (SITES_ARG) hits = hits.filter((h) => SITES_ARG.includes(h.site));
if (ONLY_ARG) hits = hits.filter((h) => ONLY_ARG.includes(h.code) || ONLY_ARG.includes(String(h.id)));

console.log(`${COMMIT ? 'LIVE (--commit)' : 'DRY-RUN'} — estate category/provider remediation, ${hits.length} hit(s) from ${SWEEP_FILE}\n`);

const OUT = path.resolve('captures/provider-fix-runs'); mkdirSync(OUT, { recursive: true });
const logFile = path.join(OUT, `estate-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
const log = (ev) => appendFileSync(logFile, JSON.stringify({ ts: new Date().toISOString(), ...ev }) + '\n');

const objVals = (o) => (o == null ? [] : Array.isArray(o) ? o : Object.values(o));
const arrayToIntObj = (arr) => Object.fromEntries(arr.map((v, i) => [String(i), v]));
const toYmdHis = (iso) => (iso ? String(iso).replace('T', ' ').replace(/\.\d+Z?$/, '') : null);
const b01 = (v) => (v === true ? 1 : v === false ? 0 : v);
const getDetail = async (site, id) => (await authedFetch(site, `/api/bo/promotion/${id}`)).data.rows;

// ── Per-site caches ───────────────────────────────────────────────────────────

const catByIdCache = {};   // siteId → { id: name }
async function catById(site) {
  if (!catByIdCache[site.id]) {
    const r = await authedFetch(site, '/api/bo/categories?perPage=500');
    catByIdCache[site.id] = Object.fromEntries(objVals(r.data?.rows).map((c) => [c.id, c.name]));
  }
  return catByIdCache[site.id];
}

// Layer-1 exclusion names apply on top of the category filter — a Slots-only
// promo must not include 918KAYA/Habanero/etc. just because they carry slots
// games (operator correction 2026-07-09, P026). Mirrors LAYER1_GP_EXCLUSION_NAMES
// in src/api-mapper-qpro.js; match by name OR code (catalog shape drifts).
const LAYER1_GP_EXCLUSION_NAMES = ['918KISS', '918KAYA', 'ALLBET', 'EKOR', 'HABANERO', 'KINGMIDAS', 'MEGA888', 'DG', 'SSG'];
const gpCatalogCache = {}; // siteId → provider rows (QPRO only)
async function qproProvidersForCats(site, catNames) {
  if (!gpCatalogCache[site.id]) {
    const r = await authedFetch(site, '/api/bo/gameprovider?perPage=999&page=1');
    gpCatalogCache[site.id] = objVals(r.data?.rows);
  }
  const catSet = new Set(catNames.map((n) => String(n).toUpperCase()));
  const excl = new Set(LAYER1_GP_EXCLUSION_NAMES.map((n) => n.toUpperCase()));
  return gpCatalogCache[site.id]
    .filter((g) => (g.categories || []).some((c) => catSet.has(String(c.category || '').toUpperCase())))
    .filter((g) => !excl.has(String(g.name || '').toUpperCase()) && !excl.has(String(g.code || '').toUpperCase()))
    .map((g) => g.id)
    .sort((a, b) => a - b);
}

const popupsCache = {};    // siteId → popup rows (QP2 dialog preservation)
async function ensurePopups(site) {
  if (!popupsCache[site.id]) {
    const r = await authedFetch(site, '/api/bo/popups?perPage=500&page=1&date_type=start_date&sort_by=id&sort_order=desc');
    popupsCache[site.id] = r.data?.rows || [];
  }
  return popupsCache[site.id];
}

// ── Shared signatures (drift detection) ───────────────────────────────────────

async function currencySig(site, promoId) {
  const r = await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${promoId}&perPage=20`);
  return (r.data?.rows || [])
    .map((c) => [c.id, c.currency, c.bonus_rate, c.bonus_amount, c.min_transfer, c.min_deposit, c.max_bonus, c.rounds, c.status].join('|'))
    .sort().join(';');
}

async function dialogRow(site, code) {
  const r = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=10`);
  const row = objVals(r.data?.rows).find((x) => x.code === code);
  return (row?.dialog_popup_list || [])[0] ?? null;
}
const dialogSigOf = (row) => (row ? String(row.popup_id) : '');

function catSig(det) {
  if (Array.isArray(det.promotion_category)) return JSON.stringify(det.promotion_category.map((c) => c.category_id).sort((a, b) => a - b));
  return JSON.stringify(objVals(det.promotion_category_ids).sort((a, b) => a - b));
}

// ── QP2 echo body (from bin/fix-wc-slvr-qp2-providers.mjs) ────────────────────

function qp2DepositStatus(d) {
  if (d.last_deposit) return 4;
  if (d.first_deposit || d.ftd) return 3;
  if (d.before_ftd) return 2;
  return 1;
}

function buildQp2Body(d, dlg, putGpIds, targetGpCodes) {
  const merchantIdsObj = {};
  objVals(d.merchant_ids).map((m) => (typeof m === 'object' ? m.id : m)).forEach((id, i) => { merchantIdsObj[String(i)] = id; });
  const targetArr = Array.isArray(d.target) ? d.target : (d.target ? [d.target] : []);
  const target0 = targetArr[0] || { type: 1, multiplier: '1.00' };
  const dialogList = (dlg?.id && dlg.fullRow) ? { '0': { ...dlg.fullRow, promotion_id: d.id } } : {};
  return {
    id: d.id, code: d.code, name: d.name,
    bonus_settings: d.bonus_settings ?? 1,
    promo_type: d.promo_type, promo_sub_type: d.promo_sub_type,
    promotion_ids: Array.isArray(d.promo_linked_ids) ? d.promo_linked_ids : [],
    valid_from: toYmdHis(d.valid_from),
    valid_to: toYmdHis(d.valid_to),
    validity: d.validity ?? 1,
    reward_validity: d.reward_validity ?? 1,
    frequency_type: d.frequency_type ?? 1,
    frequency: d.frequency ?? [],
    before_ftd: d.before_ftd ?? 0,
    first_deposit: d.first_deposit ?? 0,
    ftd: d.ftd ?? 0,
    last_deposit: d.last_deposit ?? 0,
    deposit_status: qp2DepositStatus(d),
    limit_transfer_out: d.limit_transfer_out ?? 0,
    limit_transfer_in: d.limit_transfer_in ?? 0,
    auto_unlock: d.auto_unlock ?? 1,
    allow_cancel: d.allow_cancel ?? 0,
    withdrawal_unlock: d.withdrawal_unlock ?? 0,
    auto_approve: d.auto_approve ?? 1,
    auto_reward_activation: d.auto_reward_activation ?? 1,
    recurring: d.recurring ?? 0,
    reset_frequency: d.reset_frequency || 1,
    reset_month: d.reset_month || 1,
    max_per_player: d.max_per_player ?? 1,
    daily_max: d.daily_max ?? 1,
    members_only: d.members_only ?? 0,
    fingerprint_check: d.fingerprint_check ?? 0,
    freespin_check: d.freespin_check ?? 0,
    allow_deposit: d.allow_deposit ?? 0,
    allow_continuous_claim: d.allow_continuous_claim ?? 0,
    message_template_id: d.message_template_id ?? 0,
    message_template_sms_id: d.message_template_sms_id ?? 0,
    bonus_rate: d.bonus_rate ?? 0,
    deposit_count: d.deposit_count ?? 0,
    active_period: d.active_period ?? 0,
    eligible_types: d.eligible_types ?? 1,
    free_spin_game_provider_id: d.free_spin_game_provider_id ?? 0,
    ...(d.free_spin_game_code != null ? { free_spin_game_code: d.free_spin_game_code } : {}),
    blacklist_template_id: d.blacklist_template_id,
    promotion_category_ids: d.promotion_category_ids ?? [],
    game_provider_codes: putGpIds,                      // ← intended change (numeric ids)
    target: {
      type: target0.type ?? 1,
      multiplier: Number(target0.multiplier ?? 0).toFixed(2),
      game_provider_codes: targetGpCodes,               // ← intended change (string codes)
    },
    member_group_ids: d.member_group_ids ?? [],
    affiliate_group_ids: d.affiliate_group_ids ?? [],
    affiliate_ids: d.affiliate_ids ?? [],
    telemarketer_ids: d.telemarketer_ids ?? [],
    requires_email: d.requires_email ?? 0,
    requires_mobile: d.requires_mobile ?? 0,
    requires_dob: d.requires_dob ?? 0,
    requires_fullname: d.requires_fullname ?? 0,
    kyc_listing: d.kyc_listing ?? 0,
    black_list_sub_categories: d.blacklist_sub_categories ?? [],
    merchant_ids: merchantIdsObj,
    dialog_popup_list: dialogList,
    status: d.status,
  };
}

// ── QPRO echo body (from bin/_archive/_fix-tleo-gp-ids.mjs, live pass-through;
//    dialog shape from the June script — the only part of it we reuse) ─────────

function buildQproBody(d, popupRow, newGpIds) {
  const target0 = Array.isArray(d.target) ? d.target[0] : (d.target?.['0'] ?? {});
  const gpObj = arrayToIntObj(newGpIds);
  const body = {
    id: d.id, code: d.code, name: d.name,
    free_spin_game_provider_id: d.free_spin_game_provider_id ?? 0,
    promotion_category_turnover: arrayToIntObj((d.promotion_category || []).map((c) => c.category_id)),
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
    game_provider_ids: gpObj,                           // ← intended change
    target: {
      '0': {
        type: target0.type ?? 1,
        multiplier: target0.multiplier ?? 0,
        game_provider_ids: gpObj,                       // ← intended change
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
    blacklist_id: d.blacklist_id,
    black_list_sub_categories: [],
    dialog_popup_list: popupRow
      ? { '0': { id: popupRow.popup_id, start_date: popupRow.created_at ? toYmdHis(popupRow.created_at) : '', end_date: null, promotion_id: d.id, labelKey: '', code: '' } }
      : [],
  };
  if (d.bonus_rate != null) body.bonus_rate = String(Number(d.bonus_rate).toFixed(2));
  if (d.recurring && d.reset_frequency) body.reset_frequency = d.reset_frequency;
  return body;
}

// ── Run ───────────────────────────────────────────────────────────────────────

const results = [];
outer:
for (const hit of hits.sort((a, b) => a.site.localeCompare(b.site) || a.id - b.id)) {
  const res = { site: hit.site, id: hit.id, code: hit.code, status: 'pending' };
  try {
    const site = getSite(hit.site);
    const isQp2 = site.platform === 'qp2';
    const before = await getDetail(site, hit.id);
    if (before.code !== hit.code) { res.status = 'code_mismatch'; res.note = `BO has ${before.code}`; console.log(`  ✗ ${hit.site} id=${hit.id}: expected ${hit.code}, BO has ${before.code} — skip`); results.push(res); continue; }

    // Recompute categories + target provider set from LIVE detail
    const cats = await catById(site);
    const liveCatIds = Array.isArray(before.promotion_category)
      ? before.promotion_category.map((c) => c.category_id)
      : objVals(before.promotion_category_ids);
    const liveCatNames = liveCatIds.map((cid) => cats[cid] ?? `id:${cid}`);
    if (!liveCatIds.length) { res.status = 'no_longer_restricted'; console.log(`  • ${hit.site} ${hit.code}: categories now empty — skip`); results.push(res); continue; }

    let newGpIds = null, putGpIds = null, targetGpCodes = null, targetCount = 0;
    if (isQp2) {
      const filtered = filterQp2ProvidersByCat(liveCatNames);
      if (!filtered) { res.status = 'no_provider_mapping'; res.note = `cats=[${liveCatNames.join(',')}]`; console.log(`  ⚠ ${hit.site} ${hit.code}: no QP2 provider mapping for [${liveCatNames.join(',')}] — manual review`); results.push(res); continue; }
      putGpIds = filtered.putIds; targetGpCodes = filtered.targetCodes;
      targetCount = Object.keys(targetGpCodes).length;
    } else {
      newGpIds = await qproProvidersForCats(site, liveCatNames);
      if (!newGpIds.length) { res.status = 'no_provider_mapping'; res.note = `cats=[${liveCatNames.join(',')}]`; console.log(`  ⚠ ${hit.site} ${hit.code}: no providers match [${liveCatNames.join(',')}] — manual review`); results.push(res); continue; }
      targetCount = newGpIds.length;
    }

    const gpBefore = isQp2 ? objVals(before.game_provider_codes).length : objVals(before.game_provider_ids).length;
    // Legacy "all games at creation time" promos: the category union is
    // BIGGER than the saved provider set (categories ≈ everything that
    // existed then). Restricting to the union would ADD providers — not the
    // June defect. Leave untouched.
    if (gpBefore <= targetCount) { res.status = 'skip_would_not_narrow'; res.note = `${gpBefore} providers ≤ category union ${targetCount}`; console.log(`  • ${hit.site} ${hit.code}: ${gpBefore} providers ≤ union ${targetCount} — would not narrow, skip`); results.push(res); continue; }

    const dlgRowBefore = await dialogRow(site, before.code);
    const curBefore = await currencySig(site, hit.id);
    const sig = {
      cat: catSig(before), status: before.status,
      mtid: before.message_template_id, mg: objVals(before.member_group_ids).length,
      mo: before.members_only ?? null, lto: before.limit_transfer_out,
      rate: before.bonus_rate ?? null,
    };

    if (!COMMIT) {
      res.status = 'would_fix'; res.gp_before = gpBefore; res.gp_target = targetCount;
      console.log(`  ~ ${hit.site.padEnd(7)} ${String(hit.id).padEnd(5)} ${hit.code.padEnd(34)} providers ${gpBefore}→${targetCount}  cats=[${liveCatNames.join(',')}]  dlg:[${dialogSigOf(dlgRowBefore) || '-'}] mt:${sig.mtid}`);
      results.push(res); continue;
    }

    // LIVE
    let body;
    if (isQp2) {
      let dlg = null;
      if (dlgRowBefore) {
        dlg = await readDialogForPreservation(site, before.code, await ensurePopups(site));
        if (!(dlg?.id && dlg.fullRow)) res.dialog_warn = `popup row unresolved (id=${dlg?.id ?? 'none'})`;
      }
      body = buildQp2Body(before, dlg, putGpIds, targetGpCodes);
    } else {
      body = buildQproBody(before, dlgRowBefore, newGpIds);
    }
    await authedFetch(site, `/api/bo/promotion/${hit.id}`, { method: 'PUT', body });

    // Verify
    const after = await getDetail(site, hit.id);
    const gpAfter = isQp2 ? objVals(after.game_provider_codes).length : objVals(after.game_provider_ids).length;
    const t0 = Array.isArray(after.target) ? after.target[0] : after.target?.['0'] ?? after.target;
    const tgtAfter = isQp2 ? objVals(t0?.game_provider_codes).length : objVals(t0?.game_provider_ids).length;
    const dlgAfter = dialogSigOf(await dialogRow(site, before.code));
    const drift = [];
    if (catSig(after) !== sig.cat) drift.push('categories');
    if (after.status !== sig.status) drift.push(`status(${sig.status}→${after.status})`);
    if (after.message_template_id !== sig.mtid) drift.push(`msg_template(${sig.mtid}→${after.message_template_id})`);
    if (objVals(after.member_group_ids).length !== sig.mg) drift.push('member_groups');
    if ((after.members_only ?? null) !== sig.mo) drift.push(`members_only(${sig.mo}→${after.members_only})`);
    if (after.limit_transfer_out !== sig.lto) drift.push(`limit_transfer_out(${sig.lto}→${after.limit_transfer_out})`);
    if (Number(after.bonus_rate ?? 0) !== Number(sig.rate ?? 0)) drift.push(`bonus_rate(${sig.rate}→${after.bonus_rate})`);
    if (dlgAfter !== dialogSigOf(dlgRowBefore)) drift.push(`dialog(${dialogSigOf(dlgRowBefore) || '-'}→${dlgAfter || '-'})`);
    if ((await currencySig(site, hit.id)) !== curBefore) drift.push('currency_rows');
    res.drift = drift; res.gp_before = gpBefore; res.gp_after = gpAfter; res.target_gp_after = tgtAfter;

    if (gpAfter === targetCount && tgtAfter === targetCount && drift.length === 0) {
      res.status = 'ok';
      console.log(`  ✓ ${hit.site.padEnd(7)} ${String(hit.id).padEnd(5)} ${hit.code.padEnd(34)} providers ${gpBefore}→${gpAfter} (target:${tgtAfter}), no drift`);
    } else if (gpAfter !== targetCount || tgtAfter !== targetCount) {
      res.status = 'fix_failed';
      console.log(`  ✗ ${hit.site} ${hit.code}: provider count after PUT = ${gpAfter}/target:${tgtAfter} (expected ${targetCount})`);
    } else {
      res.status = 'DRIFT';
      console.log(`  ⚠ ${hit.site} ${hit.code}: DRIFT [${drift.join(', ')}]`);
    }
    log({ event: 'put', ...res });
    results.push(res);
    if (res.status === 'DRIFT' || res.status === 'fix_failed') {
      console.log('\n*** STOPPING BATCH — verification failed on this promo. Investigate before continuing. ***');
      break outer;
    }
    continue;
  } catch (e) {
    res.status = 'error'; res.error = e.message.split('\n').slice(0, 2).join(' | ').slice(0, 240);
    console.log(`  ✗ ${hit.site} id=${hit.id} ${hit.code}: ${res.error}`);
    log({ event: 'error', ...res });
    results.push(res);
    if (COMMIT) { console.log('\n*** STOPPING BATCH — error during live PUT. Investigate before continuing. ***'); break; }
  }
}

console.log('\n── Summary ──');
for (const r of results) {
  const tag = r.status === 'ok' ? '✓' : ['skip_would_not_narrow', 'would_fix', 'no_longer_restricted'].includes(r.status) ? '~' : '✗';
  console.log(`  ${tag} ${r.site.padEnd(7)} ${String(r.id).padEnd(5)} ${(r.code || '').padEnd(36)} ${r.status}${r.gp_before != null ? ` ${r.gp_before}→${r.gp_after ?? r.gp_target}` : ''}${r.drift?.length ? ' [' + r.drift.join(',') + ']' : ''}${r.dialog_warn ? ' ⚠ ' + r.dialog_warn : ''}${r.note ? ' — ' + r.note : ''}${r.error ? ' — ' + r.error : ''}`);
}
const ok = results.filter((r) => r.status === 'ok').length;
const would = results.filter((r) => r.status === 'would_fix').length;
const bad = results.filter((r) => !['ok', 'skip_would_not_narrow', 'would_fix', 'no_longer_restricted', 'no_provider_mapping'].includes(r.status));
console.log(`\n${COMMIT ? `fixed OK: ${ok}` : `would fix: ${would}`}   manual-review: ${results.filter((r) => r.status === 'no_provider_mapping').length}   problems: ${bad.length}`);
if (!COMMIT) console.log('Run with --commit to apply (requires user confirmation first).');
