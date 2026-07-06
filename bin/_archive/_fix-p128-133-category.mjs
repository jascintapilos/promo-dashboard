#!/usr/bin/env node
// Fix #4: category restriction not persisted on P128-P133 (QPRO1-4 + QP2A).
// Sentinel found list_row.category=null despite categories_only being
// requested (LIVE CASINO / SPORT / SLOTS). Root cause: these were likely
// hand-created in BO UI without checking category boxes, not canary-saved.
//
// Strategy: reuse buildApiPlan() (same resolver the canary uses for fresh
// creates) to compute the CORRECT category/provider/blacklist fields, then
// merge ONLY those fields onto the CURRENT live GET state — explicitly NOT
// touching recurring/max_per_player/daily_max (already fixed today) or any
// other field, since buildUpdateBody() rebuilds those from the stale source
// fixture (resolved.recurring=null) and would silently revert today's fix.
//
// Usage: node bin/_fix-p128-133-category.mjs          # dry-run (prints diff)
//        node bin/_fix-p128-133-category.mjs --commit  # live

import { readFile } from 'node:fs/promises';
import { getSite } from '../src/sites.js';
import { authedFetch, findPromotionByCode } from '../src/api-client.js';
import { buildApiPlan as buildApiPlanQpro } from '../src/api-mapper-qpro.js';
import { buildApiPlan as buildApiPlanQp2 } from '../src/api-mapper-qp2.js';

const COMMIT = process.argv.includes('--commit');

const TARGETS = [
  { handle: 'P128-r129', qpro1Code: 'RET_LC_BASE_15PCT',    sharedCode: 'RET_LC_BASE_15PCT' },
  { handle: 'P129-r130', qpro1Code: 'RET_LC_BOOST_18PCT',   sharedCode: 'RET_LC_BOOST_18PCT' },
  { handle: 'P130-r131', qpro1Code: 'RET_SPORTS_BASE_12PCT',  sharedCode: 'RET_SPORTS_BASE_12PCT' },
  { handle: 'P131-r132', qpro1Code: 'RET_SPORTS_BOOST_15PCT', sharedCode: 'RET_SPORTS_BOOST_15PCT' },
  { handle: 'P132-r133', qpro1Code: 'REL_BASE_12PCT_5X',      sharedCode: 'REL_BASE_12PCT_5X' },
  { handle: 'P133-r134', qpro1Code: 'REL_BOOSTER_15PCT_5X',   sharedCode: 'REL_BOOSTER_15PCT_5X' },
];

const QPRO_BRANDS = [
  { brand: 'QPRO1', site: 'qpro1' },
  { brand: 'QPRO2', site: 'qpro2' },
  { brand: 'QPRO3', site: 'qpro3' },
  { brand: 'QPRO4', site: 'qpro4' },
];

function isoToYmdHms(iso) {
  if (!iso || typeof iso !== 'string') return iso;
  return iso.replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '');
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

console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`FIX #4 — CATEGORY RESTRICTION (P128-P133, QPRO) — ${COMMIT ? 'LIVE (--commit)' : 'DRY-RUN'}`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

const results = [];
for (const t of TARGETS) {
  const resolved = JSON.parse(await readFile(`captures/requests/${t.handle}.json`, 'utf-8'));
  const categoriesOnly = resolved.instructions?.categories_only;
  console.log(`── ${t.handle} (categories_only=${JSON.stringify(categoriesOnly)}) ──`);

  for (const qb of QPRO_BRANDS) {
    const code = qb.brand === 'QPRO1' ? t.qpro1Code : t.sharedCode;
    const site = getSite(qb.site);
    const found = await findPromotionByCode(site, code);
    if (!found) { console.log(`  ${qb.brand}: NOT FOUND (code=${code})`); results.push({ ...t, brand: qb.brand, ok: false }); continue; }

    // Resolve correct category/provider/blacklist via the same resolver the canary uses.
    const plan = await buildApiPlanQpro(resolved, { brand: qb.brand, site });
    const wantCatIds = plan.promotion.promotion_category_turnover;
    const wantGpIds  = plan.promotion.game_provider_ids;
    const wantBlacklist = plan.promotion.blacklist_id;

    const detail = await authedFetch(site, `/api/bo/promotion/${found.id}`);
    const body = detail?.data?.rows;
    if (!body) { console.log(`  ${qb.brand}: GET failed`); results.push({ ...t, brand: qb.brand, ok: false }); continue; }

    const beforeCat = body.category ?? body.promotion_category_turnover ?? null;
    const beforeGp  = body.game_provider_ids ?? null;
    const beforeBl  = body.blacklist_id ?? null;

    // Merge ONLY the 3 target fields — everything else (recurring, max_per_player,
    // daily_max, valid_from, dialog, etc.) stays exactly as the live GET returned it.
    body.promotion_category_turnover = wantCatIds;
    body.game_provider_ids = wantGpIds;
    body.blacklist_id = wantBlacklist;

    normalizeQproBody(body);

    console.log(`  ${qb.brand} (id=${found.id}):`);
    console.log(`    category:    ${JSON.stringify(beforeCat)}  ->  ${JSON.stringify(wantCatIds)}`);
    console.log(`    provider_ids: ${JSON.stringify(beforeGp)}  ->  ${JSON.stringify(wantGpIds)}`);
    console.log(`    blacklist_id: ${beforeBl}  ->  ${wantBlacklist}`);
    console.log(`    (preserved unchanged: recurring=${body.recurring}, reset_frequency=${body.reset_frequency}, max_per_player=${body.max_per_player}, daily_max=${body.daily_max})`);

    if (!COMMIT) { results.push({ ...t, brand: qb.brand, ok: true, dry: true }); continue; }

    try {
      const res = await authedFetch(site, `/api/bo/promotion/${found.id}`, { method: 'PUT', body });
      const ok = res?.success !== false;
      console.log(`    -> PUT: ${ok ? '✅ OK' : '❌ ' + JSON.stringify(res).slice(0, 200)}`);
      results.push({ ...t, brand: qb.brand, ok });
    } catch (e) {
      console.log(`    -> PUT: ❌ ${e.message.split('\n')[0].slice(0, 250)}`);
      results.push({ ...t, brand: qb.brand, ok: false, err: e.message });
    }
  }
  console.log('');
}

console.log(`Summary: ${results.filter(r => r.ok).length}/${results.length} ${COMMIT ? 'fixed' : 'would fix'}`);
if (!COMMIT) console.log('Re-run with --commit to apply.');
