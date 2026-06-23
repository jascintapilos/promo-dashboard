import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('qpro5');

// Get all game providers with sub-categories
const r = await authedFetch(site, '/api/bo/gameprovider?perPage=500&page=1');
const rows = r?.data?.rows || [];
console.log(`Total providers: ${rows.length}`);

// Build sub-cat catalog: id → {provider_name, sub_cat_name, category}
const catalog = {};
let totalSubcats = 0;
for (const p of rows) {
  for (const sc of (p.sub_categories || [])) {
    catalog[sc.id] = {
      prov: p.code || p.name,
      name: sc.name,
      cat: sc.game_category?.name || '?',
    };
    totalSubcats++;
  }
}
console.log(`Total sub-cats: ${totalSubcats}`);

// Show category breakdown
const byCat = {};
Object.values(catalog).forEach(s => byCat[s.cat] = (byCat[s.cat]||0)+1);
console.log('By category:', JSON.stringify(byCat, null, 2));

// Now check sub-cat categories from existing templates
const { readFile } = await import('node:fs/promises');
const a5 = JSON.parse(await readFile('./captures/blacklist-templates/2026-06-08/qpro5.json', 'utf8'));

for (const tmpl of a5) {
  const myrIds = (tmpl.settings||[]).filter(s=>s.settings_currency_id===1).map(s=>s.game_provider_sub_category_id);
  const byCatT = {};
  myrIds.forEach(id => {
    const c = catalog[id]?.cat || `?_${id}`;
    byCatT[c] = (byCatT[c]||0)+1;
  });
  console.log(`\nTemplate "${tmpl.name}" (id=${tmpl.id}) MYR: ${myrIds.length} sub-cats`);
  Object.entries(byCatT).sort((a,b)=>b[1]-a[1]).forEach(([c,n]) => console.log(`  ${c}: ${n}`));
}
