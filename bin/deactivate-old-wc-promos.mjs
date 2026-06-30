#!/usr/bin/env node
// One-off: deactivate + archive old short-code promos for P169-P172.
// Only runs against the 8 brands used in that batch.
// Usage:
//   node bin/deactivate-old-wc-promos.mjs            # dry-run
//   node bin/deactivate-old-wc-promos.mjs --commit   # live

import { parseArgs } from './_args.js';
import { getSite } from '../src/sites.js';
import { authedFetch, findPromotionByCode } from '../src/api-client.js';

const { flags } = parseArgs(process.argv.slice(2));
const commit = flags.commit === true;

// 8 brands used for P169-P172 and their site/platform config
const TARGETS = [
  { siteId: 'ibc22', merchantId: 3, label: 'QP2C'   },
  { siteId: 'qpro3',               label: 'QPRO3'  },
  { siteId: 'qpro4',               label: 'QPRO4'  },
  { siteId: 'qpro5',               label: 'QPRO5'  },
  { siteId: 'qpro7',               label: 'QPRO7'  },
  { siteId: 'qpro10',              label: 'QPRO10' },
  { siteId: 'qpro15',              label: 'QPRO15' },
  { siteId: 'qpro16',              label: 'QPRO16' },
];

// Old codes committed before WC_SLVR_ prefix was added
const OLD_CODES = [
  '28FC_10X',
  '50FC_10X',
  '68FC_10X',
  'WV_VIP_REL_20PCT_12X',
  'REL_20PCT_12X',           // fallback in case summary name differs
];

function isoToYmdHms(iso) {
  if (!iso || typeof iso !== 'string') return iso;
  return iso.replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '');
}

// Build a valid QPRO PUT body from the GET response, setting status=0.
// GET and PUT have different field names in several places — this function
// performs the mapping to avoid 422 validation errors.
function buildQproDeactivatePutBody(g) {
  // promotion_category_turnover = category_ids where target_type=1 in GET's promotion_category
  const turnoverCatIds = (g.promotion_category || [])
    .filter((c) => c.target_type === 1)
    .map((c) => c.category_id);

  const put = {
    id:                             g.id,
    code:                           g.code,
    name:                           g.name,
    free_spin_game_provider_id:     g.free_spin_game_provider_id || 0,
    promotion_category_turnover:    turnoverCatIds,
    promotion_category_winloss:     [],
    promo_type:                     g.promo_type,
    promo_sub_type:                 Number(g.promo_sub_type),
    promotion_ids:                  [],
    valid_from:                     isoToYmdHms(g.valid_from),
    validity:                       g.validity,
    reward_validity:                g.reward_validity,
    frequency:                      g.frequency || [],
    frequency_type:                 Number(g.frequency_type),
    first_deposit:                  g.first_deposit || 0,
    member_group_ids:               [],
    last_deposit:                   g.last_deposit,
    auto_approve:                   g.auto_approve,
    auto_reward_activation:         1,
    visible_by_affiliate:           g.visible_by_affiliate,
    recurring:                      Number(g.recurring),
    max_per_player:                 g.max_per_player,
    daily_max:                      g.daily_max,
    status:                         0,  // ← deactivate
    limit_transfer_in:              g.limit_transfer_in,
    limit_transfer_out:             g.limit_transfer_out,
    restrict_claim_round_active:    g.restrict_claim_round_active,
    restrict_same_provider_launch:  g.restrict_same_provider_launch,
    bonus_rate:                     g.bonus_rate != null ? String(Number(g.bonus_rate).toFixed(2)) : undefined,
    auto_unlock:                    g.auto_unlock,
    allow_cancel:                   g.allow_cancel,
    game_provider_ids:              g.game_provider_ids || [],
    target:                         g.target || [],
    message_template_id:            g.message_template_id || 0,
    message_template_sms_id:        0,
    eligible_types:                 Number(g.eligible_types),
    affiliate_group_ids:            [],
    telemarketer_ids:               [],
    normal_account_manager_ids:     [],
    vip_account_manager_ids:        [],
    requires_email:                 g.requires_email,
    requires_mobile:                g.requires_mobile,
    requires_dob:                   g.requires_dob,
    requires_fullname:              g.requires_fullname,
    transfer_unlock:                g.transfer_unlock,
    kyc_basic:                      g.kyc_basic,
    kyc_advanced:                   g.kyc_advanced,
    kyc_pro:                        g.kyc_pro,
    kyc_type:                       g.kyc_type,
    blacklist_id:                   g.blacklist_id,
    black_list_sub_categories:      [],   // PUT field name (not blacklist_sub_categories)
    dialog_popup_list:              [],   // deactivating — don't preserve dialog link
  };
  // reset_frequency=0 fails PUT validation ("invalid enum") — omit when absent/0
  if (g.reset_frequency && g.reset_frequency !== 0) put.reset_frequency = g.reset_frequency;
  if (g.free_spin_game_code) put.free_spin_game_code = g.free_spin_game_code;
  return put;
}

// QP2 GET→PUT mapping (ibc22 platform uses object-keyed shapes for many fields)
function buildQp2DeactivatePutBody(g) {
  // merchant_ids: GET=[{id:3,...}] → PUT={'0': 3}
  const merchantObj = Object.fromEntries(
    (g.merchant_ids || []).map((m, i) => [String(i), typeof m === 'object' ? m.id : m])
  );

  // game_provider_codes: GET=['365G',...] → PUT={'0':'365G','1':'9W',...}
  const gpCodesObj = Object.fromEntries((g.game_provider_codes || []).map((c, i) => [String(i), c]));

  // target: GET=[{type,multiplier,game_provider_codes:[...]}] → PUT={type,multiplier,game_provider_codes:{...}}
  const tArr = Array.isArray(g.target) ? g.target[0] : g.target;
  const targetObj = tArr ? {
    type: tArr.type,
    multiplier: String(Number(tArr.multiplier).toFixed(2)),
    game_provider_codes: Object.fromEntries((tArr.game_provider_codes || []).map((c, i) => [String(i), c])),
  } : { type: 1, multiplier: '1.00', game_provider_codes: {} };

  // member_group_ids: GET=[33,34,...] → PUT={'0':33,'1':34,...}
  const mgObj = Object.fromEntries(
    (g.member_group_ids || []).sort((a, b) => a - b).map((id, i) => [String(i), id])
  );

  return {
    id:                          g.id,
    code:                        g.code,
    name:                        g.name,
    free_spin_game_provider_id:  g.free_spin_game_provider_id || 0,
    ...(g.free_spin_game_code ? { free_spin_game_code: g.free_spin_game_code } : {}),
    promotion_category_ids:      g.promotion_category_ids || [],
    bonus_settings:              g.bonus_settings || 1,
    promo_type:                  g.promo_type,
    promo_sub_type:              g.promo_sub_type,
    promotion_ids:               [],
    valid_from:                  isoToYmdHms(g.valid_from),
    ...(g.valid_to ? { valid_to: isoToYmdHms(g.valid_to) } : {}),
    validity:                    g.validity,
    reward_validity:             g.reward_validity,
    frequency:                   g.frequency || [],
    frequency_type:              g.frequency_type,
    member_group_ids:            mgObj,
    members_only:                g.members_only || 0,
    fingerprint_check:           g.fingerprint_check || 0,
    freespin_check:              g.freespin_check || 0,
    auto_approve:                g.auto_approve,
    auto_reward_activation:      g.auto_reward_activation ?? 1,
    recurring:                   g.recurring,
    reset_frequency:             1,   // PUT requires 1 (not 0)
    reset_month:                 1,   // PUT requires 1 (not 0)
    max_per_player:              g.max_per_player,
    daily_max:                   g.daily_max,
    status:                      0,   // ← deactivate
    limit_transfer_in:           g.limit_transfer_in,
    limit_transfer_out:          g.limit_transfer_out,
    bonus_rate:                  g.bonus_rate ?? 0,
    auto_unlock:                 g.auto_unlock,
    allow_cancel:                g.allow_cancel,
    withdrawal_unlock:           g.withdrawal_unlock || 0,
    game_provider_codes:         gpCodesObj,
    target:                      targetObj,
    message_template_id:         g.message_template_id || 0,
    message_template_sms_id:     0,
    deposit_count:               g.deposit_count || 0,
    active_period:               g.active_period || 0,
    merchant_ids:                merchantObj,
    allow_deposit:               g.allow_deposit || 0,
    allow_continuous_claim:      g.allow_continuous_claim || 0,
    deposit_status:              g.deposit_status ?? 1,
    eligible_types:              g.eligible_types,
    affiliate_group_ids:         [],
    telemarketer_ids:            [],
    requires_email:              g.requires_email,
    requires_mobile:             g.requires_mobile,
    requires_dob:                g.requires_dob,
    requires_fullname:           g.requires_fullname,
    black_list_sub_categories:   [],   // renamed; set to [] for deactivation
    blacklist_template_id:       g.blacklist_template_id,
    promotion_currency:          {},   // OK to wipe — we're deactivating
    dialog_popup_list:           [],
    kyc_listing:                 g.kyc_listing || 0,
    last_deposit:                g.last_deposit,
    before_ftd:                  g.before_ftd || 0,
    first_deposit:               g.first_deposit || 0,
    ftd:                         g.ftd || 0,
  };
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`DEACTIVATE OLD WC PROMOS — ${commit ? 'LIVE (--commit)' : 'DRY-RUN'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Codes: ${OLD_CODES.join(', ')}`);
console.log(`  Sites: ${TARGETS.map((t) => t.label).join(', ')}`);
console.log('');

const found = [];

for (const target of TARGETS) {
  const site = getSite(target.siteId);
  process.stdout.write(`▶ ${target.label} (${target.siteId})… `);
  const hits = [];
  for (const code of OLD_CODES) {
    try {
      const opts = target.merchantId != null ? { merchantId: target.merchantId } : {};
      const row = await findPromotionByCode(site, code, opts);
      if (row) hits.push({ code, id: row.id, status: row.status });
    } catch (e) {
      // code not found → skip
    }
  }
  if (hits.length === 0) {
    console.log('nothing found');
  } else {
    console.log(`${hits.length} found`);
    for (const h of hits) {
      console.log(`    code=${h.code}  id=${h.id}  status=${h.status}`);
      found.push({ ...target, ...h });
    }
  }
}

console.log('');
console.log(`Total found: ${found.length}`);

if (!commit) {
  console.log('');
  console.log('Dry-run. To deactivate + archive, re-run with --commit.');
  process.exit(0);
}

if (found.length === 0) {
  console.log('Nothing to deactivate.');
  process.exit(0);
}

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('DEACTIVATING + ARCHIVING');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

let okDeact = 0, failDeact = 0, okArchive = 0, failArchive = 0;

for (const item of found) {
  const site = getSite(item.siteId);
  process.stdout.write(`  ${item.label} ${item.code} (id=${item.id}) `);
  try {
    if (item.status !== 0) {
      const detail = await authedFetch(site, `/api/bo/promotion/${item.id}`);
      const g = detail?.data?.rows;
      if (!g) throw new Error('GET returned no body');
      const putBody = item.siteId === 'ibc22' ? buildQp2DeactivatePutBody(g) : buildQproDeactivatePutBody(g);
      await authedFetch(site, `/api/bo/promotion/${item.id}`, { method: 'PUT', body: putBody });
      process.stdout.write('deactivated ');
      okDeact++;
    } else {
      process.stdout.write('(already inactive) ');
    }
    try {
      await authedFetch(site, `/api/bo/promotion/${item.id}`, { method: 'DELETE' });
      process.stdout.write('+ archived ✓');
      okArchive++;
    } catch (e) {
      const code = e.message.match(/HTTP \d+/)?.[0] || 'err';
      process.stdout.write(`(archive skipped: ${code})`);
      failArchive++;
    }
    console.log('');
  } catch (e) {
    const code = e.message.match(/HTTP \d+/)?.[0] || e.message.slice(0, 40);
    console.log(`✖ deactivate failed: ${code}`);
    failDeact++;
  }
}

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('SUMMARY');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Deactivated: ${okDeact}   Failed: ${failDeact}`);
console.log(`  Archived:    ${okArchive}   Skipped: ${failArchive} (QP2 returns 422 on DELETE)`);
