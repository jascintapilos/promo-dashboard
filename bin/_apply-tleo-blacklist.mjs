#!/usr/bin/env node
// Apply source-faithful blacklist_sub_categories to all 50 QPRO TLEO saves.
//
// Endpoint discovered via QPRO BO SPA bundle reverse-engineering:
//   POST /api/bo/promotion/blacklistgame      — read per-provider sub-cat list
//   POST /api/bo/promotion/updateblacklistgame — write per-provider sub-cat exclusions
//
// Body shape: { promotion_id, black_list_sub_categories: [
//   {game_provider_id, game_provider_code, category_id, category_code, category_name,
//    settings_currency_id, sub_categories: [{name, status}]}
// ]}
// Setting status=1 marks the sub-category as excluded for that (provider × currency).

import fs from 'node:fs';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const CODE_TO_SRC_ID = {
  'FT_REL_TLEO_LC_20PCT_20MX_BR':  451,
  'FT_REL_TLEO_LC_20PCT_300MX_BR': 468,
  'FT_REL_TLEO_LC_20PCT_400MX_BR': 469,
  'FT_REL_TLEO_20PCT_300MX_BR':    470,
  'FT_REL_TLEO_20PCT_400MX_BR':    471,
  'FT_REL_TLEO_LC_45PCT_138MX':    442,
  'FT_REL_TLEO_LC_45PCT_228MX_BR': 443,
  'FT_REL_TLEO_LC_45PCT_458MX_BR': 444,
  'FT_REL_TLEO_45PCT_688MX':       425,
  'FT_REL_TLEO_45PCT_888MX':       426,
};

const BRANDS = [
  { id: 'qpro3',  currencies: ['MYR', 'SGD'] },
  { id: 'qpro4',  currencies: ['MYR'] },
  { id: 'qpro6',  currencies: ['MYR'] },
  { id: 'qpro8',  currencies: ['MYR'] },
  { id: 'qpro10', currencies: ['MYR'] },
];

const sourceSite = getSite('qpro2');

// Build source blacklist map: code → {provider_code → Set(sub_cat_names lowercased)}
async function loadSourceBlacklists() {
  const out = {};
  for (const [code, srcId] of Object.entries(CODE_TO_SRC_ID)) {
    const det = await authedFetch(sourceSite, `/api/bo/promotion/${srcId}`);
    const blsc = det.data.rows.blacklist_sub_categories || [];
    const map = {};
    for (const item of blsc) {
      const arr = Array.isArray(item.sub_category_name) ? item.sub_category_name : [item.sub_category_name];
      map[item.game_provider_code] = new Set(arr.map((s) => String(s).toLowerCase()));
    }
    out[code] = map;
  }
  return out;
}

function isLC(code) {
  return /_LC_/.test(code);
}

const results = {};
const sourceBl = await loadSourceBlacklists();
console.log('Source blacklists loaded for', Object.keys(sourceBl).length, 'codes');

for (const brand of BRANDS) {
  console.log(`\n━━━ ${brand.id} ━━━`);
  results[brand.id] = {};
  const tsite = getSite(brand.id);

  for (const code of Object.keys(CODE_TO_SRC_ID)) {
    try {
      // Find target promo id
      const list = await authedFetch(tsite, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=5`);
      const row = (list.data?.rows || []).find((r) => r.code === code);
      if (!row) { results[brand.id][code] = { status: 'not_found' }; continue; }
      const promoId = row.id;
      const det = await authedFetch(tsite, `/api/bo/promotion/${promoId}`);
      const main = det.data.rows;
      const gpIds = main.target?.[0]?.game_provider_ids || [];
      const catNames = (main.promotion_category || []).map((c) => isLC(code) ? 'LIVE CASINO' : 'SLOTS');

      // Fetch the blacklistgame list (status=0 for all by default)
      const bg = await authedFetch(tsite, '/api/bo/promotion/blacklistgame', {
        method: 'POST',
        body: { promotion_id: promoId, game_provider_ids: gpIds, categories: catNames },
      });
      const rows = bg.data?.rows || [];

      // Mark source-excluded names as status=1
      const srcMap = sourceBl[code] || {};
      let marked = 0;
      const providersHit = new Set();
      for (const r of rows) {
        const srcSubs = srcMap[r.game_provider_code];
        if (!srcSubs) continue;
        for (const sc of r.sub_categories) {
          if (srcSubs.has(String(sc.name).toLowerCase())) {
            sc.status = 1;
            marked++;
            providersHit.add(r.game_provider_code);
          }
        }
      }

      // POST the update
      const upd = await authedFetch(tsite, '/api/bo/promotion/updateblacklistgame', {
        method: 'POST',
        body: { promotion_id: promoId, black_list_sub_categories: rows },
      });

      // Verify
      const ck = await authedFetch(tsite, `/api/bo/promotion/${promoId}`);
      const ckCount = (ck.data.rows.blacklist_sub_categories || []).length;

      results[brand.id][code] = {
        status: 'updated',
        id: promoId,
        provider_count: providersHit.size,
        sub_cat_marks: marked,
        bo_blacklist_count: ckCount,
        success: upd?.success === true,
      };
      console.log(`  ✓ ${code} id=${promoId}: marked ${marked} sub-cats across ${providersHit.size} providers → BO shows ${ckCount} entries`);
    } catch (e) {
      console.log(`  ✗ ${code}: ${e.message.slice(0, 300)}`);
      results[brand.id][code] = { status: 'error', error: String(e.message) };
    }
  }
}

fs.writeFileSync('tmp/tleo-blacklist-results.json', JSON.stringify(results, null, 2));
console.log('\nWrote tmp/tleo-blacklist-results.json');
