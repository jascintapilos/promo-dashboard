#!/usr/bin/env node
// Deactivate TEST / canary promos by creator:
//   (A) ALL promos created by 'promo_testbot'   — EXCEPT live production codes
//   (B) ALL promos created by 'jascinta' since 2026-05-11
//
// LIVE PRODUCTION CODES (created by testbot but real promos) are SKIPPED
// by default.  Pass --include-live to also deactivate them.
//
// Usage:
//   node bin/deactivate-test-promos.mjs           ← dry-run
//   node bin/deactivate-test-promos.mjs --commit  ← live

import { authedFetch } from '../src/api-client.js';
import { listSites } from '../src/sites.js';
import { readFileSync } from 'node:fs';

const COMMIT      = process.argv.includes('--commit');
const INCL_LIVE   = process.argv.includes('--include-live');

// ── Criteria ────────────────────────────────────────────────────────────────
const TESTBOT     = 'promo_testbot';
const JASCINTA    = 'jascinta';
const JASCINTA_CUTOFF = new Date('2026-05-11T00:00:00.000Z');

// Live production promos created by testbot that should NOT be deactivated
// unless --include-live is passed.
const LIVE_CODES  = new Set(['FT_REL_SPORTS_25PCT', 'FT_REL_LC_25PCT']);

// ── Load the already-scanned inventory ──────────────────────────────────────
const inventory = JSON.parse(readFileSync('captures/creator-scan.json', 'utf8'));

// Filter to only the targets
const targets = inventory.filter((r) => {
  const isTestbot   = r.created_by === TESTBOT;
  const isJascinta  = r.created_by === JASCINTA && new Date(r.created_at) >= JASCINTA_CUTOFF;
  if (!isTestbot && !isJascinta) return false;

  // Skip already-inactive / archived entries
  if (r.status === 0 && r.platform === 'qpro') return false;   // already Inactive on QPRO
  // QP2 status=0 also means off — skip those too
  if (r.status === 0 && r.platform === 'qp2') return false;

  return true;
});

// Separate live codes
const liveTargets  = targets.filter((r) => LIVE_CODES.has(r.code));
const safeTargets  = targets.filter((r) => !LIVE_CODES.has(r.code));
const toProcess    = INCL_LIVE ? targets : safeTargets;

// ── Summary ─────────────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  DEACTIVATE TEST PROMOS  [${COMMIT ? 'LIVE' : 'DRY-RUN'}]`);
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  Targets (safe):   ${safeTargets.length}`);
console.log(`  ⚠  LIVE promos skipped: ${liveTargets.length}  (${liveTargets.map(r=>`${r.siteId}/${r.code}`).join(', ')})`);
if (INCL_LIVE) console.log('  --include-live passed: LIVE promos WILL be deactivated too!');
console.log(`  Will process:     ${toProcess.length}`);
console.log();

if (liveTargets.length && !INCL_LIVE) {
  console.log('  *** SKIPPED LIVE PROMOS (add --include-live to include them) ***');
  for (const r of liveTargets) {
    console.log(`    ${r.siteId.padEnd(8)} id=${r.id}  ${r.code}`);
  }
  console.log();
}

// ── Deactivation helpers ─────────────────────────────────────────────────────

// Convert ISO date string to "Y-m-d H:i:s" format QP2 PUT validator requires.
// "2026-05-18T04:00:05.000000Z" → "2026-05-18 04:00:05"
function toYmdHis(isoStr) {
  if (!isoStr) return null;
  return String(isoStr).replace('T', ' ').replace(/\.\d+Z?$/, '');
}

// Transform QP2 GET detail response → valid PUT body with status changed.
// Strategy: spread everything from GET, then patch only the fields that need
// a different shape on PUT (merchant_ids, target, dates, nulls).
// This avoids "field is required" errors when new fields are added to the API.
function buildQp2DeactivateBody(det, newStatus = 0) {
  // merchant_ids: GET returns [{id, name, ...}], PUT needs {"0": id, ...}
  const rawMerchants = Array.isArray(det.merchant_ids)
    ? det.merchant_ids.map((m) => (typeof m === 'object' ? m.id : m))
    : [];
  const merchantIdsObj = {};
  rawMerchants.forEach((id, i) => { merchantIdsObj[String(i)] = id; });

  // target: GET returns array, PUT needs single object
  const targetArr = Array.isArray(det.target) ? det.target : (det.target ? [det.target] : []);
  const targetObj = targetArr[0] || { type: 1, multiplier: '1.00', game_provider_codes: [] };

  // dialog_popup_list: GET returns array, PUT needs {"0": row, ...}
  const dlArr = Array.isArray(det.dialog_popup_list) ? det.dialog_popup_list : [];
  const dlObj = {};
  dlArr.forEach((d, i) => { dlObj[String(i)] = d; });

  // Build exact field set matching buildUpdateBody() in api-mapper-qp2.js.
  // Using GET values where available, mapper defaults where GET field name differs.
  return {
    id:                       det.id,
    code:                     det.code,
    name:                     det.name,
    bonus_settings:           det.bonus_settings ?? 1,
    promo_type:               det.promo_type,
    promo_sub_type:           det.promo_sub_type,
    promotion_ids:            [],
    // Date: GET returns ISO, PUT needs "Y-m-d H:i:s"
    valid_from:               toYmdHis(det.valid_from),
    valid_to:                 toYmdHis(det.valid_to),
    validity:                 det.validity ?? 1,
    reward_validity:          det.reward_validity ?? 1,
    frequency_type:           det.frequency_type ?? 1,
    frequency:                det.frequency ?? [],
    limit_transfer_out:       det.limit_transfer_out ?? 0,
    limit_transfer_in:        det.limit_transfer_in ?? 0,
    auto_unlock:              det.auto_unlock ?? 1,
    allow_cancel:             det.allow_cancel ?? 0,
    withdrawal_unlock:        det.withdrawal_unlock ?? 0,
    auto_approve:             det.auto_approve ?? 1,
    auto_reward_activation:   det.auto_reward_activation ?? 0,
    recurring:                det.recurring ?? 0,
    reset_frequency:          det.reset_frequency || 1,   // 0 is invalid; || falls back to 1
    reset_month:              det.reset_month || 1,        // same
    // reset_day omitted — not in mapper PUT and can be null in GET
    max_per_player:           det.max_per_player ?? 1,
    daily_max:                det.daily_max ?? 1,
    members_only:             det.members_only ?? 0,
    fingerprint_check:        det.fingerprint_check ?? 0,
    freespin_check:           det.freespin_check ?? 0,
    allow_deposit:            det.allow_deposit ?? 0,
    allow_continuous_claim:   det.allow_continuous_claim ?? 0,
    message_template_id:      det.message_template_id ?? 0,
    message_template_sms_id:  det.message_template_sms_id ?? 0,
    bonus_rate:               det.bonus_rate ?? 0,
    deposit_count:            det.deposit_count ?? 0,
    // deposit_count_reset_frequency/_day omitted — not in mapper PUT, can be null
    active_period:            det.active_period ?? 0,
    eligible_types:           det.eligible_types ?? 1,
    // deposit_status: GET detail uses last_deposit (bool), PUT wants int (1=None, 4=Last Deposit)
    deposit_status:           det.last_deposit ? 4 : 1,
    free_spin_game_provider_id: det.free_spin_game_provider_id ?? 0,
    // Omit free_spin_game_code entirely for non-FS promos (null → validator 422)
    ...(det.free_spin_game_code != null ? { free_spin_game_code: det.free_spin_game_code } : {}),
    blacklist_template_id:    det.blacklist_template_id,
    promotion_category_ids:   det.promotion_category_ids ?? [],
    game_provider_codes:      det.game_provider_codes ?? [],
    target:                   targetObj,
    member_group_ids:         det.member_group_ids ?? [],
    affiliate_group_ids:      det.affiliate_group_ids ?? [],
    // affiliate_ids, member_ids, telemarketer_ids, currencies_ids, promo_linked_ids
    // are not in mapper PUT body — omit to avoid null issues
    affiliate_ids:            det.affiliate_ids ?? [],
    telemarketer_ids:         det.telemarketer_ids ?? [],
    requires_email:           det.requires_email ?? 0,
    requires_mobile:          det.requires_mobile ?? 0,
    requires_dob:             det.requires_dob ?? 0,
    requires_fullname:        det.requires_fullname ?? 0,
    kyc_listing:              det.kyc_listing ?? 0,
    black_list_sub_categories: [],   // mapper uses this name (not blacklist_sub_categories)
    // promotion_currency: GET detail doesn't return it; send minimal passthrough to satisfy
    // the inline PUT validator. BO does NOT propagate these values to existing currency rows.
    promotion_currency: { '0': { currency_id: 1, bonus_type: 1, max_total_applications: 0, max_total_bonus: 0, max_withdraw: 0, min_deposit: 0, bonus_value: 0, min_transfer_out: 0 } },
    merchant_ids:             merchantIdsObj,
    dialog_popup_list:        dlObj,
    status:                   newStatus,
  };
}

// Transform QPRO GET detail response → PUT body with status=0.
//
// QPRO GET and PUT use DIFFERENT field names/shapes for categories,
// game providers, and target — a raw spread of the GET body causes HTTP 500
// because the server tries to process `promotion_category` (full objects)
// and crashes on DB constraint violations. Build an explicit mapper-aligned
// field set instead (mirrors buildUpdateBody in api-mapper-qpro.js).
function buildQproDeactivateBody(det, newStatus = 0) {
  // promotion_category: GET returns [{id, promotion_id, target_type, category_id}]
  // PUT expects promotion_category_turnover: {"0": catId, "1": catId, ...}
  const catArr = Array.isArray(det.promotion_category) ? det.promotion_category : [];
  const catTurnoverObj = {};
  catArr.forEach((c, i) => { catTurnoverObj[String(i)] = c.category_id; });

  // game_provider_ids: GET returns plain array, PUT expects indexed object
  const gpIds = Array.isArray(det.game_provider_ids) ? det.game_provider_ids : [];
  const gpIdsObj = {};
  gpIds.forEach((id, i) => { gpIdsObj[String(i)] = id; });

  // target: GET returns [{type, multiplier, game_provider_ids:[...]}] (array)
  // PUT expects {"0": {type, multiplier, game_provider_ids: {"0":id,...}}} (indexed obj)
  const targetArr = Array.isArray(det.target) ? det.target : [];
  const targetObj = {};
  targetArr.forEach((t, i) => {
    const tGpIds = Array.isArray(t.game_provider_ids) ? t.game_provider_ids : [];
    const tGpObj = {};
    tGpIds.forEach((id, j) => { tGpObj[String(j)] = id; });
    targetObj[String(i)] = { ...t, game_provider_ids: tGpObj };
  });
  // Fallback if target was empty
  if (!Object.keys(targetObj).length) {
    targetObj['0'] = { type: 1, multiplier: '1.00', game_provider_ids: gpIdsObj };
  }

  return {
    id:                            det.id,
    code:                          det.code,
    name:                          det.name,
    free_spin_game_provider_id:    det.free_spin_game_provider_id ?? 0,
    promotion_category_turnover:   catTurnoverObj,
    promotion_category_winloss:    [],
    promo_type:                    det.promo_type,
    promo_sub_type:                det.promo_sub_type,
    promotion_ids:                 [],
    valid_from:                    toYmdHis(det.valid_from),
    validity:                      det.validity ?? 1,
    reward_validity:               det.reward_validity ?? 1,
    frequency:                     det.frequency ?? [],
    frequency_type:                det.frequency_type ?? 1,
    first_deposit:                 det.first_deposit ?? 0,
    member_group_ids:              [],     // QPRO never sets member groups
    last_deposit:                  det.last_deposit ?? 0,
    auto_approve:                  det.auto_approve ?? 1,
    visible_by_affiliate:          det.visible_by_affiliate ?? 0,
    recurring:                     det.recurring ?? 0,
    max_per_player:                det.max_per_player ?? 1,
    daily_max:                     det.daily_max ?? 1,
    status:                        newStatus,
    limit_transfer_in:             det.limit_transfer_in ?? 0,
    limit_transfer_out:            det.limit_transfer_out ?? 0,
    restrict_claim_round_active:   det.restrict_claim_round_active ?? 0,
    restrict_same_provider_launch: det.restrict_same_provider_launch ?? 0,
    bonus_rate:                    det.bonus_rate != null
                                     ? String(Number(det.bonus_rate).toFixed(2))
                                     : undefined,
    ...(det.reset_frequency ? { reset_frequency: det.reset_frequency } : {}),
    ...(det.free_spin_game_code    ? { free_spin_game_code: det.free_spin_game_code } : {}),
    auto_unlock:                   det.auto_unlock ?? 1,
    allow_cancel:                  det.allow_cancel ?? 0,
    game_provider_ids:             gpIdsObj,
    target:                        targetObj,
    message_template_id:           det.message_template_id ?? 0,
    message_template_sms_id:       0,
    eligible_types:                det.eligible_types ?? 1,
    affiliate_group_ids:           [],
    telemarketer_ids:              [],
    normal_account_manager_ids:    [],
    vip_account_manager_ids:       [],
    requires_email:                det.requires_email ?? 0,
    requires_mobile:               det.requires_mobile ?? 0,
    requires_dob:                  det.requires_dob ?? 0,
    requires_fullname:             det.requires_fullname ?? 0,
    transfer_unlock:               det.transfer_unlock ?? 0,
    kyc_basic:                     det.kyc_basic ?? 1,
    kyc_advanced:                  det.kyc_advanced ?? 1,
    kyc_pro:                       det.kyc_pro ?? 1,
    black_list_sub_categories:     [],
    dialog_popup_list:             [],
  };
}

// ── Main loop ────────────────────────────────────────────────────────────────
// Pre-populate site cache
const siteCache = {};
for (const s of listSites()) { siteCache[s.id] = s; }

let okCount = 0, skipCount = 0, errCount = 0;

// Group by site for cleaner output
const bySite = {};
for (const t of toProcess) {
  (bySite[t.siteId] = bySite[t.siteId] || []).push(t);
}

for (const siteId of Object.keys(bySite).sort()) {
  const site = siteCache[siteId];
  const rows = bySite[siteId];
  console.log(`\n${site.label || siteId}  [${rows[0].platform.toUpperCase()}]`);
  console.log('  ──────────────────────────────────────────────────────');

  for (const t of rows) {
    const icon = t.status === 1 ? '🟢→⚫' : '🟡→⚫';
    process.stdout.write(`  ${icon}  id=${String(t.id).padEnd(6)}  ${t.code}  `);

    if (!COMMIT) {
      process.stdout.write('[dry-run]\n');
      skipCount++;
      continue;
    }

    try {
      // GET current detail
      const detResp = await authedFetch(site, `/api/bo/promotion/${t.id}`);
      const det = detResp?.data?.rows;
      if (!det) throw new Error('No detail data returned');

      // Build PUT body
      const putBody = t.platform === 'qp2'
        ? buildQp2DeactivateBody(det, 0)
        : buildQproDeactivateBody(det, 0);

      await authedFetch(site, `/api/bo/promotion/${t.id}`, {
        method: 'PUT',
        body: putBody,   // pass object — rawFetchJson sets Content-Type + stringifies
      });

      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 150));

      process.stdout.write('✓\n');
      okCount++;
    } catch (err) {
      process.stdout.write(`✗ ${err.message.slice(0, 120)}\n`);
      errCount++;
    }
  }
}

console.log('\n═══════════════════════════════════════════════════════════════');
if (COMMIT) {
  console.log(`  ✓ Deactivated: ${okCount}   ✗ Errors: ${errCount}`);
} else {
  console.log(`  DRY-RUN complete — ${skipCount} would be deactivated`);
  console.log('  Re-run with --commit to apply.');
}
console.log('═══════════════════════════════════════════════════════════════\n');
