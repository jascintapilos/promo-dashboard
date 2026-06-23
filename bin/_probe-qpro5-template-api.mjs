// Probe qpro5:
// 1. Get a known promo ID to use as blacklistgame reference
// 2. POST blacklistgame to get full sub-cat catalog for qpro5
// 3. Understand the category breakdown for LC+Slot template settings
// 4. Probe PUT /api/bo/blacklist/{id} shape

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('qpro5');

// Step 1: Find a qpro5 promo to use
console.log('=== Step 1: Find an active qpro5 promo ===');
const promoList = await authedFetch(site, '/api/bo/promotion?perPage=20&page=1&status=1');
const promos = promoList.data?.rows || [];
console.log(`Found ${promos.length} active promos`);
if (!promos.length) {
  // Try without status filter
  const all = await authedFetch(site, '/api/bo/promotion?perPage=20&page=1');
  const allRows = all.data?.rows || [];
  console.log(`All promos (no filter): ${allRows.length}`);
  allRows.slice(0,3).forEach(p => console.log(`  id=${p.id} code=${p.code} status=${p.status}`));
}
const firstPromo = promos[0];
if (!firstPromo) { console.log('No promos found, cannot probe blacklistgame'); process.exit(1); }
console.log(`Using promo id=${firstPromo.id} code=${firstPromo.code}`);

// Step 2: POST blacklistgame to get sub-cat catalog
console.log('\n=== Step 2: POST blacklistgame for sub-cat structure ===');
const blk = await authedFetch(site, '/api/bo/promotion/blacklistgame', {
  method: 'POST',
  body: { promotion_id: firstPromo.id }
});
const blkData = blk?.data || blk;
const providers = Array.isArray(blkData) ? blkData : (blkData?.rows || []);
console.log(`Providers returned: ${providers.length}`);

// Build sub-cat catalog keyed by sub_cat name+provider
const catalog = {}; // sub_cat_name → {id, prov_code, prov_name, cat_name}
let totalSubcats = 0;
const catBreakdown = {};

for (const prov of providers) {
  for (const sc of (prov.sub_categories || [])) {
    const key = `${prov.code || prov.name}::${sc.name}`;
    catalog[sc.id] = {
      id: sc.id, name: sc.name, prov: prov.code || prov.name,
      cat: sc.game_category?.name || prov.category_name || '?',
      key,
    };
    totalSubcats++;
    const cat = sc.game_category?.name || prov.category_name || '?';
    catBreakdown[cat] = (catBreakdown[cat]||0)+1;
  }
}
console.log(`Total sub-cats: ${totalSubcats}`);
console.log('By category:', JSON.stringify(catBreakdown, null, 2));
