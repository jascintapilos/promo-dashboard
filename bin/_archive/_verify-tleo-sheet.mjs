#!/usr/bin/env node
// Read the TLEO tracking sheet and do a live BO verification for each code × brand.
// Output: two tables (Bronze tier + Silver tier) showing BO existence status.
//
// Usage:
//   node bin/_verify-tleo-sheet.mjs

import { getSheetsClient, listTabs } from '../src/sheets-client.js';
import { authedFetch } from '../src/api-client.js';
import { igmpPost } from '../src/igmp-client.js';
import { getSite } from '../src/sites.js';

const SHEET_ID = '1xnuqFBBy4tepk4tgYThv0voNhQcH3Gnyh2HUV0KRPoA';

// Tier classification from source admin names
const BRONZE_CODES = [
  'FT_REL_TLEO_LC_20PCT_20MX_BR',
  'FT_REL_TLEO_LC_20PCT_300MX_BR',
  'FT_REL_TLEO_LC_20PCT_400MX_BR',
  'FT_REL_TLEO_20PCT_300MX_BR',
  'FT_REL_TLEO_20PCT_400MX_BR',
  'FT_REL_TLEO_LC_45PCT_138MX',
  'FT_REL_TLEO_LC_45PCT_228MX_BR',
  'FT_REL_TLEO_LC_45PCT_458MX_BR',
];
const SILVER_CODES = [
  'FT_REL_TLEO_45PCT_688MX',
  'FT_REL_TLEO_45PCT_888MX',
];

const QPRO_BRANDS = ['qpro3', 'qpro4', 'qpro6', 'qpro8', 'qpro10'];
const WS1_SITE = 'ws1-v3-my';

// Read the sheet to get tabs + raw data
let client;
try {
  process.env.PROMO_SHEET_ID = SHEET_ID;
  client = await getSheetsClient();
  const tabs = await listTabs(client);
  console.log('Sheet tabs:', tabs.map(t => t.name).join(', '));

  // Read first tab (gid=0)
  const tabName = tabs[0].name;
  const { sheets } = client;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${tabName}'!A1:Z50`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  console.log('\nSheet content:');
  for (const row of (res.data.values || [])) {
    console.log(row.join(' | '));
  }
} catch (e) {
  console.log('Sheet read error (continuing with known data):', e.message.slice(0, 200));
}

// --- Live BO verification ---
console.log('\n\n━━━ LIVE BO VERIFICATION ━━━');

async function checkQpro(brandId, code) {
  const site = getSite(brandId);
  try {
    const list = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=5`);
    const row = (list.data?.rows || []).find((r) => r.code === code);
    if (!row) return { found: false };
    return { found: true, id: row.id, status: row.status };
  } catch (e) {
    return { found: false, error: e.message.slice(0, 80) };
  }
}

async function checkWs1(code) {
  try {
    const res = await igmpPost(WS1_SITE, '/PM/GetPromotionInfoByCode', { PromotionCode: code });
    const p = res?.data;
    if (!p?.PromotionId) return { found: false };
    return { found: true, id: p.PromotionId, active: p.IsActive, published: p.IsPublished };
  } catch (e) {
    return { found: false, error: e.message.slice(0, 80) };
  }
}

const results = {};
for (const code of [...BRONZE_CODES, ...SILVER_CODES]) {
  results[code] = {};
  const tasks = QPRO_BRANDS.map(b => checkQpro(b, code).then(r => { results[code][b] = r; }));
  tasks.push(checkWs1(code).then(r => { results[code]['ws1'] = r; }));
  await Promise.all(tasks);
}

function statusStr(r) {
  if (!r) return '?';
  if (r.found === false) return r.error ? 'ERR' : '✗';
  const st = r.status === 1 ? '✓' : `status=${r.status}`;
  const extra = r.id ? `(${r.id})` : '';
  if (r.active !== undefined) {
    return `✓(${r.id})${r.active ? '' : ' INACTIVE'}`;
  }
  return `${st}${extra}`;
}

const BRANDS = [...QPRO_BRANDS, 'ws1'];

function printTable(label, codes) {
  console.log(`\n━━━ ${label} ━━━`);
  const header = ['Code', ...BRANDS].map(s => s.padEnd(22)).join('');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const code of codes) {
    const cols = [code.padEnd(38), ...BRANDS.map(b => statusStr(results[code]?.[b]).padEnd(22))];
    console.log(cols.join(''));
  }
}

printTable('BRONZE TIER', BRONZE_CODES);
printTable('SILVER TIER', SILVER_CODES);
