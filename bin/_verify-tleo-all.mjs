#!/usr/bin/env node
// Full TLEO audit: extract every code from the planning sheet, probe all
// QPRO + WS1 brands, then cross-reference sheet vs BO.
//
// Also includes codes known to exist in BO but missing from sheet.

import { getSheetsClient } from '../src/sheets-client.js';
import { authedFetch } from '../src/api-client.js';
import { igmpPost } from '../src/igmp-client.js';
import { getSite } from '../src/sites.js';

const SHEET_ID = '1xnuqFBBy4tepk4tgYThv0voNhQcH3Gnyh2HUV0KRPoA';
const BRANDS   = ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10','ws1','ibc22'];

// ── 1. Read every cell from the sheet and extract all TLEO code strings ──
process.env.PROMO_SHEET_ID = SHEET_ID;
const client = await getSheetsClient();
const { sheets } = client;

const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties(sheetId,title)' });
const tabs = meta.data.sheets.map(s => s.properties.title);

const sheetCodes = new Set();   // codes that appear in the sheet
const sheetCodeTier = {};       // code → 'Silver' | 'Bronze' | 'Normal'
const sheetCodeCat  = {};       // code → 'LC' | 'SLOT' | 'FC' | 'ALL'

// Regex to capture TLEO-style codes
const CODE_RE = /\b((?:FT_)?(?:REL_)?TLEO_[A-Z0-9_]+)/g;

// Tier / category inference from surrounding context
function inferTier(cellStr) {
  if (/silver/i.test(cellStr)) return 'Silver';
  if (/bronze/i.test(cellStr)) return 'Bronze';
  if (/normal/i.test(cellStr)) return 'Normal';
  return 'Unknown';
}
function inferCat(code) {
  if (/FC/i.test(code) && /TLEO_FC/.test(code)) return 'FC';
  if (/_LC_|_LC\d|_LC$/.test(code)) return 'LC';
  if (/50PCT.*LC|25MX_LC/.test(code)) return 'LC';
  if (/SL_|SLOT/.test(code)) return 'SLOT';
  return 'SLOT'; // default for no-prefix reload
}

for (const tab of tabs) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${tab}'!A1:Z200`,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const rows = res.data.values || [];
  for (let ri = 0; ri < rows.length; ri++) {
    const rowStr = rows[ri].join('|');
    // Determine tier from row context (scan preceding rows)
    let tier = 'Unknown';
    for (let back = Math.max(0, ri-5); back <= ri; back++) {
      const ctx = (rows[back]||[]).join('|');
      if (/silver/i.test(ctx)) { tier = 'Silver'; break; }
      if (/bronze/i.test(ctx)) { tier = 'Bronze'; break; }
      if (/normal/i.test(ctx)) { tier = 'Normal'; break; }
    }
    const matches = [...rowStr.matchAll(CODE_RE)].map(m => m[1]);
    for (const code of matches) {
      // Normalise: ensure FT_ prefix if missing
      const norm = code.startsWith('FT_') ? code : code;
      sheetCodes.add(norm);
      if (!sheetCodeTier[norm]) sheetCodeTier[norm] = tier;
      if (!sheetCodeCat[norm])  sheetCodeCat[norm]  = inferCat(norm);
    }
  }
}

// ── 2. Add BO-only codes (known to exist in BO but not in sheet) ──
const BO_ONLY_EXTRA = [
  'FT_REL_TLEO_LC_20PCT_20MX_BR',
  'FT_REL_TLEO_LC_20PCT_300MX_BR',
  'FT_REL_TLEO_LC_20PCT_400MX_BR',
  'FT_REL_TLEO_20PCT_300MX_BR',
  'FT_REL_TLEO_20PCT_400MX_BR',
  'FT_REL_TLEO_LC_45PCT_138MX',
  'FT_REL_TLEO_LC_45PCT_228MX_BR',
  'FT_REL_TLEO_LC_45PCT_458MX_BR',
];
const allCodes = new Set([...sheetCodes, ...BO_ONLY_EXTRA]);

// ── 3. Probe every brand for every code ──
async function checkQpro(brandId, code) {
  try {
    const site = getSite(brandId);
    const list = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=5`);
    const row  = (list.data?.rows || []).find(r => r.code === code);
    return row ? { found: true, id: row.id } : { found: false };
  } catch { return { found: false }; }
}
// QP2D (ibc22) uses the same QPRO-style endpoint
const checkQp2d = (code) => checkQpro('ibc22', code);
async function checkWs1(code) {
  try {
    const res = await igmpPost('ws1-v3-my', '/PM/GetPromotionInfoByCode', { PromotionCode: code });
    const p = res?.data;
    return p?.PromotionId ? { found: true, id: p.PromotionId } : { found: false };
  } catch { return { found: false }; }
}

const boResults = {};
const codeList  = [...allCodes].sort();

// Probe in parallel batches of 5 codes
for (let i = 0; i < codeList.length; i += 5) {
  const batch = codeList.slice(i, i + 5);
  await Promise.all(batch.map(async code => {
    boResults[code] = {};
    await Promise.all(BRANDS.map(async b => {
      if (b === 'ws1')   boResults[code][b] = await checkWs1(code);
      else if (b === 'ibc22') boResults[code][b] = await checkQp2d(code);
      else               boResults[code][b] = await checkQpro(b, code);
    }));
  }));
  process.stdout.write(`  Probed ${Math.min(i+5, codeList.length)}/${codeList.length} codes...\r`);
}
console.log('\n');

// ── 4. Build output ──
const BL = ['QPRO2','QPRO3','QPRO4','QPRO6','QPRO8','QPRO10','WS1','QP2D'];
const BI = ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10','ws1','ibc22'];

function boCell(code, bid) {
  const r = boResults[code]?.[bid];
  if (!r) return '✗';
  return r.found ? `✓(${r.id})` : '✗';
}
function anyFound(code) {
  return BI.some(b => boResults[code]?.[b]?.found);
}

// Group codes
function groupCodes(tier) {
  return codeList.filter(c => {
    const inSheet = sheetCodes.has(c);
    const t = sheetCodeTier[c] || (BO_ONLY_EXTRA.includes(c) ? 'Bronze' : 'Unknown');
    return t === tier;
  });
}

function printSection(label, codes) {
  if (!codes.length) return;
  console.log(`\n${'═'.repeat(120)}`);
  console.log(`  ${label}`);
  console.log('═'.repeat(120));
  const hdr = 'Code'.padEnd(40) + 'Cat '.padEnd(6) + 'In Sheet  ' + BL.map(b => b.padEnd(15)).join('');
  console.log(hdr);
  console.log('─'.repeat(120));
  for (const code of codes) {
    const inSheet = sheetCodes.has(code) ? '  ✓     ' : '  ✗     ';
    const cat     = (sheetCodeCat[code] || inferCat(code)).padEnd(6);
    const boCols  = BI.map(b => boCell(code, b).padEnd(15)).join('');
    const marker  = !sheetCodes.has(code) ? ' ← BO only' : '';
    console.log(`${code.padEnd(40)}${cat}${inSheet}  ${boCols}${marker}`);
  }
  const total  = codes.length;
  const boOk   = codes.filter(c => anyFound(c)).length;
  const sheetOk = codes.filter(c => sheetCodes.has(c)).length;
  console.log('─'.repeat(120));
  console.log(`  ${boOk}/${total} exist in BO   |   ${sheetOk}/${total} listed in sheet`);
}

// Assign tier to BO-only extras
const BRONZE_OVERRIDE = new Set([
  'FT_REL_TLEO_LC_20PCT_20MX_BR','FT_REL_TLEO_LC_20PCT_300MX_BR',
  'FT_REL_TLEO_LC_20PCT_400MX_BR','FT_REL_TLEO_20PCT_300MX_BR',
  'FT_REL_TLEO_20PCT_400MX_BR','FT_REL_TLEO_LC_45PCT_138MX',
  'FT_REL_TLEO_LC_45PCT_228MX_BR','FT_REL_TLEO_LC_45PCT_458MX_BR',
]);

function getTier(code) {
  if (sheetCodeTier[code] && sheetCodeTier[code] !== 'Unknown') return sheetCodeTier[code];
  if (BRONZE_OVERRIDE.has(code)) return 'Bronze';
  if (/_BR\b/.test(code) || /48MX|138MX|60MX|100MX|200MX|20MX|88_/.test(code)) return 'Bronze';
  return 'Silver';
}

const silver = codeList.filter(c => getTier(c) === 'Silver');
const bronze = codeList.filter(c => getTier(c) === 'Bronze');
const normal = codeList.filter(c => getTier(c) === 'Normal');
const rest   = codeList.filter(c => !['Silver','Bronze','Normal'].includes(getTier(c)));

printSection('SILVER TIER', silver);
printSection('BRONZE TIER', bronze);
if (normal.length) printSection('NORMAL (no tier)', normal);
if (rest.length)   printSection('UNCLASSIFIED', rest);
