#!/usr/bin/env node
// Untick EVOK "unknown" sub-category from blacklist templates on QPRO (all brands).
//
// Problem: EVOK's sub-cat named "unknown" is ticked (blacklisted) in templates
//          that include LC games → bets on that sub-cat DON'T count toward TO.
// Fix:     Remove only the "unknown" sub-cat ID from each affected template.
//          All other EVOK sub-cats (Blackjack, RngBlackjack, etc.) remain as-is.
//
// QP2 note: same fix is needed on ibc22 templates id=1,3,4,6 but the API account
//           lacks edit permission — must be done manually in the QP2 BO UI.
//
// Usage:
//   node bin/fix-evok-unknown-subcategory.mjs             # dry-run (READ-ONLY)
//   node bin/fix-evok-unknown-subcategory.mjs --commit     # apply live
//   node bin/fix-evok-unknown-subcategory.mjs --site=qpro1 # single brand

import { authedFetch } from '../src/api-client.js';
import { getSite, listSites } from '../src/sites.js';

// ── Args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const COMMIT   = argv.includes('--commit');
const SITE_ARG = (argv.find(a => a.startsWith('--site=')) || '').split('=')[1];

const allSites = listSites();
const SITES = SITE_ARG
  ? [getSite(SITE_ARG)]
  : allSites.filter(s => s.platform === 'qpro');

console.log('═'.repeat(80));
console.log(`  EVOK "unknown" SUB-CAT FIX  [${COMMIT ? 'COMMIT — LIVE' : 'DRY-RUN — READ-ONLY'}]`);
console.log(`  Brands: ${SITES.map(s => s.id).join(', ')}`);
console.log('═'.repeat(80));

let grandTotal = 0;

for (const site of SITES) {
  const label = `${site.id} (${(site.label || '').slice(0, 30)})`;
  process.stdout.write(`\n── ${label}\n`);

  // 1. Find EVOK "unknown" sub-cat IDs per currency
  let catalog;
  try {
    const r = await authedFetch(site, '/api/bo/blacklist/gameprovider');
    catalog = r?.data?.rows;
  } catch (e) {
    console.log(`  ✗ gameprovider catalog failed: ${e.message.split('\n')[0]}`);
    continue;
  }

  const unknownIdsByCurr = {}; // currId → subcatId
  for (const [currId, providers] of Object.entries(catalog)) {
    const pArr = Array.isArray(providers) ? providers : Object.values(providers);
    for (const prov of pArr) {
      if (!String(prov.game_provider_code || '').toUpperCase().includes('EVOK')) continue;
      for (const cat of (prov.categories || [])) {
        for (const sc of (cat.sub_categories || [])) {
          if (/^unknown$/i.test(String(sc.name || '').trim())) {
            unknownIdsByCurr[currId] = sc.id;
          }
        }
      }
    }
  }

  const unknownCount = Object.keys(unknownIdsByCurr).length;
  if (unknownCount === 0) {
    console.log(`  EVOK "unknown" sub-cat not found in catalog — skipping`);
    continue;
  }
  for (const [curr, scid] of Object.entries(unknownIdsByCurr)) {
    console.log(`  Found: EVOK "unknown" scid=${scid} (curr=${curr})`);
  }

  // 2. Get all blacklist templates
  let templates;
  try {
    const r = await authedFetch(site, '/api/bo/blacklist?perPage=200&page=1');
    templates = r?.data?.rows || [];
  } catch (e) {
    console.log(`  ✗ blacklist list failed: ${e.message.split('\n')[0]}`);
    continue;
  }

  // 3. For each template, check if unknown sub-cat is ticked
  let brandChanged = 0;
  for (const tmpl of templates) {
    const settings = tmpl.settings || [];
    const unknownTicked = settings.filter(s => unknownIdsByCurr[s.settings_currency_id] === s.game_provider_sub_category_id);

    if (unknownTicked.length === 0) {
      console.log(`  template id=${String(tmpl.id).padStart(3)} "${tmpl.name}" → ok (unknown not ticked)`);
      continue;
    }

    // Build new sub_categories map without the unknown sub-cat
    const byCurr = {};
    for (const s of settings) {
      if (!byCurr[s.settings_currency_id]) byCurr[s.settings_currency_id] = [];
      byCurr[s.settings_currency_id].push(s.game_provider_sub_category_id);
    }
    const cleaned = {};
    for (const [currId, ids] of Object.entries(byCurr)) {
      const unknownId = unknownIdsByCurr[currId];
      cleaned[currId] = unknownId !== undefined ? ids.filter(id => id !== unknownId) : ids;
    }

    const removes = unknownTicked.map(s => `curr${s.settings_currency_id}:scid${s.game_provider_sub_category_id}`).join(', ');
    console.log(`  template id=${String(tmpl.id).padStart(3)} "${tmpl.name}" → ⚠ unticking unknown (${unknownTicked.length} rows): ${removes}`);

    if (!COMMIT) {
      console.log(`    [DRY-RUN] would PUT /api/bo/blacklist/${tmpl.id}`);
      continue;
    }

    const putBody = {
      name: tmpl.name,
      remarks: tmpl.remarks || '',
      status: tmpl.status,
      sub_categories: cleaned,
    };

    try {
      const res = await authedFetch(site, `/api/bo/blacklist/${tmpl.id}`, { method: 'PUT', body: putBody });
      const settingsAfter = res?.data?.settings?.length ?? '?';
      console.log(`    ✓ PUT OK — settings after: ${settingsAfter} (was ${settings.length})`);
      brandChanged++;

      // QC: verify unknown no longer ticked
      const listRes = await authedFetch(site, '/api/bo/blacklist?perPage=200&page=1');
      const tmplAfter = (listRes?.data?.rows || []).find(t => t.id === tmpl.id);
      const stillTicked = (tmplAfter?.settings || []).some(s =>
        unknownIdsByCurr[s.settings_currency_id] === s.game_provider_sub_category_id
      );
      console.log(`    QC: unknown still ticked? ${stillTicked ? '✗ YES (problem!)' : '✓ NO (fixed)'}`);
    } catch (e) {
      console.log(`    ✗ PUT failed: ${e.message.split('\n')[0]}`);
    }
  }

  if (COMMIT) {
    console.log(`  → ${brandChanged} template(s) updated on ${site.id}`);
    grandTotal += brandChanged;
  }
}

console.log('\n' + '═'.repeat(80));
if (COMMIT) {
  console.log(`  Done. ${grandTotal} total template(s) updated across all brands.`);
  console.log(`  QP2 (ibc22) still needs manual fix — see instructions below.`);
} else {
  console.log(`  Dry-run complete. No changes written. Run with --commit to apply.`);
}
console.log('═'.repeat(80));

if (!COMMIT) {
  console.log(`
QP2 MANUAL STEPS (ibc22 — API account lacks template-edit permission):
  Affected templates: "All games" (id=1), "Live Casino Only" (id=3),
                      "Live Casino and Slots" (id=4), "Slots, Live Casino, Sports" (id=6)
  For each template:
    BO → Game Provider → Blacklist Templates → Edit template
    Find EVOK provider → expand sub-categories → untick "unknown"
    Save
`);
}
