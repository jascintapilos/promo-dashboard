#!/usr/bin/env node
// READ-ONLY — for each QPRO brand, show the PP and PP2 game-provider records
// (id, name, status, category codes, currency ids) so we can tell whether PP2
// is actually enabled/playable on brands that currently have 0 PP2 usage.
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const BRANDS = Array.from({ length: 17 }, (_, i) => `qpro${i + 1}`);
const fmt = (gp, det) => {
  if (!gp) return 'ABSENT';
  const cats = (det?.category || []).map(c => c.category_code || c.category_id).join('/') || '(no cats)';
  const curs = (det?.currency || []).join(',') || '(no curr)';
  return `id=${gp.id} status=${gp.status} cats=[${cats}] curr=[${curs}]`;
};

console.log('Brand    PP                                                       PP2');
console.log('─'.repeat(110));
for (const brand of BRANDS) {
  const site = getSite(brand);
  try {
    const r = await authedFetch(site, '/api/bo/gameprovider?perPage=300&page=1');
    const cat = Object.values(r.data?.rows || {});
    const pp = cat.find(g => g.code?.toUpperCase() === 'PP');
    const pp2 = cat.find(g => g.code?.toUpperCase() === 'PP2');
    const [ppDet, pp2Det] = await Promise.all([
      pp ? authedFetch(site, `/api/bo/gameprovider/${pp.id}`).then(x => Array.isArray(x.data) ? x.data[0] : x.data).catch(() => null) : null,
      pp2 ? authedFetch(site, `/api/bo/gameprovider/${pp2.id}`).then(x => Array.isArray(x.data) ? x.data[0] : x.data).catch(() => null) : null,
    ]);
    console.log(`${brand.padEnd(8)} ${fmt(pp, ppDet).padEnd(56)} ${fmt(pp2, pp2Det)}`);
  } catch (e) {
    console.log(`${brand.padEnd(8)} ✗ ${e.message.split('\n')[0].slice(0, 80)}`);
  }
}
