// One-off: set max_per_player=1 on all QPRO + QP2 brands for P087-r88.
// User confirmed intent is "once per player" — canary defaulted to 99999.
//
//   node bin/patch-p087-max-per-player.mjs            # dry-run
//   node bin/patch-p087-max-per-player.mjs --commit   # live

import { updatePromotion } from '../src/api-client.js';
import { readFileSync } from 'fs';

const DRY_RUN = !process.argv.includes('--commit');

// ── Targets (from QC bundles) ─────────────────────────────────────────────
const TARGETS = [
  { brand: 'QPRO1',  site: 'qpro1',  promoId: 1116, templateId: 1110 },
  { brand: 'QPRO3',  site: 'qpro3',  promoId: 616,  templateId: 583  },
  { brand: 'QPRO4',  site: 'qpro4',  promoId: 546,  templateId: 515  },
  { brand: 'QPRO5',  site: 'qpro5',  promoId: 484,  templateId: 414  },
  { brand: 'QPRO7',  site: 'qpro7',  promoId: 476,  templateId: 607  },
  { brand: 'QPRO10', site: 'qpro10', promoId: 393,  templateId: 599  },
  { brand: 'QPRO15', site: 'qpro15', promoId: 383,  templateId: 421  },
  { brand: 'QPRO16', site: 'qpro16', promoId: 351,  templateId: 398  },
];

// ── Build PUT body from plan bundle ──────────────────────────────────────
function b01(v) { return v === true ? 1 : v === false ? 0 : v; }

function buildPutBody(planPromo, promoId, templateId) {
  const p = planPromo;
  // Mirrors buildUpdateBody in api-mapper-qpro.js exactly.
  // NOTE: promotion_currency must be OMITTED from PUT (causes silent currency wipe).
  return {
    id: promoId,
    code: p.code,
    name: p.name,
    free_spin_game_provider_id: p.free_spin_game_provider_id ?? 0,
    promotion_category_turnover: p.promotion_category_turnover ?? {},
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
    recurring: Number(p.recurring),
    max_per_player: 1,   // ← THE FIX (was 99999)
    daily_max: p.daily_max,
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
    dialog_popup_list: [],   // no popup for this promo
    // promotion_currency intentionally OMITTED — PUT wipes non-MYR rows if resent
  };
}

// ── Main ─────────────────────────────────────────────────────────────────
let anyFail = false;

for (const { brand, site, promoId, templateId } of TARGETS) {
  console.log(`\n── ${brand} (site=${site}, promo_id=${promoId}) ──`);

  // Read plan bundle for the full POST body
  let planPromo;
  try {
    const planPath = `captures/qc-plans/P087-r88__${brand}.json`;
    const plan = JSON.parse(readFileSync(planPath, 'utf8'));
    planPromo = plan.plan.promotion;
  } catch (e) {
    console.log(`  ✗ Could not read plan bundle: ${e.message}`);
    anyFail = true;
    continue;
  }

  const body = buildPutBody(planPromo, promoId, templateId);
  console.log(`  max_per_player: 99999 → 1`);
  console.log(`  daily_max: ${body.daily_max} (unchanged)`);

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would PUT /api/bo/promotion/${promoId}`);
    continue;
  }

  try {
    const res = await updatePromotion(site, promoId, body);
    const ok = res?.data?.rows?.id === promoId || res?.data?.rows?.id != null;
    if (ok) {
      console.log(`  ✓ max_per_player set to 1 (promo_id=${promoId})`);
    } else {
      console.log(`  ⚠ PUT returned unexpected shape: ${JSON.stringify(res).slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`  ✗ PUT failed: ${e.message.split('\n')[0]}`);
    anyFail = true;
  }
}

if (DRY_RUN) {
  console.log('\n[DRY RUN complete] Re-run with --commit to apply.');
} else {
  console.log(anyFail
    ? '\n⚠ Some targets failed — review above.'
    : '\n✓ All QPRO brands updated: max_per_player=1 (once per player).'
  );
}
