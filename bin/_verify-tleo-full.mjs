#!/usr/bin/env node
// Comprehensive verification of all TLEO reload codes from the planning sheet.
// Probes QPRO2/3/4/6/8/10 + WS1 MY for each code.
//
// Codes extracted from sheet: 1xnuqFBBy4tepk4tgYThv0voNhQcH3Gnyh2HUV0KRPoA
// Silver = no _BR suffix (higher caps), Bronze = _BR suffix (lower caps)

import { authedFetch } from '../src/api-client.js';
import { igmpPost } from '../src/igmp-client.js';
import { getSite } from '../src/sites.js';

// --- Silver codes (from sheet, both Casino and Slots) ---
const SILVER = {
  // Casino LC Silver
  'FT_REL_TLEO_LC_45PCT_228MX':  { cat: 'LC', brands: ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10','ws1'] },
  'FT_REL_TLEO_LC_20PCT_200MX':  { cat: 'LC', brands: ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10','ws1'] },
  'FT_REL_TLEO_LC_20PCT_300MX':  { cat: 'LC', brands: ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10','ws1'] },
  'FT_REL_TLEO_LC_20PCT_400MX':  { cat: 'LC', brands: ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10','ws1'] },
  // Slots Silver (QPRO2+QP2D only per sheet)
  'FT_REL_TLEO_45PCT_228MX':     { cat: 'SLOT', brands: ['qpro2'] },
  'FT_REL_TLEO_45PCT_458MX':     { cat: 'SLOT', brands: ['qpro2'] },
  'FT_REL_TLEO_45PCT_688MX':     { cat: 'SLOT', brands: ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10','ws1'] },
  'FT_REL_TLEO_45PCT_888MX':     { cat: 'SLOT', brands: ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10','ws1'] },
  // Slots Silver (all brands)
  'FT_REL_TLEO_20PCT_100MX':     { cat: 'SLOT', brands: ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10','ws1'] },
  'FT_REL_TLEO_20PCT_200MX':     { cat: 'SLOT', brands: ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10','ws1'] },
  'FT_REL_TLEO_20PCT_300MX':     { cat: 'SLOT', brands: ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10','ws1'] },
  'FT_REL_TLEO_20PCT_400MX':     { cat: 'SLOT', brands: ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10','ws1'] },
};

// --- Bronze codes (from sheet, both Casino and Slots) ---
const BRONZE = {
  // Casino LC Bronze
  'FT_REL_TLEO_LC_45PCT_48MX':   { cat: 'LC',   brands: ['qpro3','qpro4','qpro6','qpro8','qpro10','ws1'] }, // no QPRO2
  'FT_REL_TLEO_LC_20PCT_60MX_BR':  { cat: 'LC', brands: ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10','ws1'] },
  'FT_REL_TLEO_LC_20PCT_100MX_BR': { cat: 'LC', brands: ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10','ws1'] },
  'FT_REL_TLEO_LC_20PCT_200MX_BR': { cat: 'LC', brands: ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10','ws1'] },
  // Slots Bronze
  'FT_REL_TLEO_45PCT_48MX':      { cat: 'SLOT', brands: ['qpro3','qpro4','qpro6','qpro8','qpro10','ws1'] }, // no QPRO2
  'FT_REL_TLEO_45PCT_138MX':     { cat: 'SLOT', brands: ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10','ws1'] },
  'FT_REL_TLEO_45PCT_228MX_BR':  { cat: 'SLOT', brands: ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10','ws1'] },
  'FT_REL_TLEO_45PCT_458MX_BR':  { cat: 'SLOT', brands: ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10','ws1'] },
  'FT_REL_TLEO_20PCT_20MX_BR':   { cat: 'SLOT', brands: ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10','ws1'] },
  'FT_REL_TLEO_20PCT_60MX_BR':   { cat: 'SLOT', brands: ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10','ws1'] },
  'FT_REL_TLEO_20PCT_100MX_BR':  { cat: 'SLOT', brands: ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10','ws1'] },
  'FT_REL_TLEO_20PCT_200MX_BR':  { cat: 'SLOT', brands: ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10','ws1'] },
};

const ALL_BRANDS = ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10','ws1'];

async function checkQpro(brandId, code) {
  const site = getSite(brandId);
  try {
    const list = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=5`);
    const row = (list.data?.rows || []).find((r) => r.code === code);
    if (!row) return { found: false };
    return { found: true, id: row.id, status: row.status };
  } catch (e) {
    return { found: false, error: e.message.slice(0, 50) };
  }
}

async function checkWs1(code) {
  try {
    const res = await igmpPost('ws1-v3-my', '/PM/GetPromotionInfoByCode', { PromotionCode: code });
    const p = res?.data;
    if (!p?.PromotionId) return { found: false };
    return { found: true, id: p.PromotionId, active: p.IsActive };
  } catch (e) {
    return { found: false, error: e.message.slice(0, 50) };
  }
}

async function probeCode(code, info) {
  const r = {};
  const tasks = ALL_BRANDS.map(async (b) => {
    if (!info.brands.includes(b)) { r[b] = { scoped: false }; return; }
    if (b === 'ws1') r[b] = await checkWs1(code);
    else r[b] = await checkQpro(b, code);
  });
  await Promise.all(tasks);
  return r;
}

console.log('Probing all TLEO reload codes from planning sheet...\n');

// Probe in batches of 4 to avoid overwhelming the BOs
async function batchProbe(codes, tier) {
  const results = {};
  const entries = Object.entries(codes);
  for (let i = 0; i < entries.length; i += 4) {
    const batch = entries.slice(i, i + 4);
    const batchResults = await Promise.all(
      batch.map(([code, info]) => probeCode(code, info).then(r => [code, r]))
    );
    for (const [code, r] of batchResults) {
      results[code] = { info: codes[code], r };
      const statuses = Object.entries(r).map(([b, v]) => {
        if (v.scoped === false) return `${b}:-`;
        return `${b}:${v.found ? '✓' : '✗'}`;
      });
      process.stdout.write(`  ${code}: ${statuses.join(' ')}\n`);
    }
  }
  return results;
}

console.log('=== SILVER ===');
const silverResults = await batchProbe(SILVER, 'silver');

console.log('\n=== BRONZE ===');
const bronzeResults = await batchProbe(BRONZE, 'bronze');

// Print clean markdown-style tables
function col(s, w) { return String(s).padEnd(w); }
function statusChar(brandId, brandResult, expectedBrands) {
  if (!expectedBrands.includes(brandId)) return ' — ';
  const r = brandResult[brandId];
  if (!r || r.scoped === false) return ' — ';
  if (r.found) return ` ✓ `;
  return ` ✗ `;
}

const B_COL = [8,8,8,8,8,9,7]; // widths for each brand col
const B_LABELS = ['QPRO2','QPRO3','QPRO4','QPRO6','QPRO8','QPRO10','WS1 MY'];
const B_IDS    = ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10','ws1'];

function printResultTable(label, data) {
  console.log(`\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  ${label}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  // Header
  let hdr = col('Code', 42) + col('Cat', 6);
  for (let i=0;i<B_IDS.length;i++) hdr += col(B_LABELS[i], B_COL[i]);
  console.log(hdr);
  console.log('─'.repeat(100));
  for (const [code, { info, r }] of Object.entries(data)) {
    let row = col(code, 42) + col(info.cat, 6);
    for (let i=0;i<B_IDS.length;i++) {
      row += col(statusChar(B_IDS[i], r, info.brands), B_COL[i]);
    }
    console.log(row);
  }
  console.log('─'.repeat(100));
  // Summary count
  let ok=0, miss=0, total=0;
  for (const { info, r } of Object.values(data)) {
    for (const b of info.brands) {
      total++;
      if (r[b]?.found) ok++; else miss++;
    }
  }
  console.log(`  ${ok}/${total} present, ${miss} missing`);
}

printResultTable('SILVER TIER — TLEO RELOAD BONUS', silverResults);
printResultTable('BRONZE TIER — TLEO RELOAD BONUS', bronzeResults);
