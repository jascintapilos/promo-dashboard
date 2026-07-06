#!/usr/bin/env node
// Remediation: restrict game providers to SPORT on the 4 WC_SLVR promos on
// QP2C/ACE66 (ibc22). Same root cause as bin/fix-category-providers-june.mjs —
// category-restricted promos saved before the 2026-07-02 mapper fix (4843b74)
// carry promotion_category_ids correctly but game_provider_codes = ALL 51
// providers. The June remediation covered P128-P142 only; this covers the
// P169-P172 QP2C copies that were missed (QPRO siblings are already correct).
//
// Uses the proven echo-style round trip from bin/set-members-only-tier.mjs:
// GET detail → change ONLY the provider fields → PUT back, so members_only=1,
// member_group_ids, caps and template links ride along untouched. Dialog-popup
// links are re-asserted via readDialogForPreservation (not in the GET detail).
// promotion_currency is omitted per QP2 PUT semantics.
//
// QP2 PUT quirk (from fix-category-providers-june.mjs, proven on 15 promos):
// top-level game_provider_codes takes NUMERIC provider ids; target[0]
// .game_provider_codes takes STRING codes; multiplier is a 2-decimal string.
//
//   node bin/fix-wc-slvr-qp2-providers.mjs            ← dry-run
//   node bin/fix-wc-slvr-qp2-providers.mjs --commit   ← live
import { authedFetch, readDialogForPreservation } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';

const commit = process.argv.includes('--commit');
const site = getSite('ibc22');

// [promoId, code] — all ACE66, all SPORT-only per P169-P172 request rows
const TARGETS = [
  [1303, 'WC_SLVR_28FC_10X'],
  [1304, 'WC_SLVR_50FC_10X'],
  [1305, 'WC_SLVR_68FC_10X'],
  [1306, 'WC_SLVR_REL_20PCT_12X'],
];

// SPORT providers on QP2 (subset of the V25 catalog, same source table as
// src/api-mapper-qp2.js QP2_CATEGORY_PROVIDER_CODES)
const SPORT_CODES = ['9W', 'CMD', '2BC', 'MAX', 'SBO', 'SBO2', 'WBET'];
const CODE_TO_PUT_ID = {
  '9W': 139, 'CMD': 18, '2BC': 312, 'MAX': 8, 'SBO': 34, 'SBO2': 353, 'WBET': 72,
};
const toIdxObj = (arr) => Object.fromEntries(arr.map((v, i) => [String(i), v]));
const PUT_GP_IDS = toIdxObj(SPORT_CODES.map((c) => CODE_TO_PUT_ID[c]));
const TARGET_GP_CODES = toIdxObj(SPORT_CODES);

console.log(`${commit ? 'LIVE (--commit)' : 'DRY-RUN'} — restrict ${TARGETS.length} WC_SLVR promo(s) on ibc22/ACE66 to SPORT providers (${SPORT_CODES.join(',')})\n`);

const OUT = path.resolve('captures/provider-fix-runs'); mkdirSync(OUT, { recursive: true });
const logFile = path.join(OUT, `wc-slvr-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
const log = (ev) => appendFileSync(logFile, JSON.stringify({ ts: new Date().toISOString(), ...ev }) + '\n');

const getDetail = async (id) => (await authedFetch(site, `/api/bo/promotion/${id}`)).data.rows;
const toYmdHis = (iso) => (iso ? String(iso).replace('T', ' ').replace(/\.\d+Z?$/, '') : null);
function depositStatus(d) {
  if (d.last_deposit) return 4;
  if (d.first_deposit || d.ftd) return 3;
  if (d.before_ftd) return 2;
  return 1;
}

// Echo the live detail into a validator-valid PUT body, changing ONLY the
// two game-provider fields. Mirrors bin/set-members-only-tier.mjs buildBody.
function buildBody(d, dlg) {
  const merchantIdsObj = {};
  (Array.isArray(d.merchant_ids) ? d.merchant_ids : []).map((m) => (typeof m === 'object' ? m.id : m)).forEach((id, i) => { merchantIdsObj[String(i)] = id; });
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
    deposit_status: depositStatus(d),
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
    game_provider_codes: PUT_GP_IDS,                    // ← intended change (numeric ids on PUT)
    target: {
      type: target0.type ?? 1,
      multiplier: Number(target0.multiplier ?? 0).toFixed(2),
      game_provider_codes: TARGET_GP_CODES,             // ← intended change (string codes)
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

// Signature of the per-currency rows (where the real bonus_rate/min_deposit/
// max_bonus live on QP2). The PUT omits promotion_currency so these must not
// move; any change = drift.
async function currencySig(promoId) {
  const r = await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${promoId}&perPage=20`);
  const rows = r.data?.rows || [];
  return rows
    .map((c) => [c.id, c.currency, c.bonus_rate, c.bonus_amount, c.min_transfer, c.min_deposit, c.max_bonus, c.rounds, c.status].join('|'))
    .sort()
    .join(';');
}

async function dialogSig(code) {
  const r = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=10`);
  const row = (r.data.rows || []).find((x) => x.code === code);
  return (row?.dialog_popup_list || []).map((p) => p.popup_id).sort((a, b) => a - b).join(',');
}
let popupsCache = null;
async function ensurePopups() {
  if (popupsCache) return popupsCache;
  const r = await authedFetch(site, '/api/bo/popups?perPage=500&page=1&date_type=start_date&sort_by=id&sort_order=desc');
  popupsCache = r.data?.rows || [];
  return popupsCache;
}

const results = [];
for (const [id, expectCode] of TARGETS) {
  const res = { id, status: 'pending' };
  try {
    const before = await getDetail(id);
    res.code = before.code;
    if (before.code !== expectCode) { res.status = 'code_mismatch'; console.log(`  ✗ id=${id}: expected ${expectCode}, BO has ${before.code} — skip`); results.push(res); continue; }
    const gpBefore = (before.game_provider_codes || []).length;
    const dlgBefore = await dialogSig(before.code);
    const curBefore = await currencySig(id);
    const sig = {
      mo: before.members_only, mg: (before.member_group_ids || []).length,
      cat: JSON.stringify(before.promotion_category_ids || []),
      status: before.status, mtid: before.message_template_id,
      lto: before.limit_transfer_out, rate: before.bonus_rate, dep: depositStatus(before),
    };

    if (gpBefore === SPORT_CODES.length) { res.status = 'already_restricted'; console.log(`  • ${before.code}: already ${gpBefore} providers — skip`); results.push(res); continue; }
    if (!commit) {
      res.status = 'would_fix';
      console.log(`  ~ ${before.code.padEnd(24)} providers ${gpBefore}→${SPORT_CODES.length}  (cats:${sig.cat} members_only:${sig.mo} groups:${sig.mg} dlg:[${dlgBefore || '-'}] mt:${sig.mtid} lto:${sig.lto} rate:${sig.rate})`);
      results.push(res); continue;
    }

    let dlg = null;
    if (dlgBefore) {
      dlg = await readDialogForPreservation(site, before.code, await ensurePopups());
      if (!(dlg?.id && dlg.fullRow)) res.dialog_warn = `popup row unresolved (id=${dlg?.id ?? 'none'})`;
    }
    const body = buildBody(before, dlg);
    await authedFetch(site, `/api/bo/promotion/${id}`, { method: 'PUT', body });

    const after = await getDetail(id);
    const dlgAfter = await dialogSig(before.code);
    const gpAfter = (after.game_provider_codes || []).length;
    const tgtAfter = (Array.isArray(after.target) ? after.target[0] : after.target)?.game_provider_codes?.length ?? -1;
    const drift = [];
    if (after.members_only !== sig.mo) drift.push(`members_only(${sig.mo}→${after.members_only})`);
    if ((after.member_group_ids || []).length !== sig.mg) drift.push(`member_groups(${sig.mg}→${(after.member_group_ids || []).length})`);
    if (JSON.stringify(after.promotion_category_ids || []) !== sig.cat) drift.push('categories');
    if (dlgAfter !== dlgBefore) drift.push(`dialog(${dlgBefore || '-'}→${dlgAfter || '-'})`);
    if (after.status !== sig.status) drift.push('status');
    if ((await currencySig(id)) !== curBefore) drift.push('currency_rows');
    if (after.message_template_id !== sig.mtid) drift.push('msg_template');
    if (after.limit_transfer_out !== sig.lto) drift.push(`limit_transfer_out(${sig.lto}→${after.limit_transfer_out})`);
    if (Number(after.bonus_rate ?? 0) !== Number(sig.rate ?? 0)) drift.push(`bonus_rate(${sig.rate}→${after.bonus_rate})`);
    if (depositStatus(after) !== sig.dep) drift.push(`deposit_status(${sig.dep}→${depositStatus(after)})`);
    res.drift = drift; res.gp_after = gpAfter; res.target_gp_after = tgtAfter;

    if (gpAfter === SPORT_CODES.length && tgtAfter === SPORT_CODES.length && drift.length === 0) {
      res.status = 'ok';
      console.log(`  ✓ ${String(id).padEnd(5)} ${before.code.padEnd(24)} providers ${gpBefore}→${gpAfter} (target:${tgtAfter}), no drift`);
    } else if (gpAfter !== SPORT_CODES.length || tgtAfter !== SPORT_CODES.length) {
      res.status = 'fix_failed';
      console.log(`  ✗ ${before.code}: provider count after PUT = ${gpAfter}/target:${tgtAfter} (expected ${SPORT_CODES.length})`);
    } else {
      res.status = 'DRIFT';
      console.log(`  ⚠ ${before.code}: DRIFT [${drift.join(', ')}]`);
    }
    log({ event: 'put', ...res });
  } catch (e) {
    res.status = 'error'; res.error = e.message.split('\n').slice(0, 2).join(' | ').slice(0, 240);
    console.log(`  ✗ id=${id}: ${res.error}`);
    log({ event: 'error', ...res });
  }
  results.push(res);
  if (commit && (res.status === 'DRIFT' || res.status === 'fix_failed')) {
    console.log('\n*** STOPPING BATCH — verification failed on this promo. Investigate before continuing. ***');
    break;
  }
}

console.log('\n── Summary ──');
for (const r of results) {
  const tag = r.status === 'ok' ? '✓' : ['already_restricted', 'would_fix'].includes(r.status) ? '~' : '✗';
  console.log(`  ${tag} ${String(r.id).padEnd(5)} ${(r.code || '').padEnd(28)} ${r.status}${r.drift?.length ? ' [' + r.drift.join(',') + ']' : ''}${r.dialog_warn ? ' ⚠ ' + r.dialog_warn : ''}${r.error ? ' — ' + r.error : ''}`);
}
const ok = results.filter((r) => r.status === 'ok').length;
const bad = results.filter((r) => !['ok', 'already_restricted', 'would_fix'].includes(r.status));
console.log(`\nfixed OK: ${ok}   problems: ${bad.length}`);
