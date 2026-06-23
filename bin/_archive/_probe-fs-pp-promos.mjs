#!/usr/bin/env node
// READ-ONLY — inspect Free Spin promos that contain PP on a brand: show their
// game_provider_ids, free_spin_game_provider_id, free_spin_game_code, and
// whether that FS game code exists in PP2's free-spin game set on this brand.
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { readFileSync } from 'node:fs';

const brand = process.argv[2] || 'qpro1';
const N = Number(process.argv[3] || 6);
const site = getSite(brand);

const gpResp = await authedFetch(site, '/api/bo/gameprovider?perPage=300&page=1');
const cat = Object.values(gpResp.data?.rows || {});
const pp = cat.find(g => g.code?.toUpperCase() === 'PP');
const pp2 = cat.find(g => g.code?.toUpperCase() === 'PP2');
console.log(`${brand}: PP id=${pp?.id} (status ${pp?.status}), PP2 id=${pp2?.id} (status ${pp2?.status})`);

// PP2 free-spin game code set
const pp2Games = await authedFetch(site, `/api/bo/gameprovider/freespingame/PP2`).then(r => r.data?.rows || []).catch(() => []);
const ppGames = await authedFetch(site, `/api/bo/gameprovider/freespingame/PP`).then(r => r.data?.rows || []).catch(() => []);
const pp2Codes = new Set(pp2Games.map(g => String(g.code).toLowerCase()));
const ppCodes = new Set(ppGames.map(g => String(g.code).toLowerCase()));
console.log(`PP FS games: ${ppGames.length}, PP2 FS games: ${pp2Games.length}`);
// How many PP game codes are also present on PP2?
const overlap = [...ppCodes].filter(c => pp2Codes.has(c)).length;
console.log(`PP game codes also on PP2: ${overlap}/${ppCodes.size}`);

const d = JSON.parse(readFileSync('tmp/pp-pp2-check.json', 'utf8'));
const fs = d.affected.filter(a => a.brand === brand && a.promo_type == 4).slice(0, N);
console.log(`\nFS promos containing PP on ${brand} (showing ${fs.length}):`);
for (const a of fs) {
  const det = await authedFetch(site, `/api/bo/promotion/${a.id}`).then(r => r.data?.rows);
  const gpIds = det.game_provider_ids || [];
  const fsProv = det.free_spin_game_provider_id;
  const fsCode = det.free_spin_game_code;
  const codeOnPP2 = fsCode ? pp2Codes.has(String(fsCode).toLowerCase()) : '(no code)';
  console.log(`  ${a.code}`);
  console.log(`    game_provider_ids(${gpIds.length}): ${JSON.stringify(gpIds)}  (PP=${pp?.id} in? ${gpIds.includes(pp?.id)}, PP2=${pp2?.id} in? ${gpIds.includes(pp2?.id)})`);
  console.log(`    free_spin_game_provider_id=${fsProv} (${fsProv===pp?.id?'PP':fsProv===pp2?.id?'PP2':'other'}), free_spin_game_code=${fsCode} → on PP2? ${codeOnPP2}`);
}
