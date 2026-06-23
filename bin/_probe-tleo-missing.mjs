#!/usr/bin/env node
// FT_REL_TLEO_LC_45PCT_138MX not found on QPRO2 — search variations.
import { authedFetch, findPromotionByCode } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('qpro2');

const variations = [
  'FT_REL_TLEO_LC_45PCT_138MX',
  'FT_REL_TLEO_LC_45PCT_138MX_BR',
  'FT_REL_TLEO_45PCT_138MX',
  'FT_REL_TLEO_45PCT_138MX_BR',
  'FT_REL_TLEO_LC_45PCT_138_BR',
];

for (const c of variations) {
  const row = await findPromotionByCode(site, c);
  console.log(`  ${c}: ${row ? `FOUND id=${row.id}` : 'not found'}`);
}

// Also search via the listing endpoint for any code containing "138"
console.log('\nSearching for codes containing 138...');
const res = await authedFetch(site, '/api/bo/promotion?perPage=200&page=1');
const rows = res.data.rows || [];
const m138 = rows.filter((r) => /138/.test(r.code) || /138/.test(r.name));
for (const r of m138) console.log(`  ${r.code}  (id=${r.id})  "${r.name}"`);

// Also list any FT_REL_TLEO_ codes for completeness
console.log('\nAll FT_REL_TLEO_* codes on QPRO2:');
let page = 1, total = Infinity;
const all = [];
while (page * 200 < total + 200) {
  const r = await authedFetch(site, `/api/bo/promotion?perPage=200&page=${page}`);
  for (const row of r.data.rows || []) all.push(row);
  total = r.data.paginations?.total ?? 0;
  if (!r.data.paginations || page >= r.data.paginations.last_page) break;
  page += 1;
}
const tleo = all.filter((r) => /TLEO/i.test(r.code || '')).sort((a, b) => a.code.localeCompare(b.code));
for (const r of tleo) console.log(`  ${r.code.padEnd(36)} id=${String(r.id).padEnd(5)} status=${r.status} "${r.name}"`);
