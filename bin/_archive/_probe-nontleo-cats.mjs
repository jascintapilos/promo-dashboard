#!/usr/bin/env node
// Find a NON-TLEO LC/Slots reload on qpro5 with populated promotion_category to
// learn the shape we need to write on TLEO codes.
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('qpro5');
// list categories
const cr = await authedFetch(site, '/api/bo/categories?perPage=500');
const cats = Object.values(cr.data?.rows || {});
console.log('CATEGORIES on qpro5:');
for (const c of cats) console.log(`  ${c.id}\t${c.code}\t${c.name}`);

// scan first 100 promos for one with non-empty promotion_category
const r = await authedFetch(site, '/api/bo/promotion?perPage=200&page=1');
const all = Object.values(r.data?.rows || {});
console.log(`\nTotal promos page1: ${all.length}`);
let probed = 0, withCat = 0;
for (const p of all) {
  if (p.code?.includes('TLEO')) continue;
  if (probed >= 12) break;
  const det = (await authedFetch(site, `/api/bo/promotion/${p.id}`)).data?.rows;
  probed++;
  const pc = det.promotion_category || [];
  if (!pc.length) continue;
  withCat++;
  console.log(`\n  ${p.code} (id=${p.id}) promo_type=${det.promo_type}:`);
  console.log(`    promotion_category[${pc.length}]: ${JSON.stringify(pc.slice(0, 6))}`);
  console.log(`    target: ${JSON.stringify((det.target||[]).map(t=>({type:t.type, m:t.multiplier, gps:(t.game_provider_ids||[]).length})))}`);
  console.log(`    game_provider_ids count: ${(det.game_provider_ids||[]).length}`);
  if (withCat >= 3) break;
}
console.log(`\nProbed ${probed} non-TLEO, ${withCat} had populated promotion_category`);
