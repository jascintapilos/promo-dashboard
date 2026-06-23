#!/usr/bin/env node
// READ-ONLY CHECK — across QPRO1..QPRO17, scan every promo code and report
// which ones carry the game provider PP (Pragmatic Play, old) and/or PP2.
// Purpose: scope a "remove PP, include PP2" migration on the game-provider set.
//
// NO WRITES. Prints a per-brand table + totals, and writes the full affected
// list to tmp/pp-pp2-check.json for the follow-up swap script to consume.
//
// Usage:
//   node bin/_check-pp-pp2-promos.mjs                 (active promos, status=1)
//   node bin/_check-pp-pp2-promos.mjs --status=0      (inactive/draft)
//   node bin/_check-pp-pp2-promos.mjs --status=all    (active+inactive)
//   node bin/_check-pp-pp2-promos.mjs --brands qpro1,qpro7

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { writeFileSync, mkdirSync } from 'node:fs';

function getArg(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; }
const STATUS_ARG = (() => { const a = process.argv.find(x => x.startsWith('--status=')); return a ? a.split('=')[1] : '1'; })();
const BRANDS_ARG = getArg('--brands');
const STATUSES = STATUS_ARG === 'all' ? ['1', '0'] : [STATUS_ARG];

const ALL_BRANDS = Array.from({ length: 17 }, (_, i) => `qpro${i + 1}`);
const BRANDS = BRANDS_ARG ? BRANDS_ARG.split(',').map(s => s.trim()) : ALL_BRANDS;

const prov = p => (p.game_provider || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

async function listPromos(site, status) {
  const rows = [];
  let page = 1, lastPage = 1;
  do {
    const params = new URLSearchParams({
      perPage: '100', page: String(page), status: String(status),
      category_id: '', game_provider_code: '', currency_id: '', bonus_condition: '',
      merchant_id: '', date_type: 'valid_from', sort_by: 'id', sort_order: 'desc',
    });
    const r = await authedFetch(site, `/api/bo/promotion?${params}`);
    const pageRows = Object.values(r.data?.rows || {});
    rows.push(...pageRows);
    lastPage = r.data?.paginations?.last_page ?? 1;
    page++;
  } while (page <= lastPage);
  return rows;
}

console.log('═'.repeat(96));
console.log(`  PP → PP2 PROMO CHECK  [READ-ONLY]   status=${STATUS_ARG}   brands=${BRANDS.length}`);
console.log('═'.repeat(96));
console.log('  Legend: PP-only = has PP, no PP2 (swap adds PP2 + drops PP) | PP+PP2 = has both (swap drops PP)');
console.log('');
console.log('  Brand    Label                                    Promos  hasPP  hasPP2  PP-only  PP+PP2  PP2-only  ppMissing');
console.log('  ' + '─'.repeat(92));

const affected = [];   // promos that contain PP (the swap targets)
const perBrand = [];
let gTot = 0, gPP = 0, gPP2 = 0, gPPonly = 0, gPPboth = 0, gPP2only = 0;

for (const brand of BRANDS) {
  const site = getSite(brand);
  const label = (site.label || brand).replace(/\s*—.*$/, '').slice(0, 38);
  try {
    // Resolve PP / PP2 presence in this brand's provider catalog
    const gpResp = await authedFetch(site, '/api/bo/gameprovider?perPage=300&page=1');
    const cat = Object.values(gpResp.data?.rows || {});
    const ppGp = cat.find(g => g.code?.toUpperCase() === 'PP');
    const pp2Gp = cat.find(g => g.code?.toUpperCase() === 'PP2');
    const ppMissing = !ppGp ? 'noPP' : (!pp2Gp ? 'noPP2!' : '');

    let promos = [];
    for (const st of STATUSES) promos.push(...await listPromos(site, st));

    let nPP = 0, nPP2 = 0, nPPonly = 0, nPPboth = 0, nPP2only = 0;
    for (const p of promos) {
      const codes = prov(p);
      const hasPP = codes.includes('PP');
      const hasPP2 = codes.includes('PP2');
      if (hasPP) nPP++;
      if (hasPP2) nPP2++;
      if (hasPP && !hasPP2) nPPonly++;
      if (hasPP && hasPP2) nPPboth++;
      if (!hasPP && hasPP2) nPP2only++;
      if (hasPP) {
        affected.push({
          brand, id: p.id, code: p.code, name: p.name, category: p.category,
          promo_type: p.promo_type, status: p.status,
          providerCount: codes.length, hasPP2,
          providers: codes.join(','),
        });
      }
    }

    perBrand.push({ brand, label, promos: promos.length, nPP, nPP2, nPPonly, nPPboth, nPP2only, ppMissing });
    gTot += promos.length; gPP += nPP; gPP2 += nPP2; gPPonly += nPPonly; gPPboth += nPPboth; gPP2only += nPP2only;

    console.log(
      `  ${brand.padEnd(8)} ${label.padEnd(40)} ${String(promos.length).padStart(6)}  ${String(nPP).padStart(5)}  ${String(nPP2).padStart(6)}  ${String(nPPonly).padStart(7)}  ${String(nPPboth).padStart(6)}  ${String(nPP2only).padStart(8)}  ${ppMissing}`,
    );
  } catch (e) {
    console.log(`  ${brand.padEnd(8)} ✗ ERROR: ${e.message.split('\n')[0].slice(0, 70)}`);
    perBrand.push({ brand, error: e.message.split('\n')[0] });
  }
}

console.log('  ' + '─'.repeat(92));
console.log(
  `  ${'TOTAL'.padEnd(49)} ${String(gTot).padStart(6)}  ${String(gPP).padStart(5)}  ${String(gPP2).padStart(6)}  ${String(gPPonly).padStart(7)}  ${String(gPPboth).padStart(6)}  ${String(gPP2only).padStart(8)}`,
);
console.log('═'.repeat(96));
console.log(`  Promos containing PP (swap targets): ${gPP}  →  ${gPPonly} need PP2 added, ${gPPboth} already have PP2`);

try { mkdirSync('tmp', { recursive: true }); } catch {}
const outPath = 'tmp/pp-pp2-check.json';
writeFileSync(outPath, JSON.stringify({ status: STATUS_ARG, generatedFor: BRANDS, totals: { gTot, gPP, gPP2, gPPonly, gPPboth, gPP2only }, perBrand, affected }, null, 2));
console.log(`  Full affected list (${affected.length} codes) written to ${outPath}`);
console.log('  NO WRITES PERFORMED (check only).\n');
