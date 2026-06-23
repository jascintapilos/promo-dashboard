#!/usr/bin/env node
// QC: check dialog_popup_list for all TLEO codes created/replicated this session.
// Uses the LIST endpoint (not detail) — list exposes dialog_popup_list, detail does not.

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const CHECKS = [
  // LC Bronze — QPRO2 only
  { brand: 'qpro2', code: 'FT_REL_TLEO_LC_45PCT_48MX' },
  { brand: 'qpro2', code: 'FT_REL_TLEO_LC_45PCT_138MX' },
  // Silver Slots — original QPRO2
  { brand: 'qpro2', code: 'FT_REL_TLEO_45PCT_228MX' },
  { brand: 'qpro2', code: 'FT_REL_TLEO_45PCT_458MX' },
  // Silver Slots — replicated
  ...['qpro3','qpro4','qpro6','qpro8','qpro10'].flatMap(b => [
    { brand: b, code: 'FT_REL_TLEO_45PCT_228MX' },
    { brand: b, code: 'FT_REL_TLEO_45PCT_458MX' },
  ]),
];

console.log('\nCode'.padEnd(38) + 'Brand'.padEnd(8) + 'ID'.padEnd(8) + 'Dialog popup');
console.log('─'.repeat(80));

for (const { brand, code } of CHECKS) {
  const site = getSite(brand);
  const res  = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=5`);
  const row  = (res.data?.rows || []).find(r => r.code === code);
  if (!row) { console.log(`${code.padEnd(38)}${brand.padEnd(8)}NOT FOUND`); continue; }
  const dpl  = row.dialog_popup_list;
  const dlStr = !dpl || (Array.isArray(dpl) && dpl.length === 0) || (typeof dpl === 'object' && Object.keys(dpl).length === 0)
    ? '(none)'
    : JSON.stringify(dpl).slice(0, 80);
  console.log(`${code.padEnd(38)}${brand.padEnd(8)}${String(row.id).padEnd(8)}${dlStr}`);
}
