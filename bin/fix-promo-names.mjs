#!/usr/bin/env node
// Fix promotionname + dialog popup label/title on QPRO BO for handles where
// game_by_brand differs from the generic (QP2/WS) game in the promo name.
//
// Usage:
//   node bin/fix-promo-names.mjs P054-r55 P055-r56 P056-r57 P057-r58 P058-r59 P059-r60 P060-r61
//
// What it does (per handle × QPRO brand):
//   1. Load request → promo_code + game_by_brand[brand]
//   2. Find promo on BO by code → promotionId + popup_id
//   3. Fix promotionname records (promotion_name field)
//   4. Fix dialog popup label (top-level) + contents[].title (per locale)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { getSite }          from '../src/sites.js';
import { BRAND_TO_SITE }    from '../src/ingest.js';
import {
  authedFetch,
  findPromotionByCode,
  updatePromotionName,
  getPopupDetail,
  updateDialogPopup,
} from '../src/api-client.js';

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

    // Find promo by code via the LISTING endpoint (detail GET lacks dialog_popup_list).
    let promotionId, popupId;
    try {
      const listResp = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(promo_code)}&perPage=5`);
      const listRow  = (listResp?.data?.rows || []).find((r) => r.code === promo_code);
      if (!listRow) {
        console.log(`  [${siteId}] Code "${promo_code}" not found — skip.`);
        continue;
      }
      promotionId = listRow.id;
      popupId = listRow.dialog_popup_list?.[0]?.popup_id ?? null;
      console.log(`  [${siteId}] promo id=${promotionId}  popup id=${popupId ?? '(none)'}`);
    } catch (e) {
      console.error(`  [${siteId}] ✗ promotion lookup: ${e.message}`);
      totalErrors++;
      continue;
    }

    // Compute the correct short game name for this site's representative brand.
    const repBrand = brandsOnSite[0];
    const brandGame = game_by_brand[repBrand];
    if (!brandGame) {
      console.log(`  [${siteId}]   game_by_brand[${repBrand}] not found — skip`);
      continue;
    }
    const shortBrandGame = deriveShortGame(brandGame);
    console.log(`  [${siteId}]   game "${brandGame}" → short "${shortBrandGame}"`);

    // ── 1. Fix promotionname records ──────────────────────────────────
    try {
      const resp = await authedFetch(site, `/api/bo/promotionname?promotion_id=${promotionId}`);
      const nameRows = resp?.data?.rows || [];
      console.log(`  [${siteId}]   promotionname: ${nameRows.length} record(s)`);
      for (const row of nameRows) {
        const cur = row.promotion_name || '';
        const fix = replaceGameInName(cur, shortBrandGame);
        if (fix === cur) { totalSkipped++; console.log(`    locale=${row.settings_locale_id}: already correct ✓`); continue; }
        console.log(`    locale=${row.settings_locale_id}: "${cur}" → "${fix}"`);
        await updatePromotionName(site, row.promotion_name_id, {
          promotion_id:       promotionId,
          currency_id:        row.currency_id,
          settings_locale_id: row.settings_locale_id,
          promotion_name:     fix,
          rewards_name:       row.rewards_name || fix,
        });
        console.log('      ✓ updated');
        totalUpdated++;
      }
    } catch (e) {
      console.error(`  [${siteId}] ✗ promotionname fix: ${e.message}`);
      totalErrors++;
    }

    // ── 2. Fix dialog popup label + contents[].title ──────────────────
    if (!popupId) {
      console.log(`  [${siteId}]   dialog: no popup linked — skip`);
      continue;
    }
    try {
      const popup = await getPopupDetail(site, popupId);
      if (!popup) {
        console.log(`  [${siteId}]   dialog: popup ${popupId} not found in listing — skip`);
        continue;
      }
      console.log(`  [${siteId}]   dialog popup ${popupId}: label="${popup.label}" contents=${popup.contents?.length ?? 0}`);

      const correctedLabel = replaceGameInName(popup.label || '', shortBrandGame);
      const contentsOverrides = {};
      let dialogNeedsUpdate = correctedLabel !== (popup.label || '');

      for (const c of (popup.contents || [])) {
        const corrTitle = replaceGameInName(c.title || '', shortBrandGame);
        if (corrTitle !== (c.title || '')) {
          contentsOverrides[c.locale_id] = { title: corrTitle };
          dialogNeedsUpdate = true;
          console.log(`    locale_id=${c.locale_id}: title "${c.title}" → "${corrTitle}"`);
        } else {
          console.log(`    locale_id=${c.locale_id}: title already correct ✓`);
        }
      }

      if (!dialogNeedsUpdate) {
        console.log(`  [${siteId}]   dialog: already correct ✓`);
        totalSkipped++;
        continue;
      }

      await updateDialogPopup(site, popup, {
        topOverrides:     { label: correctedLabel },
        contentsOverrides,
      });
      console.log(`  [${siteId}]   dialog: ✓ updated (label + ${Object.keys(contentsOverrides).length} title(s))`);
      totalUpdated++;
    } catch (e) {
      console.error(`  [${siteId}] ✗ dialog fix: ${e.message}`);
      totalErrors++;
    }
  }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`Done. Updated: ${totalUpdated} | Already correct: ${totalSkipped} | Errors: ${totalErrors}`);
