#!/usr/bin/env node
// Probe ibc22 promo details to infer blacklist_template IDs
// and check game_provider_codes on slots/lc promos

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('ibc22');

// Check a sample of promos to find blacklist_template_id values
const samplePids = [
  { pid: 1003, code: 'FT_REL_TLEO_50PCT_25MX_SLOT', cat: 'slots' },
  { pid: 1002, code: 'FT_REL_TLEO_50PCT_25MX_LC',   cat: 'lc'    },
  { pid: 1013, code: 'FT_REL_TLEO_20PCT_400MX',      cat: 'all'   },
  { pid: 986,  code: 'FT_REL_TLEO_LC_45PCT_228MX',  cat: 'lc'    },
  { pid: 979,  code: 'FT_REL_TLEO_45PCT_228MX',      cat: 'all'   },
];

console.log('=== ibc22 promo blacklist_template_id + game_provider_codes ===\n');
for (const { pid, code, cat } of samplePids) {
  try {
    const r = await authedFetch(site, `/api/bo/promotion/${pid}`);
    const p = r.data?.rows;
    const gpc = p?.game_provider_codes || [];
    const hasPP  = gpc.includes('PP');
    const hasPP2 = gpc.includes('PP2');
    console.log(`pid=${pid}  code=${code}  cat=${cat}`);
    console.log(`  blacklist_template_id=${p?.blacklist_template_id ?? 'null'}`);
    console.log(`  hasPP=${hasPP}  hasPP2=${hasPP2}  total_gpc=${gpc.length}`);
    if (cat === 'slots') {
      console.log(`  game_provider_codes=${JSON.stringify(gpc)}`);
    }
    console.log();
  } catch (e) {
    console.log(`pid=${pid}: ERROR ${e.message.split('\n')[0]}\n`);
  }
}

// Also check a few QPRO brands for PP/PP2 provider IDs
const qproSites = ['qpro3','qpro4','qpro6','qpro8','qpro10'];
// Slot promo PIDs per site (from probe output)
const slotPids = {
  qpro3:  473, qpro4: 391, qpro6: 427, qpro8: 483, qpro10: 278
};

console.log('\n=== QPRO slots promo game_provider_ids ===\n');
for (const siteId of qproSites) {
  const s = getSite(siteId);
  const pid = slotPids[siteId];
  try {
    const r = await authedFetch(s, `/api/bo/promotion/${pid}`);
    const p = r.data?.rows;
    const gpIds = p?.game_provider_ids || [];
    console.log(`${siteId} pid=${pid}  blacklist_template_id=${p?.blacklist_template_id ?? 'null'}`);
    console.log(`  game_provider_ids (${gpIds.length}): ${JSON.stringify(gpIds)}`);
  } catch (e) {
    console.log(`${siteId} pid=${pid}: ERROR ${e.message.split('\n')[0]}`);
  }
  console.log();
}

// Get PP/PP2 IDs on each QPRO brand
console.log('\n=== QPRO PP/PP2 provider IDs per brand ===\n');
for (const siteId of ['qpro2', ...qproSites]) {
  const s = getSite(siteId);
  try {
    const r = await authedFetch(s, '/api/bo/gameprovider?perPage=200&page=1');
    const gps = r.data?.rows || [];
    const pp  = gps.find(g => g.code === 'PP');
    const pp2 = gps.find(g => g.code === 'PP2');
    console.log(`${siteId}: PP=${pp?.id ?? 'NOT FOUND'}  PP2=${pp2?.id ?? 'NOT FOUND'}`);
  } catch (e) {
    console.log(`${siteId}: ERROR ${e.message.split('\n')[0]}`);
  }
}
