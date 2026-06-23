// Recreate 6 GOOSS FS codes on QPRO1 with _V2 suffix.
// Original codes (1026-1031) were archived; these are fresh POSTs.
//
// Usage:
//   node bin/recreate-qpro1-gooss-v2.mjs          # dry run
//   node bin/recreate-qpro1-gooss-v2.mjs --commit  # live
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const DRY_RUN = !process.argv.includes('--commit');
if (DRY_RUN) console.log('[DRY RUN] Pass --commit to execute\n');

const SITE_ID = 'qpro1';
const GAME_CODE = 'vs20olympgold';
const PROVIDER_ID = 96;      // PP2 on QPRO1
const BLACKLIST_ID = 6;       // Slots Only
const SGD_CURRENCY_ID = '3';
const VALIDITY = 7;
const REWARD_VALIDITY = 30;

const PROMOS = [
  { rn:'P122', code:'WELC_BASE_80FS_GOOSS_20X_V2',     name:'80 FS GOOSS Welcome Base',     sub_type:1, spin:80,  to:20, min_dep:100 },
  { rn:'P123', code:'WELC_BOOSTER_100FS_GOOSS_25X_V2', name:'100 FS GOOSS Welcome Booster',  sub_type:1, spin:100, to:25, min_dep:150 },
  { rn:'P124', code:'REL_BASE_60FS_GOOSS_12X_V2B',     name:'60 FS GOOSS Reload Base',       sub_type:2, spin:60,  to:12, min_dep:100 },
  { rn:'P125', code:'REL_BOOSTER_80FS_GOOSS_15X_V2',   name:'80 FS GOOSS Reload Booster',    sub_type:2, spin:80,  to:15, min_dep:150 },
  { rn:'P126', code:'RET_GOOSS_BASE_50FS_10X_V2',      name:'50 FS GOOSS Retention Base',    sub_type:2, spin:50,  to:10, min_dep:80  },
  { rn:'P127', code:'RET_GOOSS_BOOST_60FS_12X_V2',     name:'60 FS GOOSS Retention Boost',   sub_type:2, spin:60,  to:12, min_dep:100 },
];

function nowYmdHms() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

function arrayToIntObj(arr) {
  const o = {};
  arr.forEach((v, i) => { o[String(i)] = v; });
  return o;
}

function buildPost(meta) {
  return {
    code: meta.code,
    name: meta.name,
    free_spin_game_provider_id: PROVIDER_ID,
    free_spin_game_code: GAME_CODE,
    promotion_category_turnover: { '0': 3 },
    promo_type: 4,
    promo_sub_type: String(meta.sub_type),
    valid_from: nowYmdHms(),
    validity: VALIDITY,
    reward_validity: REWARD_VALIDITY,
    frequency: [],
    frequency_type: '1',
    first_deposit: 0,
    last_deposit: true,
    auto_approve: true,
    visible_by_affiliate: 0,
    recurring: '0',
    max_per_player: 99999,
    daily_max: 1,
    limit_transfer_in: true,
    limit_transfer_out: true,
    restrict_claim_round_active: true,
    restrict_same_provider_launch: 0,
    auto_unlock: true,
    allow_cancel: 0,
    fixed_amount: 0,
    bonus_rate: 0,
    game_provider_ids: { '0': PROVIDER_ID },
    target: {
      '0': {
        type: 1,
        multiplier: meta.to,
        game_provider_ids: { '0': PROVIDER_ID },
      },
    },
    deposit_count: 0,
    eligible_types: '1',
    telemarketer_ids: [],
    normal_account_manager_ids: [],
    vip_account_manager_ids: [],
    requires_email: false,
    requires_mobile: false,
    requires_dob: false,
    requires_fullname: false,
    transfer_unlock: false,
    kyc_basic: true,
    kyc_advanced: true,
    kyc_pro: true,
    blacklist_id: BLACKLIST_ID,
    black_list_sub_categories: [],
    dialog_popup_list: [],
    member_group_ids: [],
    promotion_currency: {
      '0': {
        currency_id: SGD_CURRENCY_ID,
        coins: 1,
        amount_per_line: 0.02,
        rounds: meta.spin,
        lines: 10,
        min_transfer: meta.min_dep,
        max_total_applications: 0,
        max_total_bonus: 0,
        status: '1',
        max_transfer_out: 0,
        promo_type: 4,
        currency: 'SGD',
        current_players: 0,
        used_budget: 0,
      },
    },
  };
}

const s = getSite(SITE_ID);
let created = 0, errors = 0;

for (const meta of PROMOS) {
  console.log(`\n── ${meta.rn} ${meta.code} ──`);

  // Check not already existing
  const check = await authedFetch(s, `/api/bo/promotion?code=${meta.code}`);
  const existing = check?.data?.rows?.[0];
  if (existing) {
    console.log(`  already exists (id=${existing.id}) — skip`);
    continue;
  }

  if (DRY_RUN) {
    console.log(`  [DRY] POST: spin=${meta.spin} to=${meta.to}x min_dep=${meta.min_dep} vps=0.02`);
    continue;
  }

  const body = buildPost(meta);
  let r;
  try {
    r = await authedFetch(s, '/api/bo/promotion', { method: 'POST', body });
  } catch (e) {
    console.log(`  ✗ POST exception: ${e.message.slice(0, 150)}`);
    errors++;
    continue;
  }

  if (!r?.success) {
    console.log(`  ✗ POST failed: ${JSON.stringify(r).slice(0, 200)}`);
    errors++;
    continue;
  }

  const newId = r?.data?.rows?.id ?? r?.data?.id;
  console.log(`  ✓ created id=${newId}`);

  // Quick currency verify
  if (newId) {
    const cur = await authedFetch(s, `/api/bo/promotioncurrency?promotion_id=${newId}`);
    const row = cur?.data?.rows?.[0];
    console.log(`  currency: rounds=${row?.rounds}  apl=${row?.amount_per_line}  currency=${row?.currency}`);
  }

  created++;
}

console.log(`\nSummary: ${created} created, ${errors} errors`);
