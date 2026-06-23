#!/usr/bin/env node
// Backfill missing promotion_category_turnover on existing QPRO promos.
//
// Usage:
//   node bin/backfill-categories.mjs            # dry run — show what would change
//   node bin/backfill-categories.mjs --commit   # live PUT to each BO
//
// Targets are hardcoded below (discovered via audit-cat-gp.mjs on 2026-06-17).

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const COMMIT = process.argv.includes('--commit');

// ── Targets ───────────────────────────────────────────────────────────────
// Format: { brand, id, cats: ['LIVE CASINO', 'SLOTS', ...] }
const TARGETS = [
  // FT_15PCT_SLCS_MMM — missing cats on QPRO2/6/8 (QP2 has LC,SL,SP)
  { brand: 'qpro2', id: 454, cats: ['LIVE CASINO', 'SLOTS', 'SPORT'] },
  { brand: 'qpro6', id: 383, cats: ['LIVE CASINO', 'SLOTS', 'SPORT'] },
  { brand: 'qpro8', id: 440, cats: ['LIVE CASINO', 'SLOTS', 'SPORT'] },
  // FT_REL_TLEO_LC_20PCT_300MX_BR — missing cats (QP2/QPRO5/7/15/16 have LC)
  { brand: 'qpro2',  id: 468, cats: ['LIVE CASINO'] },
  { brand: 'qpro3',  id: 496, cats: ['LIVE CASINO'] },
  { brand: 'qpro4',  id: 413, cats: ['LIVE CASINO'] },
  { brand: 'qpro6',  id: 449, cats: ['LIVE CASINO'] },
  { brand: 'qpro8',  id: 505, cats: ['LIVE CASINO'] },
  { brand: 'qpro10', id: 300, cats: ['LIVE CASINO'] },
];

// ── Helpers ───────────────────────────────────────────────────────────────
function arrayToIntObj(arr) {
  const out = {};
  arr.forEach((v, i) => { out[String(i)] = v; });
  return out;
}

function isoToBoDatetime(iso) {
  // "2026-05-27T20:09:00.000000Z" → "2026-05-27 20:09:00"
  return (iso || '').replace('T', ' ').replace(/\.\d+Z$/, '');
}

async function resolveCatIds(site, wantedNames) {
  const r = await authedFetch(site, '/api/bo/categories?perPage=500');
  const rows = Object.values(r.data?.rows ?? {});
  const wanted = new Set(wantedNames.map(n => n.toUpperCase()));
  return rows
    .filter(c => wanted.has(String(c.name || '').toUpperCase()))
    .map(c => c.id);
}

async function getDialogPopupId(site, promoId) {
  // List endpoint carries dialog_popup_list; detail endpoint does not.
  const r = await authedFetch(site, `/api/bo/promotion?id=${promoId}&perPage=5`);
  const rows = Object.values(r.data?.rows ?? {});
  const promo = rows.find(p => p.id === promoId);
  return promo?.dialog_popup_list?.[0] ?? null;
}

function buildPutBody(detail, catIds, popupRow) {
  const gpIds = Array.isArray(detail.game_provider_ids) ? detail.game_provider_ids : [];
  const target0 = Array.isArray(detail.target) ? detail.target[0] : (detail.target?.['0'] ?? {});
  const targetGpIds = Array.isArray(target0.game_provider_ids)
    ? target0.game_provider_ids : gpIds;

  const body = {
    id:   detail.id,
    code: detail.code,
    name: detail.name,
    free_spin_game_provider_id: detail.free_spin_game_provider_id ?? 0,
    promotion_category_turnover: arrayToIntObj(catIds),
    promotion_category_winloss:  [],
    promo_type:     detail.promo_type,
    promo_sub_type: detail.promo_sub_type,
    promotion_ids:  [],
    valid_from:     isoToBoDatetime(detail.valid_from),
    validity:       detail.validity,
    reward_validity: detail.reward_validity,
    frequency:      detail.frequency ?? [],
    frequency_type: Number(detail.frequency_type),
    first_deposit:  0,
    member_group_ids: [],
    last_deposit:   detail.last_deposit,
    auto_approve:   detail.auto_approve,
    visible_by_affiliate: detail.visible_by_affiliate,
    recurring:      detail.recurring ?? 0,
    max_per_player: detail.max_per_player ?? 99999,
    daily_max:      detail.daily_max ?? 1,
    status:         detail.status,
    limit_transfer_in:  detail.limit_transfer_in,
    limit_transfer_out: detail.limit_transfer_out,
    restrict_claim_round_active:    detail.restrict_claim_round_active,
    restrict_same_provider_launch:  detail.restrict_same_provider_launch,
    auto_unlock:    detail.auto_unlock,
    allow_cancel:   detail.allow_cancel,
    game_provider_ids: arrayToIntObj(gpIds),
    target: {
      '0': {
        type:       target0.type      ?? 1,
        multiplier: target0.multiplier ?? 0,
        game_provider_ids: arrayToIntObj(targetGpIds),
      },
    },
    message_template_id:     detail.message_template_id ?? 0,
    message_template_sms_id: 0,
    eligible_types: detail.eligible_types,
    affiliate_group_ids:            [],
    telemarketer_ids:               [],
    normal_account_manager_ids:     [],
    vip_account_manager_ids:        [],
    requires_email:    detail.requires_email,
    requires_mobile:   detail.requires_mobile,
    requires_dob:      detail.requires_dob,
    requires_fullname: detail.requires_fullname,
    transfer_unlock:   detail.transfer_unlock,
    kyc_basic:    detail.kyc_basic,
    kyc_advanced: detail.kyc_advanced,
    kyc_pro:      detail.kyc_pro,
    blacklist_id: detail.blacklist_id,
    black_list_sub_categories: [],
    // Preserve existing dialog popup linkage if any
    dialog_popup_list: popupRow
      ? { '0': { id: popupRow.popup_id, start_date: popupRow.created_at ? isoToBoDatetime(popupRow.created_at) : '', end_date: null, promotion_id: detail.id, labelKey: '', code: '' } }
      : [],
  };

  if (detail.bonus_rate != null) body.bonus_rate = String(Number(detail.bonus_rate).toFixed(2));
  if (detail.recurring && detail.reset_frequency) body.reset_frequency = detail.reset_frequency;
  if (detail.free_spin_game_code) body.free_spin_game_code = detail.free_spin_game_code;

  return body;
}

// ── Main ─────────────────────────────────────────────────────────────────
console.log(`\nBackfill categories — ${COMMIT ? 'LIVE (--commit)' : 'DRY RUN'}`);
console.log('─'.repeat(70));

let ok = 0, fail = 0;

for (const { brand, id, cats } of TARGETS) {
  const site = getSite(brand);
  process.stdout.write(`  ${brand.padEnd(8)} id=${String(id).padEnd(5)} cats=[${cats.join(', ')}] → `);

  try {
    // 1. Fetch detail + categories catalog + dialog popup (in parallel)
    const [detailRes, catIds, popupRow] = await Promise.all([
      authedFetch(site, `/api/bo/promotion/${id}`).then(r => r.data?.rows),
      resolveCatIds(site, cats),
      getDialogPopupId(site, id),
    ]);

    if (!detailRes) { console.log('SKIP — detail not found'); fail++; continue; }
    if (catIds.length === 0) { console.log(`SKIP — no matching category IDs for [${cats.join(', ')}]`); fail++; continue; }
    if (catIds.length !== cats.length) {
      console.log(`WARN — only ${catIds.length}/${cats.length} cats resolved: ids=${catIds.join(',')}`);
    }

    const putBody = buildPutBody(detailRes, catIds, popupRow);

    if (!COMMIT) {
      console.log(`would PUT cat_ids=[${catIds.join(',')}]  (popup=${popupRow ? popupRow.popup_id : 'none'})`);
      ok++;
      continue;
    }

    // 2. PUT
    const putRes = await authedFetch(site, `/api/bo/promotion/${id}`, {
      method: 'PUT',
      body: putBody,
    });

    if (putRes.success || putRes.status === 'success' || putRes.data) {
      console.log(`✓ saved  cat_ids=[${catIds.join(',')}]`);
      ok++;
    } else {
      console.log(`✗ PUT returned unexpected response: ${JSON.stringify(putRes).slice(0, 120)}`);
      fail++;
    }

  } catch (e) {
    console.log(`ERROR — ${e.message.split('\n')[0].slice(0, 80)}`);
    fail++;
  }
}

console.log('─'.repeat(70));
console.log(`  ${COMMIT ? 'Saved' : 'Would save'}: ${ok}   Skipped/failed: ${fail}`);
if (!COMMIT) console.log('\n  Run with --commit to apply.\n');
else console.log('');
