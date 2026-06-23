#!/usr/bin/env node
// Tick "Auto Reward Activation" (auto_reward_activation -> 1) on QP2 promos via
// API, using the proven GET-detail -> change-one-field -> PUT-back round trip
// (same pattern canary-write.js uses for dialog-linking on QP2A). The BO accepts
// its own /api/bo/promotion/{id} detail body wholesale on PUT, so currency rows,
// blacklist sub-categories, member groups, caps all ride along untouched.
//
// Dialog-popup links are NOT in the GET detail body, so we re-assert any existing
// link explicitly (readDialogForPreservation) to guarantee popups can't drop.
//
//   node bin/set-auto-reward-api.mjs                     ← dry-run
//   node bin/set-auto-reward-api.mjs --commit --ids=1217 ← canary (one id)
//   node bin/set-auto-reward-api.mjs --commit            ← full batch (34)
//
// Targets: captures/auto-reward-off.json filtered to created_by==='promo_testbot'.
import { authedFetch, readDialogForPreservation } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const commit = argv.includes('--commit');
const idsArg = argv.find((a) => a.startsWith('--ids='));
const limitArg = argv.find((a) => a.startsWith('--limit='));
const onlyIds = idsArg ? new Set(idsArg.split('=')[1].split(',').map(Number)) : null;
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

const site = getSite('ibc22');
let targets = JSON.parse(readFileSync('captures/auto-reward-off.json', 'utf8'))
  .filter((r) => r.created_by === 'promo_testbot');
if (onlyIds) targets = targets.filter((t) => onlyIds.has(t.id));
if (Number.isFinite(LIMIT)) targets = targets.slice(0, LIMIT);

console.log(`${commit ? 'LIVE' : 'DRY-RUN'} — ${targets.length} promo_testbot codes (Auto Reward OFF)\n`);

const OUT = path.resolve('captures/auto-reward-runs'); mkdirSync(OUT, { recursive: true });
const logFile = path.join(OUT, `api-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
const log = (ev) => appendFileSync(logFile, JSON.stringify({ ts: new Date().toISOString(), ...ev }) + '\n');

const getDetail = async (id) => (await authedFetch(site, `/api/bo/promotion/${id}`)).data.rows;

// ISO "2026-05-29T08:03:00.000000Z" -> "2026-05-29 08:03:00" (PUT validator format)
const toYmdHis = (iso) => (iso ? String(iso).replace('T', ' ').replace(/\.\d+Z?$/, '') : null);
// deposit_status int from the existing FTD flags (1=None,2=Before,3=First,4=Last)
function depositStatus(d) {
  if (d.last_deposit) return 4;
  if (d.first_deposit || d.ftd) return 3;
  if (d.before_ftd) return 2;
  return 1;
}
// Transform a GET /promotion/{id} detail into a validator-valid PUT body that
// changes ONLY auto_reward_activation. Everything else is echoed from the live
// detail: status stays Active, blacklist sub-cats / member groups / categories /
// target / caps / FTD flags / template links all preserved. Dialog popup link
// is re-asserted from `dlg` (GET detail omits it). promotion_currency is NOT
// sent (separate sub-resource; absence verified non-fatal + non-wiping).
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
    auto_reward_activation: 1,                 // ← the only intended change
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
async function currencySig(id) {
  const rows = (await authedFetch(site, `/api/bo/promotioncurrency?promotion_id=${id}`)).data.rows || [];
  return rows.map((c) => `${c.currency}=rate:${c.bonus_rate}|min:${c.min_deposit ?? c.min_transfer}|maxB:${c.max_bonus}|amt:${c.bonus_amount}|rnd:${c.rounds}|apl:${c.amount_per_line}|bank:${(c.deposit_options || []).length}`).sort().join(' ;; ');
}
async function dialogSig(code) {
  const r = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=10`);
  const row = (r.data.rows || []).find((x) => x.code === code);
  return (row?.dialog_popup_list || []).map((d) => d.popup_id).sort((a, b) => a - b).join(',');
}

// Cache the popups list once (readDialogForPreservation needs it; 500/req otherwise).
let popupsCache = null;
async function ensurePopups() {
  if (popupsCache) return popupsCache;
  const r = await authedFetch(site, '/api/bo/popups?perPage=500&page=1&date_type=start_date&sort_by=id&sort_order=desc');
  popupsCache = r.data?.rows || [];
  return popupsCache;
}

const results = [];
for (const t of targets) {
  const res = { id: t.id, code: t.code, merchants: t.merchants, status: 'pending' };
  try {
    const before = await getDetail(t.id);
    res.before_auto = before.auto_reward_activation;
    const curBefore = await currencySig(t.id);
    const dlgBefore = await dialogSig(t.code);
    const sigBefore = { blk: (before.blacklist_sub_categories || []).length, mg: (before.member_group_ids || []).length, cat: (before.promotion_category_ids || []).length, gpc: (before.game_provider_codes || []).length, mpp: before.max_per_player, status: before.status, mtid: before.message_template_id, bt: before.blacklist_template_id };

    if (Number(before.auto_reward_activation) === 1) { res.status = 'already_on'; console.log(`  • ${t.code}: already ON — skip`); results.push(res); continue; }
    if (!commit) { res.status = 'would_flip'; console.log(`  ~ ${t.code}: would flip OFF→ON  (cur:[${curBefore.slice(0, 40)}…] dlg:[${dlgBefore || '-'}] blk:${sigBefore.blk} mg:${sigBefore.mg})`); results.push(res); continue; }

    // Resolve the existing dialog link (GET detail omits it) so we re-assert it.
    let dlg = null;
    if (dlgBefore) {
      dlg = await readDialogForPreservation(site, t.code, await ensurePopups());
      if (!(dlg?.id && dlg.fullRow)) res.dialog_warn = `popup row unresolved (id=${dlg?.id ?? 'none'})`;
    }
    const body = buildBody(before, dlg);
    await authedFetch(site, `/api/bo/promotion/${t.id}`, { method: 'PUT', body });

    // Verify: only auto_reward changed, everything else intact.
    const after = await getDetail(t.id);
    const curAfter = await currencySig(t.id);
    const dlgAfter = await dialogSig(t.code);
    res.after_auto = after.auto_reward_activation;
    const drift = [];
    if (curAfter !== curBefore) drift.push('currency');
    if (dlgAfter !== dlgBefore) drift.push(`dialog(${dlgBefore || '-'}→${dlgAfter || '-'})`);
    if ((after.blacklist_sub_categories || []).length !== sigBefore.blk) drift.push('blacklist_sub');
    if ((after.member_group_ids || []).length !== sigBefore.mg) drift.push('member_groups');
    if ((after.promotion_category_ids || []).length !== sigBefore.cat) drift.push('categories');
    if ((after.game_provider_codes || []).length !== sigBefore.gpc) drift.push('game_providers');
    if (after.max_per_player !== sigBefore.mpp) drift.push('max_per_player');
    if (after.status !== sigBefore.status) drift.push('status');
    if (after.message_template_id !== sigBefore.mtid) drift.push('msg_template');
    if (after.blacklist_template_id !== sigBefore.bt) drift.push('blacklist_template');
    res.drift = drift;

    if (Number(after.auto_reward_activation) === 1 && drift.length === 0) { res.status = 'ok'; console.log(`  ✓ ${String(t.id).padEnd(5)} ${t.code.padEnd(32)} auto_reward 0→1, no drift`); }
    else if (Number(after.auto_reward_activation) !== 1) { res.status = 'flip_failed'; console.log(`  ✗ ${t.code}: flip did not stick (after=${after.auto_reward_activation})`); }
    else { res.status = 'DRIFT'; console.log(`  ⚠ ${t.code}: DRIFT [${drift.join(', ')}]`); }
    log({ event: 'put', ...res });
  } catch (e) {
    res.status = 'error'; res.error = e.message.split('\n').slice(0, 2).join(' | ').slice(0, 240);
    console.log(`  ✗ ${t.code}: ${res.error}`);
    log({ event: 'error', ...res });
  }
  results.push(res);

  // Safety: abort the batch if a live change drifts or fails (don't repeat 33×).
  if (commit && (res.status === 'DRIFT' || res.status === 'flip_failed')) {
    console.log('\n*** STOPPING BATCH — verification failed on this promo. Investigate before continuing. ***');
    break;
  }
}

console.log('\n── Summary ──');
const ok = results.filter((r) => r.status === 'ok').length;
const onAlready = results.filter((r) => r.status === 'already_on').length;
const bad = results.filter((r) => !['ok', 'already_on', 'would_flip'].includes(r.status));
for (const r of results) {
  const tag = r.status === 'ok' ? '✓' : r.status === 'already_on' ? '•' : r.status === 'would_flip' ? '~' : '✗';
  console.log(`  ${tag} ${String(r.id).padEnd(5)} ${r.code.padEnd(32)} ${r.status}${r.drift?.length ? ' [' + r.drift.join(',') + ']' : ''}${r.error ? ' — ' + r.error : ''}`);
}
console.log(`\nflipped OK: ${ok}   already ON: ${onAlready}   problems: ${bad.length}`);
log({ event: 'run_done', ok, alreadyOn: onAlready, problems: bad.length });
