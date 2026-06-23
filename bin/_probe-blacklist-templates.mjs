#!/usr/bin/env node
// Probe blacklist templates on all QPRO brands + QP2 (ibc22)
// Also fetch all TLEO promos to see current blacklist_template_id + game_provider info

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const QPRO_SITES = ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10'];
const QP2_SITES  = ['ibc22'];

// ── 1. Fetch blacklist templates per platform ──────────────────────────────────

console.log('=== BLACKLIST TEMPLATES ===\n');

// Sample one QPRO site (all share same template names/IDs per brand)
for (const siteId of [...QPRO_SITES, ...QP2_SITES]) {
  const site = getSite(siteId);
  try {
    const r = await authedFetch(site, '/api/bo/blacklist?perPage=100&page=1');
    const rows = r.data?.rows || r.data || [];
    const list = Array.isArray(rows) ? rows : Object.values(rows);
    console.log(`${siteId} blacklist templates:`);
    for (const t of list) {
      console.log(`  id=${t.id}  name="${t.name || t.title || JSON.stringify(t)}"`);
    }
    console.log();
  } catch (e) {
    console.log(`  ${siteId}: ERROR ${e.message}\n`);
  }
}

// ── 2. Fetch all TLEO promos across all brands ────────────────────────────────

console.log('\n=== TLEO PROMOS — current blacklist_template_id + game_provider_ids ===\n');

function catType(code) {
  if (/_LC_/.test(code) || /_LC$/.test(code)) return 'lc';
  if (/_SL_/.test(code) || /_SLOT_/.test(code) || /_SLOT$/.test(code)) return 'slots';
  return 'all';
}

for (const siteId of [...QPRO_SITES, ...QP2_SITES]) {
  const site = getSite(siteId);
  console.log(`--- ${siteId} ---`);
  try {
    // Search for FT_REL_TLEO codes
    const r = await authedFetch(site, '/api/bo/promotion?code=FT_REL_TLEO&perPage=200&page=1');
    const rows = r.data?.rows || [];
    const promos = Array.isArray(rows) ? rows : Object.values(rows);
    const tleo = promos.filter(p => p.code?.includes('TLEO'));

    if (tleo.length === 0) {
      console.log('  (no TLEO promos)\n');
      continue;
    }

    for (const p of tleo) {
      const cat = catType(p.code);
      const gpIds = p.game_provider_ids || [];
      const gpCodes = p.game_provider_codes || [];
      console.log(`  pid=${p.id}  code=${p.code}`);
      console.log(`    cat=${cat}  status=${p.status}  blacklist_template_id=${p.blacklist_template_id ?? 'null'}`);
      if (gpIds.length > 0 || gpCodes.length > 0) {
        console.log(`    game_provider_ids=${JSON.stringify(gpIds)}  game_provider_codes=${JSON.stringify(gpCodes)}`);
      }
    }
    console.log();
  } catch (e) {
    console.log(`  ERROR: ${e.message}\n`);
  }
}
