#!/usr/bin/env node
// Wire a newly-added game provider into all relevant rebate settings across
// QPRO brands.  Run AFTER tech adds the provider to the BO — BEFORE it's
// enabled.  The script resolves the provider by CODE on each brand, detects
// which categories it supports, then adds it to every rebate setting whose
// category overlaps.  Idempotent — skips settings already containing it.
//
// Usage:
//   node bin/add-provider-to-rebate.mjs --provider JILI              ← dry-run
//   node bin/add-provider-to-rebate.mjs --provider JILI --commit     ← live
//
// Options:
//   --provider <CODE>    BO game-provider code, e.g. JILI, PGS, PP2   (required)
//   --commit             Apply changes; omit for dry-run
//   --category <name>    Restrict to settings whose name contains this string
//                        (e.g. "Slots", "Live Casino", "Fishing").
//                        Auto-detected from provider's category list if omitted.
//   --brands <list>      Comma-separated site IDs, e.g. qpro1,qpro7
//                        Default: all QPRO brands in bo-sites.json

import { authedFetch } from '../src/api-client.js';
import { listSites }   from '../src/sites.js';

// ── CLI ──────────────────────────────────────────────────────────────────────
function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const COMMIT        = process.argv.includes('--commit');
const PROVIDER_CODE = (getArg('--provider') || '').toUpperCase();
const CAT_FILTER    = getArg('--category');   // optional name-substring override
const BRANDS_ARG    = getArg('--brands');
const BRANDS_LIST   = BRANDS_ARG ? BRANDS_ARG.split(',').map(s => s.trim()) : null;

if (!PROVIDER_CODE) {
  console.error('Error: --provider <CODE> is required');
  console.error('Usage: node bin/add-provider-to-rebate.mjs --provider JILI [--commit] [--category Slots] [--brands qpro1,qpro2]');
  process.exit(1);
}

// Only QPRO has /api/bo/rebate/settings
const sites = listSites()
  .filter(s => s.platform === 'qpro')
  .filter(s => !BRANDS_LIST || BRANDS_LIST.includes(s.id));

if (!sites.length) {
  console.error('No matching QPRO sites found. Check --brands value against bo-sites.json.');
  process.exit(1);
}

// ── Header ───────────────────────────────────────────────────────────────────
console.log('═'.repeat(65));
console.log(`  ADD PROVIDER TO REBATE SETTINGS  [${COMMIT ? 'LIVE' : 'DRY-RUN'}]`);
console.log('═'.repeat(65));
console.log(`  Provider       : ${PROVIDER_CODE}`);
if (CAT_FILTER) console.log(`  Category filter: "${CAT_FILTER}" (name contains)`);
console.log(`  Brands         : ${sites.map(s => s.id).join(', ')} (${sites.length} total)`);
console.log();

let totalOk = 0, totalWouldAdd = 0, totalAlready = 0, totalErr = 0;

// ── Per-brand loop ───────────────────────────────────────────────────────────
for (const site of sites) {
  const label = site.label || site.id;
  console.log(`\n${label}`);
  console.log('  ' + '─'.repeat(55));

  try {
    // 1. Resolve provider by CODE.
    //    Use perPage=300 (camelCase) — the server ignores per_page (snake_case)
    //    and always pages at 30.  perPage=300 returns everything in one shot.
    const gpListResp = await authedFetch(site, '/api/bo/gameprovider?perPage=300&page=1');
    const allGps = gpListResp.data.rows || [];
    const gp = allGps.find(g => g.code.toUpperCase() === PROVIDER_CODE);

    if (!gp) {
      console.log(`  ⚠  ${PROVIDER_CODE} not found on this brand — skipping`);
      continue;
    }

    // 2. Get provider detail → which categories it supports on this brand
    const gpDetResp = await authedFetch(site, `/api/bo/gameprovider/${gp.id}`);
    const gpDet = Array.isArray(gpDetResp.data) ? gpDetResp.data[0] : gpDetResp.data;
    const providerCats   = gpDet.category || [];
    const providerCatIds = new Set(providerCats.map(c => c.category_id));
    const catNames       = providerCats.map(c => c.category_code || c.category_id).join(', ') || '(none)';

    console.log(`  Provider: id=${gp.id}  "${gp.name}"  categories: [${catNames}]`);

    if (providerCatIds.size === 0 && !CAT_FILTER) {
      console.log(`  ⚠  No category mapping returned for this provider.`);
      console.log(`     Use --category <name> to force-match settings by name.`);
      continue;
    }

    // 3. Load all rebate settings for this brand
    //    The listing embeds the full member_groups array — use it for filtering
    const settingsResp = await authedFetch(site, '/api/bo/rebate/settings?perPage=300');
    const settings = settingsResp.data.rows || settingsResp.data;
    console.log(`  Rebate settings: ${settings.length}`);

    for (const setting of settings) {
      const mgs = Array.isArray(setting.member_groups) ? setting.member_groups : [];

      // ── Category matching ──────────────────────────────────────────────────
      if (CAT_FILTER) {
        // User supplied a name filter — honour it; skip category-ID check
        if (!setting.name.toLowerCase().includes(CAT_FILTER.toLowerCase())) continue;
      } else {
        // Auto-match: setting's categories must overlap provider's categories
        const settingCatIds = new Set(mgs.map(m => m.category_id));
        const hasOverlap = [...providerCatIds].some(cid => settingCatIds.has(cid));
        if (!hasOverlap) continue;
      }

      // ── Idempotency check ─────────────────────────────────────────────────
      const existingGpIds = [...new Set(mgs.map(m => m.game_provider_id))];
      if (existingGpIds.includes(gp.id)) {
        console.log(`  ─  id=${String(setting.id).padEnd(4)} ${setting.name.padEnd(42)} already in`);
        totalAlready++;
        continue;
      }

      // ── Dry-run output ────────────────────────────────────────────────────
      process.stdout.write(`  ➕ id=${String(setting.id).padEnd(4)} ${setting.name.padEnd(42)} `);

      if (!COMMIT) {
        process.stdout.write('[dry-run]\n');
        totalWouldAdd++;
        continue;
      }

      // ── Live: GET fresh detail → PUT with new provider appended ───────────
      try {
        const detResp = await authedFetch(site, `/api/bo/rebate/settings/${setting.id}`);
        const det     = detResp.data?.rows ?? detResp.data;
        const freshMgs    = det.member_groups || [];
        const freshGpIds  = [...new Set(freshMgs.map(m => m.game_provider_id))];
        const freshMgIds  = [...new Set(freshMgs.map(m => m.member_group_id))];
        const freshCatIds = [...new Set(freshMgs.map(m => m.category_id))];
        const freshCurrIds= [...new Set(freshMgs.map(m => m.settings_currency_id))];

        // Guard against race condition (another operator added same provider)
        if (freshGpIds.includes(gp.id)) {
          process.stdout.write('─ already added (race)\n');
          totalAlready++;
          continue;
        }

        await authedFetch(site, `/api/bo/rebate/settings/${setting.id}`, {
          method: 'PUT',
          body: {
            name:             det.setting.name,
            percentage:       det.setting.percentage,
            status:           det.setting.status,
            min_rebate_limit: det.setting.min_rebate_limit,
            max_rebate_limit: det.setting.max_rebate_limit,
            member_groups:    freshMgIds,
            game_providers:   [...freshGpIds, gp.id],
            categories:       freshCatIds,
            currencies:       freshCurrIds,
          },
        });

        process.stdout.write('✓\n');
        totalOk++;
        await new Promise(r => setTimeout(r, 150)); // gentle rate-limit
      } catch (err) {
        process.stdout.write(`✗ ${err.message.slice(0, 80)}\n`);
        totalErr++;
      }
    }

  } catch (err) {
    console.log(`  ✗ Brand-level error: ${err.message.slice(0, 120)}`);
    totalErr++;
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(65));
if (COMMIT) {
  console.log(`  ✓ Updated : ${totalOk}`);
  console.log(`  ─ Already : ${totalAlready}`);
  if (totalErr) console.log(`  ✗ Errors  : ${totalErr}`);
} else {
  console.log(`  DRY-RUN complete`);
  console.log(`  Would add  : ${totalWouldAdd} settings`);
  if (totalAlready) console.log(`  Already in : ${totalAlready} settings (would be skipped)`);
  console.log(`  Re-run with --commit to apply.`);
}
console.log('═'.repeat(65) + '\n');
