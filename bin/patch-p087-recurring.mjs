// One-off: change P087-r88 (RET_CRM_REL_30PCT_12X_ALL) from one-time to
// recurring daily across all 9 brand saves (QPRO1/3/4/5/7/10/15/16 + QP2B/C).
//
//   node bin/patch-p087-recurring.mjs            # dry-run
//   node bin/patch-p087-recurring.mjs --commit   # live

import { updatePromotion } from '../src/api-client.js';
import { readFileSync } from 'fs';

const DRY_RUN = !process.argv.includes('--commit');

// SPORT=1 and LIVE CASINO=2 were removed by patch-p087-categories.mjs.
// The plan files still have the old categories — re-apply the same exclusion
// here so the PUT body matches the current BO state (otherwise 422).
const EXCLUDE_CAT_IDS = new Set([1, 2]);
function reindexObj(arr) { const o = {}; arr.forEach((v, i) => { o[String(i)] = v; }); return o; }
function removeCatIds(pct) {
  return reindexObj(Object.values(pct).map(Number).filter(id => !EXCLUDE_CAT_IDS.has(id)));
}

const QPRO_TARGETS = [
  { brand: 'QPRO1',  site: 'qpro1',  promoId: 1116, templateId: 1110 },
  { brand: 'QPRO3',  site: 'qpro3',  promoId: 616,  templateId: 583  },
  { brand: 'QPRO4',  site: 'qpro4',  promoId: 546,  templateId: 515  },
  { brand: 'QPRO5',  site: 'qpro5',  promoId: 484,  templateId: 414  },
  { brand: 'QPRO7',  site: 'qpro7',  promoId: 476,  templateId: 607  },
  { brand: 'QPRO10', site: 'qpro10', promoId: 393,  templateId: 599  },
  { brand: 'QPRO15', site: 'qpro15', promoId: 383,  templateId: 421  },
  { brand: 'QPRO16', site: 'qpro16', promoId: 351,  templateId: 398  },
];

const QP2_TARGET = {
  brand:       'QP2B/C',
  site:        'ibc22',
  promoId:     1399,
  templateId:  1339,
  merchantIds: { '0': 2, '1': 3 },
};

function b01(v) { return v === true ? 1 : v === false ? 0 : v; }

function buildQproPut(p, promoId, templateId) {
  return {
    id: promoId,
    code: p.code,
    name: p.name,
    free_spin_game_provider_id: p.free_spin_game_provider_id ?? 0,
    promotion_category_turnover: removeCatIds(p.promotion_category_turnover ?? {}),
    promotion_category_winloss: [],
    promo_type: p.promo_type,
    promo_sub_type: Number(p.promo_sub_type),
    promotion_ids: [],
    valid_from: p.valid_from,
    validity: p.validity,
    reward_validity: p.reward_validity,
    frequency: p.frequency ?? [],
    frequency_type: Number(p.frequency_type),
    first_deposit: p.first_deposit,
    member_group_ids: [],
    last_deposit: b01(p.last_deposit),
    auto_approve: b01(p.auto_approve),
    auto_reward_activation: 1,
    visible_by_affiliate: p.visible_by_affiliate,
    recurring: 1,            // ← changed: 0 → 1 (recurring daily)
    reset_frequency: 1,      // required when recurring=1 on QPRO
    max_per_player: p.max_per_player ?? 99999,
    daily_max: p.daily_max ?? 1,
    status: 1,
    limit_transfer_in: b01(p.limit_transfer_in),
    limit_transfer_out: b01(p.limit_transfer_out),
    restrict_claim_round_active: b01(p.restrict_claim_round_active),
    restrict_same_provider_launch: b01(p.restrict_same_provider_launch),
    bonus_rate: p.bonus_rate != null ? String(Number(p.bonus_rate).toFixed(2)) : undefined,
    auto_unlock: b01(p.auto_unlock),
    allow_cancel: p.allow_cancel,
    game_provider_ids: p.game_provider_ids ?? {},
    target: p.target ?? {},
    message_template_id: templateId,
    message_template_sms_id: 0,
    eligible_types: Number(p.eligible_types ?? 1),
    affiliate_group_ids: [],
    telemarketer_ids: p.telemarketer_ids ?? [],
    normal_account_manager_ids: p.normal_account_manager_ids ?? [],
    vip_account_manager_ids: p.vip_account_manager_ids ?? [],
    requires_email: b01(p.requires_email),
    requires_mobile: b01(p.requires_mobile),
    requires_dob: b01(p.requires_dob),
    requires_fullname: b01(p.requires_fullname),
    transfer_unlock: b01(p.transfer_unlock),
    kyc_basic: p.kyc_basic,
    kyc_advanced: p.kyc_advanced,
    kyc_pro: p.kyc_pro,
    blacklist_id: p.blacklist_id,
    black_list_sub_categories: [],
    dialog_popup_list: [],
    // promotion_currency intentionally OMITTED
  };
}

function buildQp2Put(p, promoId, templateId, merchantIds) {
  return {
    id: promoId,
    code: p.code,
    name: p.name,
    free_spin_game_provider_id: p.free_spin_game_provider_id ?? 0,
    promotion_category_ids: p.promotion_category_ids ?? {},
    bonus_settings: 1,
    promo_type: Number(p.promo_type),
    promo_sub_type: Number(p.promo_sub_type),
    promotion_ids: [],
    valid_from: p.valid_from,
    validity: p.validity,
    reward_validity: p.reward_validity,
    frequency: [],
    frequency_type: 1,
    member_group_ids: p.member_group_ids ?? {},
    members_only: p.members_only ?? 0,
    fingerprint_check: p.fingerprint_check ?? 0,
    freespin_check: p.freespin_check ?? 0,
    auto_approve: p.auto_approve ?? 1,
    auto_reward_activation: p.auto_reward_activation ?? 1,
    recurring: 1,            // ← changed: 0 → 1 (recurring daily)
    reset_frequency: 1,
    max_per_player: 99999,   // ← changed: 1 → 99999 so daily reset doesn't lifetime-cap
    daily_max: p.daily_max ?? 1,
    status: 1,
    limit_transfer_in: p.limit_transfer_in ?? 0,
    limit_transfer_out: p.limit_transfer_out ?? 0,
    bonus_rate: p.bonus_rate ?? 0,
    auto_unlock: p.auto_unlock ?? 1,
    allow_cancel: p.allow_cancel ?? 0,
    withdrawal_unlock: p.withdrawal_unlock ?? 0,
    game_provider_codes: p.game_provider_codes,
    target: {
      type: p.target?.type ?? 1,
      multiplier: Number(p.target?.multiplier ?? 12).toFixed(2),
      game_provider_codes: p.target?.game_provider_codes,
    },
    message_template_id: templateId,
    message_template_sms_id: 0,
    deposit_count: p.deposit_count ?? 0,
    active_period: p.active_period ?? 0,
    merchant_ids: merchantIds,
    allow_deposit: p.allow_deposit ?? 0,
    allow_continuous_claim: p.allow_continuous_claim ?? 0,
    deposit_status: p.deposit_status ?? 4,
    eligible_types: Number(p.eligible_types ?? 1),
    affiliate_group_ids: [],
    telemarketer_ids: [],
    requires_mobile: p.requires_mobile ?? 0,
    requires_dob: p.requires_dob ?? 0,
    requires_fullname: p.requires_fullname ?? 0,
    black_list_sub_categories: [],
    blacklist_template_id: p.blacklist_template_id ?? 1,
    dialog_popup_list: [],
    // promotion_currency intentionally OMITTED
  };
}

let anyFail = false;

// ── QPRO brands ──
for (const { brand, site, promoId, templateId } of QPRO_TARGETS) {
  console.log(`\n── ${brand} (site=${site}, promo_id=${promoId}) ──`);

  let planPromo;
  try {
    const plan = JSON.parse(readFileSync(`captures/qc-plans/P087-r88__${brand}.json`, 'utf8'));
    planPromo = plan.plan.promotion;
  } catch (e) {
    console.log(`  ✗ Could not read plan: ${e.message}`);
    anyFail = true;
    continue;
  }

  console.log(`  recurring: ${planPromo.recurring} → 1  (daily)`);
  console.log(`  max_per_player: ${planPromo.max_per_player} (unchanged)`);
  console.log(`  daily_max: ${planPromo.daily_max} (unchanged)`);

  if (DRY_RUN) { console.log(`  [DRY RUN]`); continue; }

  try {
    const body = buildQproPut(planPromo, promoId, templateId);
    const res = await updatePromotion(site, promoId, body);
    const ok = res?.data?.rows?.id === promoId || res?.data?.rows?.id != null;
    if (ok) {
      console.log(`  ✓ recurring updated (promo_id=${promoId})`);
    } else {
      console.log(`  ⚠ unexpected response: ${JSON.stringify(res).slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`  ✗ PUT failed: ${e.message}`);
    anyFail = true;
  }
}

// ── QP2 ──
{
  const { brand, site, promoId, templateId, merchantIds } = QP2_TARGET;
  console.log(`\n── ${brand} (site=${site}, promo_id=${promoId}) ──`);

  let planPromo;
  try {
    const plan = JSON.parse(readFileSync('captures/qc-plans/P087-r88__QP2B.json', 'utf8'));
    planPromo = plan.plan.promotion;
  } catch (e) {
    console.log(`  ✗ Could not read QP2B plan: ${e.message}`);
    anyFail = true;
  }

  if (planPromo) {
    console.log(`  recurring: ${planPromo.recurring} → 1  (daily)`);
    console.log(`  max_per_player: ${planPromo.max_per_player} → 99999`);
    console.log(`  daily_max: ${planPromo.daily_max} (unchanged)`);
    console.log(`  merchant_ids (preserved): ${JSON.stringify(merchantIds)}`);

    if (DRY_RUN) {
      console.log(`  [DRY RUN]`);
    } else {
      try {
        const body = buildQp2Put(planPromo, promoId, templateId, merchantIds);
        const res = await updatePromotion(site, promoId, body);
        const ok = res?.data?.rows?.id === promoId || res?.data?.rows?.id != null;
        if (ok) {
          console.log(`  ✓ recurring updated (promo_id=${promoId})`);
        } else {
          console.log(`  ⚠ unexpected response: ${JSON.stringify(res).slice(0, 200)}`);
        }
      } catch (e) {
        console.log(`  ✗ PUT failed: ${e.message.split('\n')[0]}`);
        anyFail = true;
      }
    }
  }
}

if (DRY_RUN) {
  console.log('\n[DRY RUN complete] Re-run with --commit to apply.');
} else {
  console.log(anyFail
    ? '\n⚠ Some targets failed — review above.'
    : '\n✓ All brands: recurring set to daily.'
  );
}
