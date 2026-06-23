#!/usr/bin/env node
// READ-ONLY — locate given promo codes across QPRO1-17 and dump their full
// game-provider + target structure, mapping ids→codes, to see whether the
// Target Amount "Game Providers" list is populated or empty.
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const CODES = process.argv.slice(2);
const BRANDS = Array.from({ length: 17 }, (_, i) => `qpro${i + 1}`);

// per-brand id→code cache
const catCache = {};
async function idToCode(site, brand) {
  if (catCache[brand]) return catCache[brand];
  const r = await authedFetch(site, '/api/bo/gameprovider?perPage=300&page=1');
  const m = {};
  Object.values(r.data?.rows || {}).forEach(g => { m[g.id] = g.code; });
  catCache[brand] = m;
  return m;
}
const mapCodes = (ids, m) => (ids || []).map(id => m[id] || id).join(',') || '(empty)';

for (const code of CODES) {
  console.log(`\n══════ ${code} ══════`);
  let found = 0;
  for (const brand of BRANDS) {
    const site = getSite(brand);
    let row;
    try {
      const r = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=10&page=1`);
      row = Object.values(r.data?.rows || {}).find(x => x.code === code);
    } catch { continue; }
    if (!row) continue;
    found++;
    const m = await idToCode(site, brand);
    const d = await authedFetch(site, `/api/bo/promotion/${row.id}`).then(r => r.data?.rows);
    const tgt = (d.target || []).map((t, i) => `T${i}{mult:${t.multiplier} gp:[${mapCodes(t.game_provider_ids, m)}] cats:[${(t.categories || t.category_ids || []).join(',') || '∅'}]}`).join('  ');
    console.log(`  ${brand}: type=${d.promo_type} status=${row.status}`);
    console.log(`     top game_provider_ids: [${mapCodes(d.game_provider_ids, m)}]`);
    console.log(`     FS award: provider=${m[d.free_spin_game_provider_id] || d.free_spin_game_provider_id} code=${d.free_spin_game_code}`);
    console.log(`     promotion_category: [${(d.promotion_category || []).map(c => c.category_id).join(',') || '∅'}]`);
    console.log(`     target: ${tgt || '(no target)'}`);
  }
  if (!found) console.log('  (not found on any brand)');
}
