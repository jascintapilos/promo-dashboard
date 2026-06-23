#!/usr/bin/env node
// DRY-RUN PREVIEW — restrict unrestricted TLEO codes on qpro3/4/6/8/10 to their
// game category, using each brand's OWN restricted codes as the reference.
//   • LC codes  → canonical LC set (intersection of restricted LC codes)
//   • Slot codes→ canonical slot set = intersection of restricted slot codes,
//                 then ENSURE PP2 / EXCLUDE PP (operator rule 2026-05-27)
// Borderline providers (in SOME but not ALL restricted codes of a category) are
// flagged per brand for operator confirmation. NO WRITES.

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const BRANDS = ['qpro3', 'qpro4', 'qpro6', 'qpro8', 'qpro10'];
function catOf(c){c=(c||'').toUpperCase();const lc=/LC/.test(c)||/LIVE/.test(c),sl=/SL/.test(c)||/SLOT/.test(c);if(lc&&sl)return'both';if(lc)return'lc';if(sl)return'slots';return'all';}
const prov = p => (p.game_provider||'').split(',').map(s=>s.trim()).filter(Boolean);

function analyseCategory(codes, U) {
  const restricted = codes.filter(p => prov(p).length < U - 5);
  const unrestricted = codes.filter(p => prov(p).length >= U - 1);
  // frequency of each provider among restricted codes
  const freq = {};
  restricted.forEach(p => prov(p).forEach(x => { freq[x] = (freq[x]||0)+1; }));
  const n = restricted.length;
  const core = Object.keys(freq).filter(x => freq[x] === n).sort();          // in ALL restricted
  const borderline = Object.keys(freq).filter(x => freq[x] > 0 && freq[x] < n).sort(); // in SOME
  return { restricted, unrestricted, core, borderline, freq, n };
}

let grandLC = 0, grandSL = 0;
for (const brand of BRANDS) {
  const site = getSite(brand);
  const r = await authedFetch(site, '/api/bo/promotion?code=FT_REL_TLEO&perPage=200&page=1');
  const all = Object.values(r.data?.rows||{}).filter(p=>p.code?.includes('TLEO'));
  const uni = new Set(); all.forEach(p=>prov(p).forEach(x=>uni.add(x)));
  const U = uni.size;

  const lc = analyseCategory(all.filter(p=>catOf(p.category)==='lc'), U);
  const sl = analyseCategory(all.filter(p=>catOf(p.category)==='slots'), U);

  // Canonical sets
  const canonLC = lc.core.slice();                                  // intersection
  let canonSL = sl.core.filter(x => x !== 'PP');                     // exclude PP
  if (!canonSL.includes('PP2')) canonSL.push('PP2');                // ensure PP2
  canonSL = canonSL.sort();

  console.log(`\n========================= ${brand.toUpperCase()} (universe ${U}) =========================`);
  console.log(`LC  : ${lc.unrestricted.length} unrestricted to fix → canonical ${canonLC.length} providers`);
  console.log(`      set: ${canonLC.join(', ')}`);
  if (lc.borderline.length) console.log(`      ⚠ borderline (in some restricted LC codes): ${lc.borderline.map(x=>`${x}(${lc.freq[x]}/${lc.n})`).join(', ')}`);
  console.log(`SLOT: ${sl.unrestricted.length} unrestricted to fix → canonical ${canonSL.length} providers (PP excluded, PP2 ensured)`);
  console.log(`      set: ${canonSL.join(', ')}`);
  if (sl.borderline.length) console.log(`      ⚠ borderline (in some restricted slot codes): ${sl.borderline.map(x=>`${x}(${sl.freq[x]}/${sl.n})`).join(', ')}`);

  // Show one example delta per category
  const exLC = lc.unrestricted[0], exSL = sl.unrestricted[0];
  if (exLC) {
    const cur = new Set(prov(exLC)); const rm = [...cur].filter(x=>!canonLC.includes(x));
    console.log(`   e.g. ${exLC.code}: ${prov(exLC).length} → ${canonLC.length}  (removes ${rm.length}: ${rm.slice(0,8).join(', ')}${rm.length>8?'…':''})`);
  }
  if (exSL) {
    const cur = new Set(prov(exSL)); const rm = [...cur].filter(x=>!canonSL.includes(x)); const add = canonSL.filter(x=>!cur.has(x));
    console.log(`   e.g. ${exSL.code}: ${prov(exSL).length} → ${canonSL.length}  (removes ${rm.length}: ${rm.slice(0,8).join(', ')}${rm.length>8?'…':''}${add.length?`; adds ${add.join(',')}`:''})`);
  }
  grandLC += lc.unrestricted.length; grandSL += sl.unrestricted.length;
}
console.log(`\n=== TOTAL to fix across 5 brands: ${grandLC} LC + ${grandSL} slot = ${grandLC+grandSL} codes ===`);
console.log('NO WRITES PERFORMED (preview only).');
