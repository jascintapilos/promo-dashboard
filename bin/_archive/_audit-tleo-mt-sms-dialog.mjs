#!/usr/bin/env node
// Audit all TLEO promotion codes across QPRO brands.
// For each code found: check inbox MT, SMS MT, and dialog popup link.
// Reports missing fields grouped by brand.

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const BRANDS = ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10'];

const results = [];  // { brand, id, code, mt, smsMt, dialog }

for (const brand of BRANDS) {
  const site = getSite(brand);
  process.stdout.write(`Scanning ${brand}...`);

  let page = 1, total = 0;
  while (true) {
    const res = await authedFetch(site, `/api/bo/promotion?perPage=100&page=${page}`);
    const rows = res.data?.rows || [];
    const last = res.data?.paginations?.last_page ?? 1;
    if (!rows.length) break;

    for (const row of rows) {
      if (!/TLEO/i.test(row.code)) continue;
      // list endpoint exposes dialog_popup_list
      const dpl = row.dialog_popup_list;
      const dialogOk = Array.isArray(dpl) ? dpl.length > 0 : (dpl && Object.keys(dpl).length > 0);

      // detail endpoint has MT + SMS MT
      const det = (await authedFetch(site, `/api/bo/promotion/${row.id}`)).data.rows;

      results.push({
        brand,
        id:     row.id,
        code:   row.code,
        mt:     det.message_template_id || 0,
        smsMt:  det.message_template_sms_id || 0,
        dialog: dialogOk ? (Array.isArray(dpl) ? dpl[0]?.popup_id : Object.values(dpl)[0]?.id) : null,
      });
      total++;
    }
    if (page >= last) break;
    page++;
  }
  console.log(` ${total} TLEO codes found`);
}

// Print summary — highlight rows with any gap
const GAP = (r) => !r.mt || !r.smsMt || !r.dialog;
const ALL_OK = results.filter(r => !GAP(r));
const MISSING = results.filter(r => GAP(r));

console.log(`\nTotal TLEO codes scanned: ${results.length}`);
console.log(`All OK (MT + SMS + Dialog): ${ALL_OK.length}`);
console.log(`Missing at least one:       ${MISSING.length}`);

if (MISSING.length) {
  console.log('\n' + '═'.repeat(100));
  console.log('  CODES WITH GAPS');
  console.log('═'.repeat(100));
  console.log('Brand'.padEnd(8) + 'ID'.padEnd(7) + 'MT'.padEnd(7) + 'SMS'.padEnd(7) + 'Dialog'.padEnd(12) + 'Code');
  console.log('─'.repeat(100));
  for (const r of MISSING) {
    const mtStr    = r.mt    ? String(r.mt)    : '✗';
    const smsStr   = r.smsMt ? String(r.smsMt) : '✗';
    const dlgStr   = r.dialog ? `p=${r.dialog}` : '✗';
    console.log(r.brand.padEnd(8) + String(r.id).padEnd(7) + mtStr.padEnd(7) + smsStr.padEnd(7) + dlgStr.padEnd(12) + r.code);
  }
}

console.log('\n' + '═'.repeat(100));
console.log('  ALL TLEO CODES — FULL LIST');
console.log('═'.repeat(100));
console.log('Brand'.padEnd(8) + 'ID'.padEnd(7) + 'MT'.padEnd(7) + 'SMS'.padEnd(7) + 'Dialog'.padEnd(12) + 'Code');
console.log('─'.repeat(100));
let lastBrand = '';
for (const r of results) {
  if (r.brand !== lastBrand) { console.log(''); lastBrand = r.brand; }
  const mtStr  = r.mt    ? String(r.mt)    : '✗';
  const smsStr = r.smsMt ? String(r.smsMt) : '✗';
  const dlgStr = r.dialog ? `p=${r.dialog}` : '✗';
  const flag   = GAP(r) ? ' ◄' : '';
  console.log(r.brand.padEnd(8) + String(r.id).padEnd(7) + mtStr.padEnd(7) + smsStr.padEnd(7) + dlgStr.padEnd(12) + r.code + flag);
}
