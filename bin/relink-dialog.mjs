#!/usr/bin/env node
// Re-attach dialog-popup links that the Edit→Submit dropped, WITHOUT disturbing
// the blacklist. Strategy: API PUT that (a) re-asserts dialog_popup_list from the
// promo's ORIGINAL popup id (recorded in captures/auto-reward-off.json), and
// (b) OMITS black_list_sub_categories so the BO re-derives it from
// blacklist_template_id (the behaviour the UI relies on) instead of wiping it.
//
//   node bin/relink-dialog.mjs --ids=1216           ← test one
//   node bin/relink-dialog.mjs --commit --ids=1216  ← live one
//   node bin/relink-dialog.mjs --commit             ← all flagged-lost promos
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const commit = argv.includes('--commit');
const idsArg = argv.find((a) => a.startsWith('--ids='));
const onlyIds = idsArg ? new Set(idsArg.split('=')[1].split(',').map(Number)) : null;

const site = getSite('ibc22');
const toYmdHis = (iso) => (iso ? String(iso).replace('T', ' ').replace(/\.\d+Z?$/, '') : null);
function depositStatus(d) { if (d.last_deposit) return 4; if (d.first_deposit || d.ftd) return 3; if (d.before_ftd) return 2; return 1; }

// PUT body: echo the live detail (validator-valid), force auto_reward=1, re-assert
// dialog from the given full popup row, and OMIT black_list_sub_categories so the
// server keeps deriving it from blacklist_template_id.
function buildBody(d, popupRow) {
  const merchantIdsObj = {};
  (d.merchant_ids || []).map((m) => (typeof m === 'object' ? m.id : m)).forEach((id, i) => { merchantIdsObj[String(i)] = id; });
  const targetArr = Array.isArray(d.target) ? d.target : (d.target ? [d.target] : []);
  const targetObj = targetArr[0] || { type: 1, multiplier: '1.00', game_provider_codes: [] };
  return {
    id: d.id, code: d.code, name: d.name, bonus_settings: d.bonus_settings ?? 1,
    promo_type: d.promo_type, promo_sub_type: d.promo_sub_type,
    promotion_ids: Array.isArray(d.promo_linked_ids) ? d.promo_linked_ids : [],
    valid_from: toYmdHis(d.valid_from), valid_to: toYmdHis(d.valid_to),
    validity: d.validity ?? 1, reward_validity: d.reward_validity ?? 1,
    frequency_type: d.frequency_type ?? 1, frequency: d.frequency ?? [],
    before_ftd: d.before_ftd ?? 0, first_deposit: d.first_deposit ?? 0, ftd: d.ftd ?? 0, last_deposit: d.last_deposit ?? 0,
    deposit_status: depositStatus(d),
    limit_transfer_out: d.limit_transfer_out ?? 0, limit_transfer_in: d.limit_transfer_in ?? 0,
    auto_unlock: d.auto_unlock ?? 1, allow_cancel: d.allow_cancel ?? 0, withdrawal_unlock: d.withdrawal_unlock ?? 0,
    auto_approve: d.auto_approve ?? 1, auto_reward_activation: 1, recurring: d.recurring ?? 0,
    reset_frequency: d.reset_frequency || 1, reset_month: d.reset_month || 1,
    max_per_player: d.max_per_player ?? 1, daily_max: d.daily_max ?? 1,
    members_only: d.members_only ?? 0, fingerprint_check: d.fingerprint_check ?? 0, freespin_check: d.freespin_check ?? 0,
    allow_deposit: d.allow_deposit ?? 0, allow_continuous_claim: d.allow_continuous_claim ?? 0,
    message_template_id: d.message_template_id ?? 0, message_template_sms_id: d.message_template_sms_id ?? 0,
    bonus_rate: d.bonus_rate ?? 0, deposit_count: d.deposit_count ?? 0, active_period: d.active_period ?? 0,
    eligible_types: d.eligible_types ?? 1, free_spin_game_provider_id: d.free_spin_game_provider_id ?? 0,
    ...(d.free_spin_game_code != null ? { free_spin_game_code: d.free_spin_game_code } : {}),
    blacklist_template_id: d.blacklist_template_id,
    promotion_category_ids: d.promotion_category_ids ?? [], game_provider_codes: d.game_provider_codes ?? [],
    target: targetObj, member_group_ids: d.member_group_ids ?? [],
    affiliate_group_ids: d.affiliate_group_ids ?? [], affiliate_ids: d.affiliate_ids ?? [], telemarketer_ids: d.telemarketer_ids ?? [],
    requires_email: d.requires_email ?? 0, requires_mobile: d.requires_mobile ?? 0, requires_dob: d.requires_dob ?? 0, requires_fullname: d.requires_fullname ?? 0,
    kyc_listing: d.kyc_listing ?? 0,
    // black_list_sub_categories intentionally OMITTED → server re-derives from template
    merchant_ids: merchantIdsObj,
    dialog_popup_list: popupRow ? { '0': { ...popupRow, promotion_id: d.id } } : {},
    status: d.status,
  };
}

// targets: promos that lost dialogs (recorded original popup id in auto-reward-off.json)
let targets = JSON.parse(readFileSync('captures/auto-reward-off.json', 'utf8'))
  .filter((r) => r.created_by === 'promo_testbot' && (r.dialog_popups || []).length > 0);
if (onlyIds) targets = targets.filter((t) => onlyIds.has(t.id));

// popups cache
const popups = (await authedFetch(site, '/api/bo/popups?perPage=500&page=1&date_type=start_date&sort_by=id&sort_order=desc')).data?.rows || [];
const popupById = Object.fromEntries(popups.map((p) => [p.id, p]));

console.log(`${commit ? 'LIVE' : 'DRY-RUN'} — re-linking dialogs on ${targets.length} promos\n`);
for (const t of targets) {
  const wantPopupId = t.dialog_popups[0];
  try {
    const before = (await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(t.code)}&perPage=10`)).data.rows.find((x) => x.id === t.id);
    const curDlg = (before?.dialog_popup_list || []).map((x) => x.popup_id).join(',') || '-';
    if (String(curDlg) === String(wantPopupId)) { console.log(`  • ${t.code}: dialog ${wantPopupId} already linked — skip`); continue; }
    if (!commit) { console.log(`  ~ ${t.code}: would re-link popup ${wantPopupId} (now ${curDlg})`); continue; }

    const popupRow = popupById[wantPopupId];
    if (!popupRow) { console.log(`  ✗ ${t.code}: popup ${wantPopupId} not found in popups list`); continue; }
    const d = (await authedFetch(site, `/api/bo/promotion/${t.id}`)).data.rows;
    const blkBefore = (d.blacklist_sub_categories || []).length;
    await authedFetch(site, `/api/bo/promotion/${t.id}`, { method: 'PUT', body: buildBody(d, popupRow) });

    // verify (allow async blacklist re-derivation a moment)
    await new Promise((r) => setTimeout(r, 1500));
    const after = (await authedFetch(site, `/api/bo/promotion/${t.id}`)).data.rows;
    const lr = (await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(t.code)}&perPage=10`)).data.rows.find((x) => x.id === t.id);
    const dlgAfter = (lr?.dialog_popup_list || []).map((x) => x.popup_id).join(',') || '-';
    const blkAfter = (after.blacklist_sub_categories || []).length;
    const dlgOk = String(dlgAfter) === String(wantPopupId);
    console.log(`  ${dlgOk && blkAfter > 0 ? '✓' : '⚠'} ${String(t.id).padEnd(5)} ${t.code.padEnd(30)} dialog→${dlgAfter} (want ${wantPopupId})  blacklist ${blkBefore}→${blkAfter}  auto=${after.auto_reward_activation}`);
  } catch (e) {
    console.log(`  ✗ ${t.code}: ${e.message.split('\n').slice(0, 2).join(' | ').slice(0, 200)}`);
  }
}
