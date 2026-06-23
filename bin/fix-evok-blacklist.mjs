#!/usr/bin/env node
// Probe + fix: remove EVOK (unknown-category game provider) from blacklist templates
// on QPRO (all brands) and QP2 (ibc22).
//
// "Untick" = remove EVOK sub-categories from the template's excluded set so
// EVOK games become ALLOWED for promos using each template.
//
// Usage:
//   node bin/fix-evok-blacklist.mjs             # probe only (READ-ONLY)
//   node bin/fix-evok-blacklist.mjs --commit     # apply live
//   node bin/fix-evok-blacklist.mjs --site=qpro1 # single brand
//   node bin/fix-evok-blacklist.mjs --platform=qp2  # QP2 only

import { authedFetch } from '../src/api-client.js';
import { getSite, listSites } from '../src/sites.js';

// ── Args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const COMMIT   = argv.includes('--commit');
const SITE_ARG = (argv.find(a => a.startsWith('--site=')) || '').split('=')[1];
const PLAT_ARG = (argv.find(a => a.startsWith('--platform=')) || '').split('=')[1];

// ── Site selection ────────────────────────────────────────────────────────────
const allSites = listSites();

let QPRO_SITES = [];
let QP2_SITES  = [];

if (SITE_ARG) {
  const s = getSite(SITE_ARG);
  if (s.platform === 'qp2') QP2_SITES  = [s];
  else                       QPRO_SITES = [s];
} else if (PLAT_ARG === 'qp2') {
  QP2_SITES = allSites.filter(s => s.platform === 'qp2');
} else if (PLAT_ARG === 'qpro') {
  QPRO_SITES = allSites.filter(s => s.platform === 'qpro');
} else {
  QPRO_SITES = allSites.filter(s => s.platform === 'qpro');
  QP2_SITES  = allSites.filter(s => s.platform === 'qp2');
}

console.log('═'.repeat(80));
console.log(`  EVOK BLACKLIST TEMPLATE FIX  [${COMMIT ? 'COMMIT — LIVE' : 'DRY-RUN — READ-ONLY'}]`);
console.log(`  QPRO brands: ${QPRO_SITES.map(s=>s.id).join(', ') || '(none)'}`);
console.log(`  QP2  brands: ${QP2_SITES.map(s=>s.id).join(', ') || '(none)'}`);
console.log('═'.repeat(80));
console.log();

// ─────────────────────────────────────────────────────────────────────────────
//  QPRO branch
// ─────────────────────────────────────────────────────────────────────────────

async function handleQpro(site) {
  const label = `${site.id} (${(site.label||'').slice(0,30)})`;
  console.log(`── QPRO: ${label}`);

  // 1. Get sub-cat catalog to find EVOK sub-cat IDs
  let catalog;
  try {
    const r = await authedFetch(site, '/api/bo/blacklist/gameprovider');
    catalog = r?.data?.rows;
  } catch (e) {
    console.log(`  ✗ /api/bo/blacklist/gameprovider failed: ${e.message.split('\n')[0]}`);
    return;
  }

  // catalog keyed by currency_id → [{game_provider_code, categories:[{name, sub_categories:[{id,name}]}]}]
  const evokSubcatsByCurr = {};  // { currId: [subcatId, ...] }
  let found = false;

  for (const [currId, providers] of Object.entries(catalog)) {
    const pArr = Array.isArray(providers) ? providers : Object.values(providers);
    for (const prov of pArr) {
      const code = String(prov.game_provider_code || prov.code || '').toUpperCase();
      const name = String(prov.name || '').toUpperCase();
      if (!code.includes('EVOK') && !name.includes('EVOK')) continue;
      found = true;
      const subIds = [];
      for (const cat of (prov.categories || [])) {
        for (const sc of (cat.sub_categories || [])) {
          subIds.push(sc.id);
        }
      }
      if (!evokSubcatsByCurr[currId]) evokSubcatsByCurr[currId] = [];
      evokSubcatsByCurr[currId].push(...subIds);
      console.log(`  EVOK found: provider=${code||name}  curr=${currId}  sub-cats=${subIds.join(',')||'(none)'}`);
    }
  }

  if (!found) {
    console.log(`  EVOK not found in /api/bo/blacklist/gameprovider catalog — skipping\n`);
    return;
  }

  // 2. Get all blacklist templates
  let templates;
  try {
    const r = await authedFetch(site, '/api/bo/blacklist?perPage=200&page=1');
    templates = r?.data?.rows || [];
  } catch (e) {
    console.log(`  ✗ /api/bo/blacklist fetch failed: ${e.message.split('\n')[0]}\n`);
    return;
  }

  // 3. For each template, check if any EVOK sub-cat IDs are in settings
  let changed = 0;
  for (const tmpl of templates) {
    const settings = tmpl.settings || [];
    const evokInTemplate = settings.filter(s =>
      (evokSubcatsByCurr[s.settings_currency_id] || []).includes(s.game_provider_sub_category_id)
    );
    if (evokInTemplate.length === 0) {
      console.log(`  template id=${tmpl.id} "${tmpl.name}" → EVOK not in this template (ok)`);
      continue;
    }

    // Build cleaned sub_categories map
    const byCurr = {};
    for (const s of settings) {
      if (!byCurr[s.settings_currency_id]) byCurr[s.settings_currency_id] = [];
      byCurr[s.settings_currency_id].push(s.game_provider_sub_category_id);
    }
    const cleaned = {};
    for (const [currId, ids] of Object.entries(byCurr)) {
      const evokSet = new Set(evokSubcatsByCurr[currId] || []);
      cleaned[currId] = ids.filter(id => !evokSet.has(id));
    }

    const removedCount = evokInTemplate.length;
    const remainingCount = settings.length - removedCount;
    console.log(`  template id=${tmpl.id} "${tmpl.name}" → ⚠ EVOK in ${removedCount} setting(s) → would keep ${remainingCount}`);
    console.log(`    EVOK sub-cats to remove: ${evokInTemplate.map(s=>`curr${s.settings_currency_id}:scid${s.game_provider_sub_category_id}`).join(', ')}`);

    if (!COMMIT) {
      console.log(`    [DRY-RUN] would PUT /api/bo/blacklist/${tmpl.id} removing EVOK`);
      continue;
    }

    // Apply: PUT the cleaned template
    const putBody = {
      name: tmpl.name,
      remarks: tmpl.remarks || '',
      status: tmpl.status,
      sub_categories: cleaned,
    };
    try {
      const res = await authedFetch(site, `/api/bo/blacklist/${tmpl.id}`, { method: 'PUT', body: putBody });
      const settingsAfter = res?.data?.settings?.length ?? '?';
      console.log(`    ✓ PUT OK — settings after: ${settingsAfter}`);
      changed++;

      // QC via list
      const listRes = await authedFetch(site, '/api/bo/blacklist?perPage=200&page=1');
      const tmplAfter = (listRes?.data?.rows || []).find(t => t.id === tmpl.id);
      const verified = (tmplAfter?.settings || []).some(s =>
        (evokSubcatsByCurr[s.settings_currency_id] || []).includes(s.game_provider_sub_category_id)
      );
      console.log(`    QC: EVOK still present after PUT? ${verified ? '✗ YES (problem)' : '✓ NO (removed)'}`);
    } catch (e) {
      console.log(`    ✗ PUT failed: ${e.message.split('\n')[0]}`);
    }
  }

  if (COMMIT) {
    console.log(`  Summary: ${changed} template(s) updated on ${site.id}\n`);
  } else {
    console.log(`  [DRY-RUN] No changes written. Add --commit to apply.\n`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  QP2 branch
// ─────────────────────────────────────────────────────────────────────────────

async function handleQp2(site) {
  const label = `${site.id} (${(site.label||'').slice(0,30)})`;
  console.log(`── QP2: ${label}`);
  // Note: /api/bo/gameprovider returns HTTP 500 on QP2 (known BO issue).
  // We scan blacklist template sub-categories directly for EVOK.

  // 1. Get all blacklist templates
  let templates;
  try {
    const r = await authedFetch(site, '/api/bo/gameprovider/getAllBlacklistTemplate?paginate=false');
    templates = r?.data?.rows || [];
    if (!Array.isArray(templates)) templates = Object.values(templates);
  } catch (e) {
    console.log(`  ✗ getAllBlacklistTemplate failed: ${e.message.split('\n')[0]}\n`);
    return;
  }

  console.log(`  ${templates.length} QP2 templates: ${templates.map(t=>`id=${t.id} "${t.name}"`).join(' | ')}`);

  // 2. For each template, GET detail and look for EVOK sub-cats
  let changed = 0;

  for (const tmpl of templates) {
    let detail;
    try {
      const r = await authedFetch(site, `/api/bo/gameprovider/getBlacklistTemplate/${tmpl.id}`);
      detail = r?.data?.rows || r?.data || r;
    } catch (e) {
      console.log(`  template id=${tmpl.id}: detail fetch failed: ${e.message.split('\n')[0]}`);
      continue;
    }

    // black_list_sub_categories contains the excluded sub-cats
    const blSubcats = detail?.black_list_sub_categories;
    if (!blSubcats || (Array.isArray(blSubcats) && blSubcats.length === 0)) {
      console.log(`  template id=${tmpl.id} "${tmpl.name}" → no sub-cats excluded (ok)`);
      continue;
    }

    // Look for any sub-cat belonging to EVOK provider
    const subcatList = Array.isArray(blSubcats) ? blSubcats : Object.values(blSubcats);
    const evokSubcats = subcatList.filter(sc => {
      const gpCode = String(sc.game_provider_code || sc.provider_code || sc.code || '').toUpperCase();
      const gpName = String(sc.game_provider_name || sc.provider_name || sc.name || '').toUpperCase();
      return gpCode.includes('EVOK') || gpName.includes('EVOK') ||
             (sc.game_provider_id && evokProviders.some(g => g.id === sc.game_provider_id));
    });

    if (evokSubcats.length === 0) {
      console.log(`  template id=${tmpl.id} "${tmpl.name}" → EVOK not in exclusions (ok)`);
      continue;
    }

    const evokSubcatIds = evokSubcats.map(sc => sc.id || sc.sub_category_id);
    console.log(`  template id=${tmpl.id} "${tmpl.name}" → ⚠ EVOK in ${evokSubcats.length} sub-cat(s): ids=${evokSubcatIds.join(',')}`);

    if (!COMMIT) {
      console.log(`    [DRY-RUN] would PUT to remove EVOK from this template`);
      continue;
    }

    // Build cleaned sub-cat list (all current minus EVOK)
    const evokSet = new Set(evokSubcatIds);
    const cleanedIds = subcatList
      .filter(sc => !evokSet.has(sc.id || sc.sub_category_id))
      .map(sc => sc.id || sc.sub_category_id);

    // QP2 update endpoint (inferred — check if this matches your BO)
    try {
      const res = await authedFetch(site, `/api/bo/gameprovider/updateBlacklistTemplate/${tmpl.id}`, {
        method: 'PUT',
        body: { name: tmpl.name, status: tmpl.status, sub_category_ids: cleanedIds },
      });
      console.log(`    ✓ PUT OK: ${JSON.stringify(res?.data || res).slice(0, 120)}`);
      changed++;

      // QC
      const verifyR = await authedFetch(site, `/api/bo/gameprovider/getBlacklistTemplate/${tmpl.id}`);
      const afterSubs = verifyR?.data?.rows?.black_list_sub_categories || [];
      const afterList = Array.isArray(afterSubs) ? afterSubs : Object.values(afterSubs);
      const stillHas = afterList.some(sc => {
        const c = String(sc.game_provider_code || sc.code || '').toUpperCase();
        return c.includes('EVOK') || evokProviders.some(g => g.id === sc.game_provider_id);
      });
      console.log(`    QC: EVOK still present? ${stillHas ? '✗ YES (problem)' : '✓ NO (removed)'}`);
    } catch (e) {
      console.log(`    ✗ PUT failed: ${e.message.split('\n')[0]}`);
      console.log(`    NOTE: QP2 blacklist template update endpoint may differ. Check BO network tab.`);
    }
  }

  if (COMMIT) {
    console.log(`  Summary: ${changed} template(s) updated on ${site.id}\n`);
  } else {
    console.log(`  [DRY-RUN] No changes written. Add --commit to apply.\n`);
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────

for (const site of QPRO_SITES) {
  try { await handleQpro(site); }
  catch (e) { console.log(`  FATAL ${site.id}: ${e.message.split('\n')[0]}\n`); }
}

for (const site of QP2_SITES) {
  try { await handleQp2(site); }
  catch (e) { console.log(`  FATAL ${site.id}: ${e.message.split('\n')[0]}\n`); }
}

console.log('═'.repeat(80));
console.log(COMMIT
  ? '  Done. Run without --commit to verify no EVOK remains.'
  : '  Dry-run complete. Add --commit to apply changes.');
console.log('═'.repeat(80));
