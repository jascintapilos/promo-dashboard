#!/usr/bin/env node
// Set members_only -> 1 on tier-restricted QP2 promos via API, using the proven
// GET-detail -> change-one-field -> PUT-back round trip (same body shape as
// bin/set-auto-reward-api.mjs). The BO accepts its own /api/bo/promotion/{id}
// detail body wholesale on PUT, so member_group_ids / currencies / caps ride
// along untouched. Dialog-popup links are NOT in the GET detail, so we re-assert
// any existing link explicitly (readDialogForPreservation) so popups can't drop.
//
// The canary hardcodes members_only=0; tier-restricted promos need this=1 for
// the restricted member_group_ids to actually gate eligibility. Verified against
// existing WC_SLVR_* promos which carry members_only=1 + a restricted group set.
//
//   node bin/set-members-only-tier.mjs --ids=1312,1313,1314,1315            ← dry-run
//   node bin/set-members-only-tier.mjs --ids=1312,1313,1314,1315 --commit   ← live
import { authedFetch, readDialogForPreservation } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const commit = argv.includes('--commit');
const idsArg = argv.find((a) => a.startsWith('--ids='));
if (!idsArg) { console.error('pass --ids=<comma-separated promotion ids>'); process.exit(2); }
const ids = idsArg.split('=')[1].split(',').map(Number);

const site = getSite('ibc22');
console.log(`${commit ? 'LIVE' : 'DRY-RUN'} — set members_only=1 on ${ids.length} promo(s): [${ids.join(',')}]\n`);

const OUT = path.resolve('captures/members-only-runs'); mkdirSync(OUT, { recursive: true });
const logFile = path.join(OUT, `api-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
const log = (ev) => appendFileSync(logFile, JSON.stringify({ ts: new Date().toISOString(), ...ev }) + '\n');

const getDetail = async (id) => (await authedFetch(site, `/api/bo/promotion/${id}`)).data.rows;
const toYmdHis = (iso) => (iso ? String(iso).replace('T', ' ').replace(/\.\d+Z?$/, '') : null);
function depositStatus(d) {
  if (d.last_deposit) return 4;
  if (d.first_deposit || d.ftd) return 3;
  if (d.before_ftd) return 2;
  return 1;
}
// Echo the live detail into a validator-valid PUT body, changing ONLY members_only.
function buildBody(d, dlg) {
  const merchantIdsObj = {};
  (Array.isArray(d.merchant_ids) ? d.merchant_ids : []).map((m) => (typeof m === 'object' ? m.id : m)).forEach((id, i) => { merchantIdsObj[String(i)] = id; });
  const targetArr = Array.isArray(d.target) ? d.target : (d.target ? [d.target] : []);
  const targetObj = targetArr[0] || { type: 1, multiplier: '1.00', game_provider_codes: [] };
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
    members_only: 1,                           // ← the only intended change
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
    game_provider_codes: d.game_provider_codes ?? [],
    target: targetObj,
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
async function dialogSig(code) {
  const r = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=10`);
  const row = (r.data.rows || []).find((x) => x.code === code);
  return (row?.dialog_popup_list || []).map((d) => d.popup_id).sort((a, b) => a - b).join(',');
}
let popupsCache = null;
async function ensurePopups() {
  if (popupsCache) return popupsCache;
  const r = await authedFetch(site, '/api/bo/popups?perPage=500&page=1&date_type=start_date&sort_by=id&sort_order=desc');
  popupsCache = r.data?.rows || [];
  return popupsCache;
}

const results = [];
for (const id of ids) {
  const res = { id, status: 'pending' };
  try {
    const before = await getDetail(id);
    res.code = before.code;
    const dlgBefore = await dialogSig(before.code);
    const sigBefore = { mg: (before.member_group_ids || []).length, cat: (before.promotion_category_ids || []).length, gpc: (before.game_provider_codes || []).length, status: before.status, mtid: before.message_template_id, dep: depositStatus(before) };

    if (Number(before.members_only) === 1) { res.status = 'already_on'; console.log(`  • ${before.code}: already members_only=1 — skip`); results.push(res); continue; }
    if (!commit) { res.status = 'would_flip'; console.log(`  ~ ${before.code}: would set members_only 0→1  (groups:${sigBefore.mg} dlg:[${dlgBefore || '-'}] dep_status:${sigBefore.dep})`); results.push(res); continue; }

    let dlg = null;
    if (dlgBefore) {
      dlg = await readDialogForPreservation(site, before.code, await ensurePopups());
      if (!(dlg?.id && dlg.fullRow)) res.dialog_warn = `popup row unresolved (id=${dlg?.id ?? 'none'})`;
    }
    const body = buildBody(before, dlg);
    await authedFetch(site, `/api/bo/promotion/${id}`, { method: 'PUT', body });

    const after = await getDetail(id);
    const dlgAfter = await dialogSig(before.code);
    res.after_members_only = after.members_only;
    const drift = [];
    if ((after.member_group_ids || []).length !== sigBefore.mg) drift.push(`member_groups(${sigBefore.mg}→${(after.member_group_ids || []).length})`);
    if (dlgAfter !== dlgBefore) drift.push(`dialog(${dlgBefore || '-'}→${dlgAfter || '-'})`);
    if ((after.promotion_category_ids || []).length !== sigBefore.cat) drift.push('categories');
    if ((after.game_provider_codes || []).length !== sigBefore.gpc) drift.push('game_providers');
    if (after.status !== sigBefore.status) drift.push('status');
    if (after.message_template_id !== sigBefore.mtid) drift.push('msg_template');
    if (depositStatus(after) !== sigBefore.dep) drift.push(`deposit_status(${sigBefore.dep}→${depositStatus(after)})`);
    res.drift = drift;

    if (Number(after.members_only) === 1 && drift.length === 0) { res.status = 'ok'; console.log(`  ✓ ${String(id).padEnd(5)} ${before.code.padEnd(32)} members_only 0→1, no drift (groups:${(after.member_group_ids || []).length})`); }
    else if (Number(after.members_only) !== 1) { res.status = 'flip_failed'; console.log(`  ✗ ${before.code}: flip did not stick (after=${after.members_only})`); }
    else { res.status = 'DRIFT'; console.log(`  ⚠ ${before.code}: DRIFT [${drift.join(', ')}]`); }
    log({ event: 'put', ...res });
  } catch (e) {
    res.status = 'error'; res.error = e.message.split('\n').slice(0, 2).join(' | ').slice(0, 240);
    console.log(`  ✗ id=${id}: ${res.error}`);
    log({ event: 'error', ...res });
  }
  results.push(res);
  if (commit && (res.status === 'DRIFT' || res.status === 'flip_failed')) {
    console.log('\n*** STOPPING BATCH — verification failed on this promo. Investigate before continuing. ***');
    break;
  }
}

console.log('\n── Summary ──');
for (const r of results) {
  const tag = r.status === 'ok' ? '✓' : r.status === 'already_on' ? '•' : r.status === 'would_flip' ? '~' : '✗';
  console.log(`  ${tag} ${String(r.id).padEnd(5)} ${(r.code || '').padEnd(32)} ${r.status}${r.drift?.length ? ' [' + r.drift.join(',') + ']' : ''}${r.error ? ' — ' + r.error : ''}`);
}
const ok = results.filter((r) => r.status === 'ok').length;
const bad = results.filter((r) => !['ok', 'already_on', 'would_flip'].includes(r.status));
console.log(`\nset OK: ${ok}   problems: ${bad.length}`);
