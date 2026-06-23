// Fix 6 broken QPRO1 GOOSS FS codes:
//   - free_spin_game_code was "GOOSS 0" (invalid); fix to "vs20olympgold"
//   - no promotioncurrency rows; POST one SGD row per promo
//
// Usage:
//   node bin/fix-qpro1-gooss-codes.mjs          # dry run
//   node bin/fix-qpro1-gooss-codes.mjs --commit  # live
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const DRY_RUN = !process.argv.includes('--commit');
if (DRY_RUN) console.log('[DRY RUN] Pass --commit to execute\n');

const SITE_ID = 'qpro1';
const CORRECT_GAME_CODE = 'vs20olympgold';
const CORRECT_PROVIDER_ID = 96;   // PP2 on QPRO1
const SGD_CURRENCY_ID = 3;

const PROMOS = [
  { code: 'WELC_BASE_80FS_GOOSS_20X',     rounds: 80,  min_transfer: 100 },
  { code: 'WELC_BOOSTER_100FS_GOOSS_25X', rounds: 100, min_transfer: 150 },
  { code: 'REL_BASE_60FS_GOOSS_12X_V2',   rounds: 60,  min_transfer: 100 },
  { code: 'REL_BOOSTER_80FS_GOOSS_15X',   rounds: 80,  min_transfer: 150 },
  { code: 'RET_GOOSS_BASE_50FS_10X',      rounds: 50,  min_transfer: 80  },
  { code: 'RET_GOOSS_BOOST_60FS_12X',     rounds: 60,  min_transfer: 100 },
];

const s = getSite(SITE_ID);

function b01(v) { return v === true ? 1 : v === false ? 0 : v; }
function toMysqlDt(iso) {
  if (!iso) return iso;
  return String(iso).replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', '');
}

function buildPutBody(p, rounds, minTransfer) {
  // Mirrors buildUpdateBody in api-mapper-qpro.js — preserves all fields,
  // overrides free_spin_game_code and free_spin_game_provider_id.
  // FS promos always use SLOTS (category_id=3). arrayToIntObj format: {"0":3}
  const catTurnover = { '0': 3 };

  // Include promotion_currency to create/replace the currency row (soft-deletes
  // any existing rows and creates new ones from this block).
  const promotion_currency = {
    '0': {
      currency_id: String(SGD_CURRENCY_ID),
      coins: 1,
      amount_per_line: 0.02,
      rounds,
      lines: 10,
      min_transfer: minTransfer,
      max_total_applications: 0,
      max_total_bonus: 0,
      status: '1',
      max_transfer_out: 0,
      promo_type: 4,       // Free Spin
      currency: 'SGD',
      current_players: 0,
      used_budget: 0,
    },
  };

  return {
    id: p.id,
    code: p.code,
    name: p.name,
    free_spin_game_provider_id: CORRECT_PROVIDER_ID,
    free_spin_game_code: CORRECT_GAME_CODE,
    promotion_category_turnover: catTurnover,
    promotion_category_winloss: [],
    promo_type: p.promo_type,
    promo_sub_type: Number(p.promo_sub_type),
    promotion_ids: [],
    valid_from: toMysqlDt(p.valid_from),
    validity: p.validity,
    reward_validity: p.reward_validity,
    frequency: p.frequency ?? [],
    frequency_type: Number(p.frequency_type ?? 1),
    first_deposit: p.first_deposit ?? 0,
    member_group_ids: [],
    last_deposit: b01(p.last_deposit),
    auto_approve: b01(p.auto_approve),
    visible_by_affiliate: p.visible_by_affiliate ?? 1,
    recurring: Number(p.recurring ?? 0),
    max_per_player: p.max_per_player ?? 99999,
    daily_max: p.daily_max ?? 1,
    status: 1,
    limit_transfer_in: b01(p.limit_transfer_in),
    limit_transfer_out: b01(p.limit_transfer_out),
    restrict_claim_round_active: b01(p.restrict_claim_round_active),
    restrict_same_provider_launch: b01(p.restrict_same_provider_launch),
    bonus_rate: p.bonus_rate != null ? String(Number(p.bonus_rate).toFixed(2)) : undefined,
    auto_unlock: b01(p.auto_unlock),
    allow_cancel: p.allow_cancel ?? 0,
    game_provider_ids: { '0': CORRECT_PROVIDER_ID },
    target: (p.target || []).map(t => ({
      ...t,
      game_provider_ids: { '0': CORRECT_PROVIDER_ID },
    })),
    message_template_id: p.message_template_id ?? 0,
    message_template_sms_id: 0,
    eligible_types: Number(p.eligible_types ?? 1),
    affiliate_group_ids: [],
    telemarketer_ids: [],
    normal_account_manager_ids: [],
    vip_account_manager_ids: [],
    requires_email: p.requires_email ?? 0,
    requires_mobile: p.requires_mobile ?? 0,
    requires_dob: p.requires_dob ?? 0,
    requires_fullname: p.requires_fullname ?? 0,
    transfer_unlock: b01(p.transfer_unlock),
    kyc_basic: p.kyc_basic ?? 1,
    kyc_advanced: p.kyc_advanced ?? 1,
    kyc_pro: p.kyc_pro ?? 1,
    blacklist_id: p.blacklist_id ?? 0,
    kyc_type: p.kyc_type ?? 1,
    auto_reward_activation: p.auto_reward_activation ?? 0,
    promotion_currency,
  };
}

function buildCurrencyRow(promoId, rounds, minTransfer) {
  return {
    promotion_id: promoId,
    currency_id: SGD_CURRENCY_ID,
    settings_currency_id: SGD_CURRENCY_ID,
    rounds,
    amount_per_line: 0.02,
    lines: 10,
    coins: 1,
    min_transfer: minTransfer,
    max_transfer_out: 0,
    free_credit_amount: 0,
    max_balance_claim: 0,
    max_total_applications: 0,
    max_total_bonus: 0,
    max_bonus: 0,
    min_bonus: 0,
    threshold: 0,
    status: 1,
  };
}

let fixed = 0, errors = 0;

for (const meta of PROMOS) {
  console.log(`\n── ${meta.code} ──`);

  // 1. Fetch current detail
  const listR = await authedFetch(s, `/api/bo/promotion?code=${meta.code}`);
  const listRow = listR?.data?.rows?.[0];
  if (!listRow) { console.log('  NOT FOUND'); errors++; continue; }

  const detR = await authedFetch(s, `/api/bo/promotion/${listRow.id}`);
  const promo = detR?.data?.rows ?? detR?.data;
  if (!promo?.id) { console.log('  detail fetch failed'); errors++; continue; }

  console.log(`  id=${promo.id}  game_code=${promo.free_spin_game_code || 'null'}`);

  // Check existing currency rows
  const curR = await authedFetch(s, `/api/bo/promotioncurrency?promotion_id=${promo.id}`);
  const curRows = curR?.data?.rows || [];
  console.log(`  cur_rows=${curRows.length}  promotion_category=${JSON.stringify(promo.promotion_category)}`);

  if (DRY_RUN) {
    console.log(`  [DRY] PUT game_code → ${CORRECT_GAME_CODE}, categories → SLOTS`);
    if (curRows.length === 0) {
      console.log(`  [DRY] POST currency: SGD, rounds=${meta.rounds}, min_transfer=${meta.min_transfer}, amount_per_line=0.02`);
    }
    continue;
  }

  // 2. PUT to fix game_code + restore categories + replace currency row
  const putBody = buildPutBody(promo, meta.rounds, meta.min_transfer);
  let putR;
  try {
    putR = await authedFetch(s, `/api/bo/promotion/${promo.id}`, {
      method: 'PUT',
      body: putBody,
    });
  } catch (e) {
    console.log(`  ✗ PUT exception: ${e.message}`);
    errors++;
    continue;
  }
  if (!putR?.success) {
    console.log(`  ✗ PUT failed: ${JSON.stringify(putR).slice(0, 200)}`);
    errors++;
    continue;
  }
  console.log(`  ✓ PUT: game_code=${CORRECT_GAME_CODE}, categories=SLOTS, currency SGD rounds=${meta.rounds} min_transfer=${meta.min_transfer}`);
  fixed++;
}

console.log(`\nSummary: ${fixed} fixed, ${errors} errors`);
