#!/usr/bin/env node
// Check the 10 session-replicated codes:
// 1. Are they listed in the TLEO planning sheet?
// 2. Do they exist in QPRO2/3/4/6/8/10 + WS1 MY?

import { getSheetsClient } from '../src/sheets-client.js';
import { authedFetch } from '../src/api-client.js';
import { igmpPost } from '../src/igmp-client.js';
import { getSite } from '../src/sites.js';

const SHEET_ID = '1xnuqFBBy4tepk4tgYThv0voNhQcH3Gnyh2HUV0KRPoA';

const CODES = [
  'FT_REL_TLEO_LC_20PCT_20MX_BR',
  'FT_REL_TLEO_LC_20PCT_300MX_BR',
  'FT_REL_TLEO_LC_20PCT_400MX_BR',
  'FT_REL_TLEO_20PCT_300MX_BR',
  'FT_REL_TLEO_20PCT_400MX_BR',
  'FT_REL_TLEO_LC_45PCT_138MX',
  'FT_REL_TLEO_LC_45PCT_228MX_BR',
  'FT_REL_TLEO_LC_45PCT_458MX_BR',
  'FT_REL_TLEO_45PCT_688MX',
  'FT_REL_TLEO_45PCT_888MX',
];

const BRANDS = ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10','ws1'];

// --- 1. Read entire sheet and check if each code appears anywhere ---
process.env.PROMO_SHEET_ID = SHEET_ID;
const client = await getSheetsClient();
const { sheets } = client;

const sheetPresence = {};
for (const c of CODES) sheetPresence[c] = { found: false, tabs: [] };

// Read all tabs
const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties(sheetId,title)' });
const tabs = meta.data.sheets.map(s => s.properties.title);

for (const tab of tabs) {
  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${tab}'!A1:Z100`,
      valueRenderOption: 'FORMATTED_VALUE',
    });
  } catch { continue; }
  const raw = JSON.stringify(res.data.values || '');
  for (const code of CODES) {
    if (raw.includes(code)) {
      sheetPresence[code].found = true;
      if (!sheetPresence[code].tabs.includes(tab)) sheetPresence[code].tabs.push(tab);
    }
  }
}

// --- 2. Probe BOs ---
async function checkQpro(brandId, code) {
  try {
    const site = getSite(brandId);
    const list = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=5`);
    const row = (list.data?.rows || []).find(r => r.code === code);
    if (!row) return { found: false };
    return { found: true, id: row.id, status: row.status };
  } catch (e) { return { found: false, error: e.message.slice(0,50) }; }
}

async function checkWs1(code) {
  try {
    const res = await igmpPost('ws1-v3-my', '/PM/GetPromotionInfoByCode', { PromotionCode: code });
    const p = res?.data;
    if (!p?.PromotionId) return { found: false };
    return { found: true, id: p.PromotionId, active: p.IsActive, published: p.IsPublished };
  } catch (e) { return { found: false, error: e.message.slice(0,50) }; }
}

const boResults = {};
for (const code of CODES) {
  boResults[code] = {};
  await Promise.all(BRANDS.map(async b => {
    boResults[code][b] = b === 'ws1' ? await checkWs1(code) : await checkQpro(b, code);
  }));
}

// --- Print results ---
const PAD_CODE = 38;
const BRAND_LABELS = ['QPRO2','QPRO3','QPRO4','QPRO6','QPRO8','QPRO10','WS1 MY'];

function boCell(r) {
  if (!r) return '  ✗ ';
  if (r.found) {
    if (r.active !== undefined) return ` ✓(${r.id}) `;
    return ` ✓(${r.id}) `;
  }
  return r.error ? ' ERR' : '  ✗ ';
}

console.log('\n');
console.log('┌' + '─'.repeat(PAD_CODE + 2) + '┬' + '───────┬' + '───────────────────────────────────────────────────────────────────────────────────────┐');
console.log(`│ ${'Code'.padEnd(PAD_CODE)} │ Sheet │ QPRO2         QPRO3         QPRO4         QPRO6         QPRO8         QPRO10        WS1 MY        │`);
console.log('├' + '─'.repeat(PAD_CODE + 2) + '┼' + '───────┼' + '───────────────────────────────────────────────────────────────────────────────────────┤');

for (const code of CODES) {
  const sp = sheetPresence[code];
  const sheetCol = sp.found ? `  ✓  ` : `  ✗  `;
  const boCols = BRANDS.map(b => {
    const r = boResults[code][b];
    if (!r) return '✗'.padEnd(14);
    if (r.found) return `✓(${r.id})`.padEnd(14);
    return '✗'.padEnd(14);
  }).join('  ');
  console.log(`│ ${code.padEnd(PAD_CODE)} │${sheetCol}│ ${boCols}│`);
}

console.log('└' + '─'.repeat(PAD_CODE + 2) + '┴' + '───────┴' + '───────────────────────────────────────────────────────────────────────────────────────┘');

// Sheet detail
console.log('\n Sheet column detail:');
for (const code of CODES) {
  const sp = sheetPresence[code];
  if (sp.found) console.log(`  ✓ ${code} — found in tab(s): ${sp.tabs.join(', ')}`);
  else console.log(`  ✗ ${code} — NOT in sheet`);
}
