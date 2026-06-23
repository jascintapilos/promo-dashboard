#!/usr/bin/env node
// Create a dedicated LC message template for qpro2 FT_REL_TLEO_LC_20PCT_300MX_BR (pid=468)
// by cloning qpro3's template for the same code (mtId=457, already has correct LC clause).
// Then link the new template to qpro2 pid=468.
//
// Template id=408 was created in the previous (partially-failed) run.
// This script resumes from Step 3 (PUT content to id=408) onward.

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site2 = getSite('qpro2');
const site3 = getSite('qpro3');

const NEW_MT_ID = 408;  // Created in previous run

// ── Step 1: fetch qpro3 source template (mtId=457) ────────────────────────────

console.log('Step 1: Fetching qpro3 LC template (mtId=457) as content source...');
const src = await authedFetch(site3, '/api/bo/messagetemplate/457');
const srcMt      = src.data.message_template;
const srcDetails = src.data.message_details;

console.log(`  name: ${srcMt.name}  code: ${srcMt.code}`);
for (const [k, d] of Object.entries(srcDetails)) {
  const clauseM = d.message?.match(/eligible game categor[^<]*/i);
  const clause = clauseM ? clauseM[0].replace(/&nbsp;/g,' ').trim() : '(no clause found)';
  console.log(`  locale ${k}: subject="${d.subject}"  clause="${clause}"`);
}

// ── Step 2: Check current state of id=408 on qpro2 ───────────────────────────

console.log(`\nStep 2: Checking existing template id=${NEW_MT_ID} on qpro2...`);
const existing = await authedFetch(site2, `/api/bo/messagetemplate/${NEW_MT_ID}`);
const exMt = existing.data.message_template;
const exDet = existing.data.message_details || {};
console.log(`  id: ${exMt.id}  name: ${exMt.name}  code: ${exMt.code}`);
console.log(`  Has message_details locales: ${Object.keys(exDet).join(',') || 'none'}`);

// ── Step 3: PUT content to id=408 (adds the locale message_details) ───────────

console.log(`\nStep 3: PUT locale content to qpro2 id=${NEW_MT_ID}...`);

const newDetails = {};
for (const [k, d] of Object.entries(srcDetails)) {
  newDetails[k] = {
    settings_locale_id: d.settings_locale_id,
    subject:  d.subject,
    message:  d.message,
  };
}

const putBody = {
  id:      NEW_MT_ID,
  name:    srcMt.name,
  section: srcMt.section,
  type:    srcMt.type,
  status:  srcMt.status,
  code:    srcMt.code,
  details: newDetails,
};

await authedFetch(site2, `/api/bo/messagetemplate/${NEW_MT_ID}`, {
  method: 'PUT',
  body: putBody,
});
console.log(`  ✓ PUT done`);

// ── Step 4: Verify content ────────────────────────────────────────────────────

console.log(`\nStep 4: Verifying template id=${NEW_MT_ID}...`);
const verify = await authedFetch(site2, `/api/bo/messagetemplate/${NEW_MT_ID}`);
const vMt = verify.data.message_template;
const vDet = verify.data.message_details || {};
console.log(`  name: ${vMt.name}  code: ${vMt.code}`);
for (const [k, d] of Object.entries(vDet)) {
  const clauseM = d.message?.match(/eligible game categor[^<]*/i);
  const clause = clauseM ? clauseM[0].replace(/&nbsp;/g,' ').trim() : '(no clause found)';
  console.log(`  locale ${k}: subject="${d.subject}"  clause="${clause}"`);
}

// ── Step 5: Link new template to qpro2 pid=468 ───────────────────────────────

console.log(`\nStep 5: Linking template ${NEW_MT_ID} to qpro2 pid=468...`);
const promoRes = await authedFetch(site2, '/api/bo/promotion/468');
const p = promoRes.data?.rows;

function fmtDate(d) {
  if (!d) return d;
  return String(d).replace('T', ' ').replace(/\.\d+Z?$/, '');
}
function arrToObj(arr) {
  // [45,62,...] → {"0":45,"1":62,...}  (QPRO PUT format)
  const o = {};
  (arr || []).forEach((v, i) => { o[String(i)] = v; });
  return o;
}

// Build category turnover from GET's promotion_category array (target_type=1)
const catTurnover = arrToObj(
  (p.promotion_category || []).filter(c => c.target_type === 1).map(c => c.category_id)
);

// Build indexed target from GET's target array
const targetObj = {};
(p.target || []).forEach((t, i) => {
  targetObj[String(i)] = {
    type:             t.type,
    multiplier:       t.multiplier,
    game_provider_ids: arrToObj(t.game_provider_ids || []),
  };
});

const promoPutBody = {
  id:    p.id,
  code:  p.code,
  name:  p.name,
  free_spin_game_provider_id: p.free_spin_game_provider_id ?? 0,
  ...(p.free_spin_game_code ? { free_spin_game_code: p.free_spin_game_code } : {}),
  promotion_category_turnover: catTurnover,
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
  last_deposit:   p.last_deposit ?? 0,
  auto_approve:   p.auto_approve,
  visible_by_affiliate: p.visible_by_affiliate ?? 0,
  recurring:      Number(p.recurring),
  max_per_player: p.max_per_player,
  daily_max:      p.daily_max,
  status:         1,
  limit_transfer_in:  p.limit_transfer_in ?? 0,
  limit_transfer_out: p.limit_transfer_out ?? 0,
  restrict_claim_round_active:    p.restrict_claim_round_active ?? 0,
  restrict_same_provider_launch:  p.restrict_same_provider_launch ?? 0,
  bonus_rate:     p.bonus_rate != null ? String(Number(p.bonus_rate).toFixed(2)) : undefined,
  ...(p.reset_frequency != null ? { reset_frequency: p.reset_frequency } : {}),
  auto_unlock:    p.auto_unlock,
  allow_cancel:   p.allow_cancel,
  game_provider_ids:    arrToObj(p.game_provider_ids || []),
  target:               targetObj,
  message_template_id:  NEW_MT_ID,
  message_template_sms_id: p.message_template_sms_id ?? 0,
  eligible_types:  Number(p.eligible_types),
  affiliate_group_ids:          [],
  telemarketer_ids:             [],
  normal_account_manager_ids:   [],
  vip_account_manager_ids:      [],
  requires_email:    p.requires_email ?? 0,
  requires_mobile:   p.requires_mobile ?? 0,
  requires_dob:      p.requires_dob ?? 0,
  requires_fullname: p.requires_fullname ?? 0,
  transfer_unlock:   p.transfer_unlock ?? 0,
  kyc_basic:     p.kyc_basic ?? 1,
  kyc_advanced:  p.kyc_advanced ?? 1,
  kyc_pro:       p.kyc_pro ?? 1,
  blacklist_template_id:  p.blacklist_template_id ?? 0,
  black_list_sub_categories: [],
  currencies_ids: p.currencies_ids ?? [],
  // DO NOT include promotion_currency — QPRO PUT wipes non-MYR rows
};

await authedFetch(site2, '/api/bo/promotion/468', {
  method: 'PUT',
  body: promoPutBody,
});

// ── Step 6: Confirm ──────────────────────────────────────────────────────────

console.log(`\nStep 6: Confirming link...`);
const confirm = await authedFetch(site2, '/api/bo/promotion/468');
const confirmMtId = confirm.data?.rows?.message_template_id;
console.log(`  qpro2 pid=468 message_template_id now: ${confirmMtId} (expected: ${NEW_MT_ID})`);
console.log(confirmMtId === NEW_MT_ID ? '  ✓ Confirmed correct' : '  ✗ MISMATCH');
