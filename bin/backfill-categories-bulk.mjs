#!/usr/bin/env node
// Bulk backfill of missing promotion_category_turnover on 466 pre-bot QPRO promos.
//
// Data sources:
//   tmp/missing-cats-466.json  — list of {brand, id, code} with no categories
//   tmp/code-cat-ref.json      — per-code category names (from QP2 reference + name inference)
//
// Usage:
//   node bin/backfill-categories-bulk.mjs                        # dry run, all brands
//   node bin/backfill-categories-bulk.mjs --brand qpro1          # dry run, one brand
//   node bin/backfill-categories-bulk.mjs --brand qpro1 --commit # live PUT, one brand
//   node bin/backfill-categories-bulk.mjs --commit               # live PUT, ALL 466
//
// Run brand-by-brand to keep sessions healthy and monitor per-batch.
// Recommended order: qpro2 qpro3 qpro4 qpro6 qpro8 qpro10 qpro1 qpro9 qpro5 qpro7 qpro15 qpro16

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { readFileSync } from 'node:fs';

const COMMIT      = process.argv.includes('--commit');
const _brandEqArg = process.argv.find(a => a.startsWith('--brand='));
const _brandIdx   = process.argv.indexOf('--brand');
const BRAND_ARG   = _brandEqArg ? _brandEqArg.split('=')[1]
                  : _brandIdx >= 0 ? process.argv[_brandIdx + 1]
                  : null;
const SKIP_DUMMY  = !process.argv.includes('--include-dummy');

// ── Load data ───────────────────────────────────────────────────────────────
const missing  = JSON.parse(readFileSync('tmp/missing-cats-466.json', 'utf8'));
const codeRef  = JSON.parse(readFileSync('tmp/code-cat-ref.json',     'utf8'));

let targets = missing;
if (BRAND_ARG) targets = targets.filter(p => p.brand === BRAND_ARG);
if (SKIP_DUMMY) targets = targets.filter(p => !p.code.startsWith('dummy-'));

console.log(`\nBulk category backfill — ${COMMIT ? 'LIVE (--commit)' : 'DRY RUN'}`);
console.log(`Brand filter: ${BRAND_ARG || 'ALL'}`);
console.log(`Targets: ${targets.length} promos`);
console.log('─'.repeat(78));

// ── Helpers ─────────────────────────────────────────────────────────────────
function arrayToIntObj(arr) {
  const out = {};
  arr.forEach((v, i) => { out[String(i)] = v; });
  return out;
}

function isoToBoDatetime(iso) {
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
  const r = await authedFetch(site, `/api/bo/promotion?id=${promoId}&perPage=5`);
  const rows = Object.values(r.data?.rows ?? {});
  const promo = rows.find(p => p.id === promoId);
  return promo?.dialog_popup_list?.[0] ?? null;
}

function buildPutBody(detail, catIds, popupRow) {
  const gpIds  = Array.isArray(detail.game_provider_ids) ? detail.game_provider_ids : [];
  const target0 = Array.isArray(detail.target) ? detail.target[0] : (detail.target?.['0'] ?? {});
  const targetGpIds = Array.isArray(target0.game_provider_ids)
    ? target0.game_provider_ids : gpIds;

  const body = {
    id:   detail.id,
    code: detail.code,
    name: detail.name,
    free_spin_game_provider_id:  detail.free_spin_game_provider_id ?? 0,
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
    restrict_claim_round_active:   detail.restrict_claim_round_active,
    restrict_same_provider_launch: detail.restrict_same_provider_launch,
    auto_unlock:  detail.auto_unlock,
    allow_cancel: detail.allow_cancel,
    game_provider_ids: arrayToIntObj(gpIds),
    target: {
      '0': {
        type:              target0.type       ?? 1,
        multiplier:        target0.multiplier ?? 0,
        game_provider_ids: arrayToIntObj(targetGpIds),
      },
    },
    message_template_id:     detail.message_template_id ?? 0,
    message_template_sms_id: 0,
    eligible_types:          detail.eligible_types,
    affiliate_group_ids:             [],
    telemarketer_ids:                [],
    normal_account_manager_ids:      [],
    vip_account_manager_ids:         [],
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
    dialog_popup_list: popupRow
      ? { '0': { id: popupRow.popup_id, start_date: popupRow.created_at ? isoToBoDatetime(popupRow.created_at) : '', end_date: null, promotion_id: detail.id, labelKey: '', code: '' } }
      : [],
  };

  if (detail.bonus_rate != null)    body.bonus_rate    = String(Number(detail.bonus_rate).toFixed(2));
  if (detail.recurring && detail.reset_frequency) body.reset_frequency = detail.reset_frequency;
  if (detail.free_spin_game_code)   body.free_spin_game_code = detail.free_spin_game_code;

  return body;
}

// ── Main ─────────────────────────────────────────────────────────────────────
let ok = 0, fail = 0, skipped = 0;

// Cache category IDs per brand (avoids repeated catalog fetches)
const catIdCache = {}; // `${brand}:${wantedNames.join(',')}` → ids[]

// Group by brand for cleaner output
const byBrand = {};
for (const t of targets) {
  (byBrand[t.brand] ??= []).push(t);
}

for (const [brand, items] of Object.entries(byBrand)) {
  const site = getSite(brand);
  console.log(`\n  ${brand}  (${items.length} promos)`);

  for (const { id, code } of items) {
    const refEntry = codeRef[code];
    if (!refEntry) {
      console.log(`    [${String(id).padEnd(5)}] ${code.padEnd(46)} SKIP — no category ref`);
      skipped++;
      continue;
    }

    const cats = refEntry.cats;
    process.stdout.write(`    [${String(id).padEnd(5)}] ${code.padEnd(46)} [${refEntry.source}] → `);

    try {
      // Cache cat IDs per brand+wantedNames combo
      const cacheKey = `${brand}:${cats.sort().join(',')}`;
      if (!catIdCache[cacheKey]) {
        catIdCache[cacheKey] = await resolveCatIds(site, cats);
      }
      const catIds = catIdCache[cacheKey];

      if (catIds.length === 0) {
        console.log(`SKIP — no matching IDs for [${cats.join(', ')}]`);
        skipped++;
        continue;
      }

      if (!COMMIT) {
        console.log(`would set cat_ids=[${catIds.join(',')}]`);
        ok++;
        continue;
      }

      // Live PUT
      const [detailRes, popupRow] = await Promise.all([
        authedFetch(site, `/api/bo/promotion/${id}`).then(r => r.data?.rows),
        getDialogPopupId(site, id),
      ]);

      if (!detailRes) { console.log(`SKIP — detail not found`); fail++; continue; }

      const putBody = buildPutBody(detailRes, catIds, popupRow);
      const putRes  = await authedFetch(site, `/api/bo/promotion/${id}`, {
        method: 'PUT',
        body: putBody,
      });

      if (putRes.success || putRes.status === 'success' || putRes.data) {
        console.log(`✓ saved`);
        ok++;
      } else {
        console.log(`✗ unexpected: ${JSON.stringify(putRes).slice(0, 100)}`);
        fail++;
      }

    } catch (e) {
      console.log(`ERROR — ${e.message.split('\n')[0].slice(0, 70)}`);
      fail++;
    }
  }

  console.log(`  ── brand ${brand} done: ok=${ok} fail=${fail} skipped=${skipped} (running total)`);
}

console.log('\n' + '═'.repeat(78));
console.log(`  ${COMMIT ? 'Saved' : 'Would save'}: ${ok}   Skipped: ${skipped}   Failed: ${fail}`);
if (!COMMIT) console.log('  Run with --commit to apply  (add --brand <name> to do one brand at a time)\n');
else console.log('');
