#!/usr/bin/env node
// Dump full list-row + full detail-row JSON for 1 FC + 1 LC + 1 Slot on qpro2 vs qpro5.
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const PAIRS = [['qpro2','source'],['qpro5','target']];
const CODES = ['FT_TLEO_FC228_10X', 'FT_REL_TLEO_LC_45PCT_228MX'];

for (const [brand,role] of PAIRS) {
  const site = getSite(brand);
  console.log(`\n══════ ${brand.toUpperCase()} (${role}) ══════`);
  for (const code of CODES) {
    const lr = await authedFetch(site, `/api/bo/promotion?code=${code}&perPage=5`);
    const lp = Object.values(lr.data?.rows||{}).find(p=>p.code===code);
    if (!lp) { console.log(`  ${code}: not found`); continue; }
    console.log(`\n  --- ${code} (list-row) ---`);
    // print every key on list row
    for (const [k,v] of Object.entries(lp)) {
      const s = typeof v === 'object' ? JSON.stringify(v).slice(0,140) : String(v).slice(0,140);
      console.log(`    ${k}: ${s}`);
    }
    const det = (await authedFetch(site, `/api/bo/promotion/${lp.id}`)).data?.rows;
    console.log(`\n  --- ${code} (detail-row keys) ---`);
    for (const [k,v] of Object.entries(det)) {
      const s = Array.isArray(v) ? `Array(${v.length})${v.length?': '+JSON.stringify(v.slice(0,2)).slice(0,140):''}`
              : typeof v === 'object' && v!==null ? `Object: ${JSON.stringify(v).slice(0,140)}`
              : String(v).slice(0,140);
      console.log(`    ${k}: ${s}`);
    }
  }
}
