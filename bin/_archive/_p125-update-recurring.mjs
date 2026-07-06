#!/usr/bin/env node
// Update P125 (June tab): set Recurring=Recurring, Reset Frequency=Daily Max,
// Max Per Player=99999, Daily Max=99999, on all 5 unique BO records
// (QPRO1/2/3/4 individually + QP2 shared record covering A/B/C/D).
//
// Usage: node bin/_p125-update-recurring.mjs          # dry-run
//        node bin/_p125-update-recurring.mjs --commit  # live

import { getSite } from '../src/sites.js';
import { authedFetch, findPromotionByCode } from '../src/api-client.js';

const COMMIT = process.argv.includes('--commit');

const TARGETS = [
  { brand: 'QPRO1',        code: 'REL_BOOSTER_80FS_GOOSS_15X_V2', site: 'qpro1', platform: 'qpro' },
  { brand: 'QPRO2',        code: 'REL_BOOSTER_80FS_GOOSS_15X',    site: 'qpro2', platform: 'qpro' },
  { brand: 'QPRO3',        code: 'REL_BOOSTER_80FS_GOOSS_15X',    site: 'qpro3', platform: 'qpro' },
  { brand: 'QPRO4',        code: 'REL_BOOSTER_80FS_GOOSS_15X',    site: 'qpro4', platform: 'qpro' },
  { brand: 'QP2 (A/B/C/D)',code: 'REL_BOOSTER_80FS_GOOSS_15X',    site: 'ibc22', merchantId: 1, platform: 'qp2' },
];

function isoToYmdHms(iso) {
  if (!iso || typeof iso !== 'string') return iso;
  return iso.replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '');
}
function arrToIdxObj(arr) {
  if (!Array.isArray(arr)) return arr;
  return Object.fromEntries(arr.map((v, i) => [String(i), v]));
}
function normalizeQproBody(body) {
  if (body.valid_from) body.valid_from = isoToYmdHms(body.valid_from);
  if (body.valid_to)   body.valid_to   = isoToYmdHms(body.valid_to);
  const nullDrops = ['free_spin_game_code','promo_p1_id','promo_p2_id','promo_p2_code','promo_p2_name','reset_day','reset_month','free_spin_game_provider_id','blacklist_template_id','bonus_rate'];
  for (const k of nullDrops) if (body[k] == null) delete body[k];
  const getOnly = ['created_at','updated_at','created_by','updated_by','deleted_at','promotion_category','currencies','message_templates','sms_message_templates','bonus_type','member_group','target_type','game_provider','category','currencies_bonus_type','kyc_type','phase_game_provider_code','phase_game_provider_category','kyc_listing','bonus_settings','site_name','merchant_name','platform_name','frequency_text','before_ftd','ftd','deposit_count_reset_frequency','deposit_count_reset_day','fingerprint_check','freespin_check','allow_deposit','allow_continuous_claim','auto_reward_activation','withdrawal_unlock','active_period','members_only'];
  for (const k of getOnly) delete body[k];
  return body;
}
function normalizeQp2Body(body) {
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
    body.target = { type: t.type, multiplier: Number(t.multiplier), game_provider_codes: arrToIdxObj(t.game_provider_codes) };
  }
  for (const k of ['game_provider_codes','promotion_category_ids','member_group_ids','currencies_ids','affiliate_ids','affiliate_group_ids','telemarketer_ids','blacklist_sub_categories','promo_linked_ids']) {
    if (Array.isArray(body[k])) body[k] = arrToIdxObj(body[k]);
  }
  const dropKeys = ['created_at','updated_at','created_by','updated_by','deleted_at','promotion_category','currencies','message_templates','sms_message_templates','bonus_type','member_group','target_type','game_provider','category','currencies_bonus_type','kyc_type','phase_game_provider_code','phase_game_provider_category','kyc_listing','bonus_settings','site_name','merchant_name','platform_name','frequency_text','before_ftd','ftd','promo_p1_id','promo_p2_id','promo_p2_code','promo_p2_name'];
  for (const k of dropKeys) delete body[k];
  const nullDrops = ['free_spin_game_code','reset_day','reset_month','valid_to'];
  for (const k of nullDrops) if (body[k] == null) delete body[k];
  return body;
}

console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`P125 RECURRING UPDATE — ${COMMIT ? 'LIVE (--commit)' : 'DRY-RUN'}`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

const results = [];
for (const t of TARGETS) {
  const site = getSite(t.site);
  const found = await findPromotionByCode(site, t.code, t.merchantId ? { merchantId: t.merchantId } : {});
  if (!found) { console.log(`${t.brand}: NOT FOUND`); results.push({ ...t, ok: false }); continue; }

  const detail = await authedFetch(site, `/api/bo/promotion/${found.id}`);
  const body = detail?.data?.rows;
  if (!body) { console.log(`${t.brand}: GET failed`); results.push({ ...t, ok: false }); continue; }

  console.log(`── ${t.brand} (id=${found.id}) ──`);
  console.log(`  before: recurring=${body.recurring} reset_frequency=${body.reset_frequency} max_per_player=${body.max_per_player} daily_max=${body.daily_max}`);

  body.recurring = 1;
  body.reset_frequency = 1; // Daily Max
  body.max_per_player = 99999;
  body.daily_max = 99999;

  if (t.platform === 'qpro') normalizeQproBody(body);
  else normalizeQp2Body(body);

  if (!COMMIT) { console.log('  [dry] would PUT'); results.push({ ...t, ok: true, dry: true }); continue; }

  try {
    const res = await authedFetch(site, `/api/bo/promotion/${found.id}`, { method: 'PUT', body });
    const ok = res?.success !== false;
    console.log(`  → PUT: ${ok ? '✅ OK' : '❌ ' + JSON.stringify(res).slice(0,200)}`);
    results.push({ ...t, ok });
  } catch (e) {
    console.log(`  → PUT: ❌ ${e.message.split('\n')[0].slice(0,250)}`);
    results.push({ ...t, ok: false, err: e.message });
  }
}

console.log(`\nSummary: ${results.filter(r=>r.ok).length}/${results.length} ${COMMIT ? 'updated' : 'would update'}`);
if (!COMMIT) console.log('Re-run with --commit to apply.');
