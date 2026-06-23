#!/usr/bin/env node
// QC all 18 P122-P127 records across QPRO2/3/4.
import fs from 'node:fs';
import { findPromotionByCode, getPromotionDetail } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const RECORDS = [
  { handle: 'P122-r123', brand: 'QPRO2', siteId: 'qpro2', id: 508 },
  { handle: 'P122-r123', brand: 'QPRO3', siteId: 'qpro3', id: 531 },
  { handle: 'P122-r123', brand: 'QPRO4', siteId: 'qpro4', id: 460 },
  { handle: 'P123-r124', brand: 'QPRO2', siteId: 'qpro2', id: 509 },
  { handle: 'P123-r124', brand: 'QPRO3', siteId: 'qpro3', id: 532 },
  { handle: 'P123-r124', brand: 'QPRO4', siteId: 'qpro4', id: 461 },
  { handle: 'P124-r125', brand: 'QPRO2', siteId: 'qpro2', id: 514 },
  { handle: 'P124-r125', brand: 'QPRO3', siteId: 'qpro3', id: 537 },
  { handle: 'P124-r125', brand: 'QPRO4', siteId: 'qpro4', id: 466 },
  { handle: 'P125-r126', brand: 'QPRO2', siteId: 'qpro2', id: 511 },
  { handle: 'P125-r126', brand: 'QPRO3', siteId: 'qpro3', id: 534 },
  { handle: 'P125-r126', brand: 'QPRO4', siteId: 'qpro4', id: 463 },
  { handle: 'P126-r127', brand: 'QPRO2', siteId: 'qpro2', id: 512 },
  { handle: 'P126-r127', brand: 'QPRO3', siteId: 'qpro3', id: 535 },
  { handle: 'P126-r127', brand: 'QPRO4', siteId: 'qpro4', id: 464 },
  { handle: 'P127-r128', brand: 'QPRO2', siteId: 'qpro2', id: 513 },
  { handle: 'P127-r128', brand: 'QPRO3', siteId: 'qpro3', id: 536 },
  { handle: 'P127-r128', brand: 'QPRO4', siteId: 'qpro4', id: 465 },
];

async function qcOne({ handle, brand, siteId, id }) {
  const resolved = JSON.parse(fs.readFileSync(`captures/requests/${handle}.json`, 'utf8'));
  const src = resolved.parsed || {};
  const site = getSite(siteId);
  const row = { handle, brand, id, code: resolved.promo_code, l1: '?', l2: '?', issues: [] };

  // L1
  const listRow = await findPromotionByCode(site, resolved.promo_code);
  if (!listRow) { row.l1 = 'FAIL'; row.issues.push('code not found'); return row; }
  row.l1 = listRow.id === id && listRow.status == 1 ? 'PASS' : 'FAIL';
  if (listRow.id !== id) row.issues.push(`id mismatch: BO=${listRow.id} expected=${id}`);
  if (listRow.status != 1) row.issues.push(`status=${listRow.status}`);

  // L2
  try {
    const det = await getPromotionDetail(site, id);
    const bo = det.parsed || {};
    const checks = [
      ['MinDeposit',  bo.min_deposit,   src.min_deposit],
      ['Turnover',    bo.to_multiplier, src.to_multiplier],
      ['SpinCount',   bo.spin_count,    src.spin_count],
      ['AmtPerLine',  bo.value_per_spin, src.value_per_spin],
    ];
    const fails = checks.filter(([,bv,ev]) => ev != null && Number(bv) !== Number(ev));
    row.l2 = fails.length === 0 ? 'PASS' : 'FAIL';
    for (const [label, bv, ev] of fails) row.issues.push(`${label}: BO=${bv} exp=${ev}`);
  } catch (e) {
    row.l2 = `ERR: ${e.message.split('\n')[0]}`;
  }
  return row;
}

const results = await Promise.all(RECORDS.map(qcOne));

// Group by handle for display
const byHandle = {};
for (const r of results) {
  (byHandle[r.handle] = byHandle[r.handle] || []).push(r);
}

console.log('\n══════════════════════════════════════════════════════════════');
console.log(' QC SUMMARY — P122–P127 across QPRO2/3/4');
console.log('══════════════════════════════════════════════════════════════');
console.log(` ${'Code'.padEnd(34)} ${'Brand'.padEnd(7)} ${'ID'.padEnd(5)} L1     L2     Issues`);
console.log('─'.repeat(90));

let totalPass = 0, totalFail = 0;
for (const [handle, rows] of Object.entries(byHandle)) {
  for (const r of rows) {
    const ok = r.l1 === 'PASS' && r.l2 === 'PASS';
    if (ok) totalPass++; else totalFail++;
    const mark = ok ? '✓' : '✗';
    const issues = r.issues.length ? r.issues.join('; ') : '';
    console.log(` ${mark} ${r.code.padEnd(33)} ${r.brand.padEnd(7)} ${String(r.id).padEnd(5)} ${r.l1.padEnd(6)} ${r.l2.padEnd(6)} ${issues}`);
  }
}
console.log('─'.repeat(90));
console.log(` Total: ${totalPass} PASS, ${totalFail} FAIL`);
