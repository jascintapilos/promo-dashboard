import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { writeFile } from 'node:fs/promises';

const site = getSite('qpro5');

// rows is an object keyed by currency_id → [{game_provider_id, code, categories: [{name, sub_categories}]}]
const r = await authedFetch(site, '/api/bo/blacklist/gameprovider?perPage=500&page=1');
const rows = r?.data?.rows || {};
console.log('Currency keys:', Object.keys(rows));

// Build catalog: sub_cat_id → {prov_code, cat_name, sub_cat_name, currencies: []}
const catalog = {};
for (const [currId, provList] of Object.entries(rows)) {
  for (const prov of provList) {
    for (const cat of (prov.categories || [])) {
      for (const sc of (cat.sub_categories || [])) {
        if (!catalog[sc.id]) {
          catalog[sc.id] = { id: sc.id, name: sc.name, prov: prov.game_provider_code, cat: cat.name, currencies: [] };
        }
        if (!catalog[sc.id].currencies.includes(Number(currId))) catalog[sc.id].currencies.push(Number(currId));
      }
    }
  }
}
console.log('Total unique sub-cats:', Object.keys(catalog).length);

// Category breakdown
const catBreakdown = {};
Object.values(catalog).forEach(sc => catBreakdown[sc.cat] = (catBreakdown[sc.cat]||0)+1);
console.log('By category:', JSON.stringify(catBreakdown, null, 2));

// Verify against template settings
const { readFile } = await import('node:fs/promises');
const a5 = JSON.parse(await readFile('./captures/blacklist-templates/2026-06-08/qpro5.json', 'utf8'));

for (const tmpl of a5.filter(t => (t.settings||[]).length > 0)) {
  const myrIds = (tmpl.settings||[]).filter(s=>s.settings_currency_id===1).map(s=>s.game_provider_sub_category_id);
  const byCat = {};
  let unknown = 0;
  for (const id of myrIds) {
    const entry = catalog[id];
    if (!entry) { unknown++; continue; }
    byCat[entry.cat] = (byCat[entry.cat]||0)+1;
  }
  console.log(`\nTemplate "${tmpl.name}" MYR=${myrIds.length}: unknown=${unknown}`, 
    unknown === 0 ? JSON.stringify(byCat) : '');
}

// Save catalog
await writeFile('./captures/blacklist-templates/qpro5-subcat-catalog.json', JSON.stringify(catalog, null, 2));
console.log('\nSaved catalog');
