#!/usr/bin/env node
// Restore 1217's 29 blacklist_sub_categories (from the before-snapshot) AND
// probe the correct PUT shape. Tries an index-keyed object-map of the GET
// entries. Verifies by re-reading the count. Zero risk: 1217 is already 0.
import { authedFetch, readDialogForPreservation } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { readFileSync } from 'node:fs';

const site = getSite('ibc22');
const snap = JSON.parse(readFileSync('captures/canary-1217-before.json', 'utf8'));
const want = snap.detail.blacklist_sub_categories || [];
console.log(`snapshot has ${want.length} blacklist_sub entries to restore`);

const toYmdHis = (iso) => (iso ? String(iso).replace('T', ' ').replace(/\.\d+Z?$/, '') : null);
function depositStatus(d) { if (d.last_deposit) return 4; if (d.first_deposit || d.ftd) return 3; if (d.before_ftd) return 2; return 1; }

const d = (await authedFetch(site, '/api/bo/promotion/1217')).data.rows;
const dlg = await readDialogForPreservation(site, '1217' && d.code);

const merchantIdsObj = {};
(d.merchant_ids || []).map((m) => (typeof m === 'object' ? m.id : m)).forEach((id, i) => { merchantIdsObj[String(i)] = id; });
const targetArr = Array.isArray(d.target) ? d.target : (d.target ? [d.target] : []);
const targetObj = targetArr[0] || { type: 1, multiplier: '1.00', game_provider_codes: [] };
const dialogList = (dlg?.id && dlg.fullRow) ? { '0': { ...dlg.fullRow, promotion_id: d.id } } : {};

// candidate shape: index-keyed object-map of the GET entries
const blkObj = {};
want.forEach((e, i) => { blkObj[String(i)] = e; });

const body = {
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
  black_list_sub_categories: blkObj,    // ← object-map candidate
  merchant_ids: merchantIdsObj, dialog_popup_list: dialogList, status: d.status,
};

try {
  await authedFetch(site, '/api/bo/promotion/1217', { method: 'PUT', body });
  const after = (await authedFetch(site, '/api/bo/promotion/1217')).data.rows;
  console.log(`AFTER object-map PUT → blacklist_sub=${(after.blacklist_sub_categories || []).length}  auto_reward=${after.auto_reward_activation}`);
  console.log((after.blacklist_sub_categories || []).length === want.length ? 'SHAPE CRACKED ✓ (object-map preserves)' : 'object-map did NOT restore — shape still wrong');
} catch (e) {
  console.log('PUT failed:', e.message.split('\n').slice(0, 3).join(' | ').slice(0, 300));
}
