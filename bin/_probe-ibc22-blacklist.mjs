#!/usr/bin/env node
// Probe ibc22 for blacklist template endpoint + slots promo detail

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('ibc22');

// Try different blacklist endpoints
const paths = [
  '/api/bo/blacklist?perPage=100&page=1',
  '/api/bo/blacklisttemplate?perPage=100&page=1',
  '/api/bo/blacklist-template?perPage=100&page=1',
  '/api/bo/promotion/blacklist?perPage=100&page=1',
];

console.log('=== Probing ibc22 blacklist endpoints ===');
for (const path of paths) {
  try {
    const r = await authedFetch(site, path);
    console.log(`\n${path} → SUCCESS`);
    const rows = r.data?.rows || r.data || [];
    const list = Array.isArray(rows) ? rows : Object.values(rows);
    for (const t of list.slice(0, 15)) {
      console.log(`  id=${t.id}  name="${t.name || t.title || JSON.stringify(Object.keys(t))}"`);
    }
  } catch (e) {
    console.log(`${path} → ${e.message.split('\n')[0]}`);
  }
}

// Check slots promo full detail (pid=1003) to see game_provider_ids
console.log('\n=== ibc22 FT_REL_TLEO_50PCT_25MX_SLOT (pid=1003) full detail ===');
const r = await authedFetch(site, '/api/bo/promotion/1003');
const p = r.data?.rows;
console.log('game_provider_ids:', JSON.stringify(p?.game_provider_ids));
console.log('game_provider_codes:', JSON.stringify(p?.game_provider_codes));
console.log('blacklist_template_id:', p?.blacklist_template_id);
console.log('target:', JSON.stringify(p?.target?.slice?.(0,2) || p?.target));

// Also check a qpro2 slots promo (pid=473)
const site2 = getSite('qpro2');
console.log('\n=== qpro2 FT_REL_TLEO_50PCT_25MX_SLOT (pid=473) full detail ===');
const r2 = await authedFetch(site2, '/api/bo/promotion/473');
const p2 = r2.data?.rows;
console.log('game_provider_ids:', JSON.stringify(p2?.game_provider_ids));
console.log('game_provider_codes:', JSON.stringify(p2?.game_provider_codes));
console.log('blacklist_template_id:', p2?.blacklist_template_id);
console.log('target:', JSON.stringify(p2?.target?.slice?.(0,2)));

// Check game providers on qpro2 to find PP and PP2 IDs
console.log('\n=== qpro2 game providers (searching for PP/PP2) ===');
const gp2 = await authedFetch(site2, '/api/bo/gameprovider?perPage=200&page=1');
const providers2 = gp2.data?.rows || [];
for (const gp of providers2) {
  if (gp.code?.includes('PP') || gp.name?.toLowerCase().includes('pragmatic')) {
    console.log(`  id=${gp.id}  code=${gp.code}  name="${gp.name}"`);
  }
}

// Check game providers on ibc22 to find PP and PP2 IDs
console.log('\n=== ibc22 game providers (searching for PP/PP2) ===');
const gpQ = await authedFetch(site, '/api/bo/gameprovider?perPage=200&page=1');
const providersQ = gpQ.data?.rows || [];
for (const gp of providersQ) {
  if (gp.code?.includes('PP') || gp.name?.toLowerCase().includes('pragmatic')) {
    console.log(`  id=${gp.id}  code=${gp.code}  name="${gp.name}"`);
  }
}
