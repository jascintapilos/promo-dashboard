// Fix the 2 QPRO2 mismatches found in the QP2D Promo Codes sheet QC.
//
// Fix #1 — QPRO2 id=473 (FT_REL_TLEO_50PCT_25MX_SLOT):
//   - SGD promotioncurrency row id=956: max_bonus 26.00 → 25.00
//   - promotion_name_id=1660 (MY_EN): "VIP Exclusive Offer ..." → "Time Limited Exclusive Offer ..."
//   - promotion_name_id=1661 (SG_EN): "VIP Exclusive Offer ..." → "Time Limited Exclusive Offer ..."
//
// Fix #2 — QPRO2 id=474 (REL_TLEO_SL_20PCT_10MX):
//   - top-level bonus_rate 50 → 20
//
// Strategy: GET each row, modify the specific field, PUT same id.
// Default = dry-run; pass --commit to actually send PUTs.

import fs from 'node:fs';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const commit = process.argv.includes('--commit');
const site = getSite('qpro2');

const TARGET_NAME_EN = 'Time Limited Exclusive Offer - 50% Reload Bonus';

const fixes = [];

// Fix #1a — SGD max_bonus 26 → 25
async function fixSgdMaxBonus() {
  const r = await authedFetch(site, '/api/bo/promotioncurrency?promotion_id=473');
  const sgd = r.data.rows.find(x => x.currency === 'SGD');
  if (!sgd) throw new Error('SGD row not found for promotion 473');
  if (Number(sgd.max_bonus) === 25) {
    return { step: '#1a SGD max_bonus', status: 'ALREADY_CORRECT', current: sgd.max_bonus };
  }
  const body = { ...sgd, currency_id: sgd.settings_currency_id, max_bonus: '25.00' };
  console.log(`  PUT /api/bo/promotioncurrency/${sgd.id}  body changes: max_bonus ${sgd.max_bonus} → 25.00`);
  if (!commit) return { step: '#1a SGD max_bonus', status: 'DRY_RUN', body };
  const res = await authedFetch(site, `/api/bo/promotioncurrency/${sgd.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { step: '#1a SGD max_bonus', status: 'COMMITTED', response: JSON.stringify(res).slice(0, 200) };
}

// Fix #1b — MY_EN + SG_EN promotion_name "VIP Exclusive..." → "Time Limited Exclusive..."
async function fixEnNames() {
  const r = await authedFetch(site, '/api/bo/promotionname?promotion_id=473');
  const out = [];
  for (const row of r.data.rows) {
    if (!row.locale?.endsWith('_EN')) continue;
    if (!row.promotion_name?.startsWith('VIP Exclusive')) {
      out.push({ step: `#1b ${row.locale} name`, status: 'ALREADY_CORRECT', current: row.promotion_name });
      continue;
    }
    const body = { ...row, promotion_id: 473, currency_id: row.currency_id, settings_locale_id: row.settings_locale_id, promotion_name: TARGET_NAME_EN, rewards_name: TARGET_NAME_EN };
    console.log(`  PUT /api/bo/promotionname/${row.promotion_name_id}  ${row.locale}: "${row.promotion_name}" → "${TARGET_NAME_EN}"`);
    if (!commit) { out.push({ step: `#1b ${row.locale} name`, status: 'DRY_RUN', body }); continue; }
    try {
      const res = await authedFetch(site, `/api/bo/promotionname/${row.promotion_name_id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      out.push({ step: `#1b ${row.locale} name`, status: 'COMMITTED', response: JSON.stringify(res).slice(0, 200) });
    } catch (e) {
      out.push({ step: `#1b ${row.locale} name`, status: 'FAILED', error: e.message.slice(0, 300) });
    }
  }
  return out;
}

// Fix #2 — top-level bonus_rate 50 → 20
async function fixBonusRate() {
  const det = await authedFetch(site, '/api/bo/promotion/474');
  const row = det.data.rows;
  if (Number(row.bonus_rate) === 20) {
    return { step: '#2 bonus_rate', status: 'ALREADY_CORRECT', current: row.bonus_rate };
  }
  // Build minimal PUT body matching what the canary's buildUpdate sends.
  // Per memory: QPRO PUT must NOT include promotion_currency (silent SGD/IDR wipe).
  // BO expects Y-m-d H:i:s (no timezone) and category_id (not category row id).
  const fmtDate = (iso) => iso ? String(iso).replace(/T/, ' ').replace(/\.\d+Z?$/, '').slice(0, 19) : null;
  const catIds = (row.promotion_category || []).map(x => x.category_id);
  const body = {
    id: row.id,
    code: row.code,
    name: row.name,
    free_spin_game_provider_id: row.free_spin_game_provider_id ?? 0,
    promotion_category_turnover: catIds,
    promotion_category_winloss: [],
    promo_type: row.promo_type,
    promo_sub_type: Number(row.promo_sub_type),
    promotion_ids: [],
    valid_from: fmtDate(row.valid_from),
    valid_to: fmtDate(row.valid_to),
    validity: row.validity,
    reward_validity: row.reward_validity,
    frequency_type: row.frequency_type,
    frequency: row.frequency,
    limit_transfer_out: row.limit_transfer_out,
    limit_transfer_in: row.limit_transfer_in,
    restrict_claim_round_active: row.restrict_claim_round_active,
    restrict_same_provider_launch: row.restrict_same_provider_launch,
    bonus_rate: 20,            // ← THE CHANGE
    auto_unlock: row.auto_unlock,
    transfer_unlock: row.transfer_unlock,
    allow_cancel: row.allow_cancel,
    last_deposit: row.last_deposit,
    auto_approve: row.auto_approve,
    recurring: Number(row.recurring),
    reset_frequency: row.reset_frequency,
    reset_day: row.reset_day,
    max_per_player: row.max_per_player,
    daily_max: row.daily_max,
    eligible_types: row.eligible_types,
    kyc_basic: row.kyc_basic,
    kyc_advanced: row.kyc_advanced,
    kyc_pro: row.kyc_pro,
    requires_email: row.requires_email,
    requires_mobile: row.requires_mobile,
    requires_dob: row.requires_dob,
    requires_fullname: row.requires_fullname,
    visible_by_affiliate: row.visible_by_affiliate,
    blacklist_id: row.blacklist_id,
    target: row.target,        // preserve target multiplier etc.
    member_group_ids: row.member_group_ids || [],
    game_provider_ids: row.game_provider_ids || [],
    message_template_id: row.message_template_id,
    message_template_sms_id: row.message_template_sms_id,
    dialog_popup_list: row.dialog_popup_list || [],
  };
  console.log(`  PUT /api/bo/promotion/474  bonus_rate ${row.bonus_rate} → 20`);
  if (!commit) return { step: '#2 bonus_rate', status: 'DRY_RUN', body: Object.keys(body).join(',') };
  const res = await authedFetch(site, `/api/bo/promotion/474`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { step: '#2 bonus_rate', status: 'COMMITTED', response: JSON.stringify(res).slice(0, 200) };
}

console.log(`Mode: ${commit ? 'LIVE (--commit)' : 'DRY-RUN'}`);
console.log('━━━━━━━━━━ Planning PUTs ━━━━━━━━━━');

async function tryStep(label, fn) {
  try { return await fn(); }
  catch (e) { return { step: label, status: 'FAILED', error: e.message.slice(0, 300) }; }
}
fixes.push(await tryStep('#1a SGD max_bonus', fixSgdMaxBonus));
const nameRes = await tryStep('#1b EN names', fixEnNames);
if (Array.isArray(nameRes)) fixes.push(...nameRes); else fixes.push(nameRes);
fixes.push(await tryStep('#2 bonus_rate', fixBonusRate));

console.log('\n━━━━━━━━━━ RESULT ━━━━━━━━━━');
for (const f of fixes) {
  console.log(`  ${f.step}: ${f.status}${f.current != null ? ` (current=${f.current})` : ''}`);
  if (f.error) console.log(`     err: ${f.error}`);
}

fs.writeFileSync('captures/api-runs/qpro2-fix-' + (commit ? 'commit' : 'dryrun') + '.json',
  JSON.stringify({ generated: new Date().toISOString(), mode: commit ? 'live' : 'dryrun', fixes }, null, 2));
