#!/usr/bin/env node
// One-off fix: update promotionname records on QPRO BO for handles where
// game_by_brand differs from the generic (QP2/WS) game in the promo name.
//
// Usage:
//   node bin/fix-promo-names.mjs P054-r55 P055-r56 P056-r57 P057-r58 P058-r59 P059-r60 P060-r61
//
// What it does (per handle × QPRO brand):
//   1. Load request → promo_code + game_by_brand[brand]
//   2. Find promo on BO by code → promotionId
//   3. GET promotionname records for that promoId
//   4. Compute correct name via replaceGame logic (same as mapper)
//   5. PUT each name record that needs updating

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { getSite }                              from '../src/sites.js';
import { BRAND_TO_SITE }                        from '../src/ingest.js';
import { authedFetch, findPromotionByCode, updatePromotionName } from '../src/api-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Name-replacement logic (mirrors api-mapper-qpro.js block) ────────
function deriveShortGame(brandGame) {
  if (!brandGame) return null;
  return brandGame.includes(':') ? brandGame.split(':')[0].trim() : brandGame;
}

function replaceGameInName(name, shortBrandGame) {
  if (typeof name !== 'string' || !name || !shortBrandGame) return name;
  const m = name.match(/^(.+?)\s+-\s+(\d+FS.*)$/i);
  if (!m) return name;
  const currentGame = m[1].trim().toLowerCase();
  const shortLower  = shortBrandGame.toLowerCase();
  if (shortLower === currentGame
      || shortLower.startsWith(currentGame)
      || currentGame.startsWith(shortLower)) return name;
  return `${shortBrandGame} - ${m[2]}`;
}

const QPRO_BRANDS = new Set([
  'QPRO1','QPRO2','QPRO3','QPRO4','QPRO5','QPRO6','QPRO7','QPRO8','QPRO9',
  'QPRO10','QPRO11','QPRO12','QPRO13','QPRO14','QPRO15','QPRO16','QPRO17',
]);

// ── Main ─────────────────────────────────────────────────────────────
const handles = process.argv.slice(2).filter(Boolean);
if (!handles.length) {
  console.error('Usage: node bin/fix-promo-names.mjs <handle> [<handle> ...]');
  process.exit(1);
}

let totalUpdated = 0;
let totalSkipped = 0;
let totalErrors  = 0;

for (const handle of handles) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Handle: ${handle}`);
  console.log('═'.repeat(60));

  const reqPath = path.join(ROOT, 'captures', 'requests', `${handle}.json`);
  let req;
  try {
    req = JSON.parse(await readFile(reqPath, 'utf8'));
  } catch (e) {
    console.error(`  ✗ Cannot read ${reqPath}: ${e.message}`);
    totalErrors++;
    continue;
  }

  const { promo_code, brands = [], parsed = {} } = req;
  const game_by_brand = parsed.game_by_brand || {};
  const qproBrands = brands.filter((b) => QPRO_BRANDS.has(b));

  if (!qproBrands.length) {
    console.log('  (no QPRO brands — skip)');
    continue;
  }

  // Group QPRO brands by siteId to avoid redundant BO lookups.
  const bySite = new Map();
  for (const brand of qproBrands) {
    const entry = BRAND_TO_SITE[brand];
    if (!entry) { console.warn(`  ⚠ No BRAND_TO_SITE entry for ${brand} — skip`); continue; }
    const siteId = entry.siteId;
    if (!bySite.has(siteId)) bySite.set(siteId, []);
    bySite.get(siteId).push(brand);
  }

  for (const [siteId, brandsOnSite] of bySite) {
    const site = getSite(siteId);

    // Find promo by code (one per BO site; all brands on the same site share
    // the same promotionId for a given code).
    let promotionId;
    try {
      const existing = await findPromotionByCode(site, promo_code);
      if (!existing) {
        console.log(`  [${siteId}] Code "${promo_code}" not found — not saved? skip.`);
        continue;
      }
      promotionId = existing.id;
      console.log(`  [${siteId}] Found promo id=${promotionId}`);
    } catch (e) {
      console.error(`  [${siteId}] ✗ findPromotionByCode: ${e.message}`);
      totalErrors++;
      continue;
    }

    // GET existing promotionname records.
    let nameRows;
    try {
      const resp = await authedFetch(site, `/api/bo/promotionname?promotion_id=${promotionId}`);
      nameRows = resp?.data?.rows || [];
      console.log(`  [${siteId}]   ${nameRows.length} name record(s)`);
    } catch (e) {
      console.error(`  [${siteId}] ✗ GET promotionname: ${e.message}`);
      totalErrors++;
      continue;
    }

    // Use the representative brand's game to compute the correct name.
    // All QPRO brands on the same BO site have the same game for these handles.
    const repBrand = brandsOnSite[0];
    const brandGame = game_by_brand[repBrand];
    if (!brandGame) {
      console.log(`  [${siteId}]   game_by_brand[${repBrand}] not found — skip`);
      continue;
    }
    const shortBrandGame = deriveShortGame(brandGame);
    console.log(`  [${siteId}]   game "${brandGame}" → short "${shortBrandGame}"`);

    for (const row of nameRows) {
      const currentName = row.promotion_name || '';
      const correctedName = replaceGameInName(currentName, shortBrandGame);
      if (correctedName === currentName) {
        console.log(`  [${siteId}]   locale=${row.settings_locale_id} currency=${row.currency_id}: already correct ✓`);
        totalSkipped++;
        continue;
      }
      console.log(`  [${siteId}]   locale=${row.settings_locale_id} currency=${row.currency_id}: "${currentName}" → "${correctedName}"`);
      try {
        await updatePromotionName(site, row.promotion_name_id, {
          promotion_id:       promotionId,
          currency_id:        row.currency_id,
          settings_locale_id: row.settings_locale_id,
          promotion_name:     correctedName,
          rewards_name:       row.rewards_name || correctedName,
        });
        console.log('    ✓ Updated');
        totalUpdated++;
      } catch (e) {
        console.error(`    ✗ PUT failed: ${e.message}`);
        totalErrors++;
      }
    }
  }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`Done. Updated: ${totalUpdated} | Already correct: ${totalSkipped} | Errors: ${totalErrors}`);
