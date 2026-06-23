#!/usr/bin/env node
// QC MT + Dialog linkage for P122-P127 across QPRO2/3/4.
// All 6 promos have inbox_message=false + popup_dialog=false — expect MT=0, dialog=[].
import { findPromotionByCode } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const RECORDS = [
  { p: 'P122', code: 'WELC_BASE_80FS_GOOSS_20X',       brand: 'QPRO2', siteId: 'qpro2' },
  { p: 'P122', code: 'WELC_BASE_80FS_GOOSS_20X',       brand: 'QPRO3', siteId: 'qpro3' },
  { p: 'P122', code: 'WELC_BASE_80FS_GOOSS_20X',       brand: 'QPRO4', siteId: 'qpro4' },
  { p: 'P123', code: 'WELC_BOOSTER_100FS_GOOSS_25X',   brand: 'QPRO2', siteId: 'qpro2' },
  { p: 'P123', code: 'WELC_BOOSTER_100FS_GOOSS_25X',   brand: 'QPRO3', siteId: 'qpro3' },
  { p: 'P123', code: 'WELC_BOOSTER_100FS_GOOSS_25X',   brand: 'QPRO4', siteId: 'qpro4' },
  { p: 'P124', code: 'REL_BASE_60FS_GOOSS_12X_V2',     brand: 'QPRO2', siteId: 'qpro2' },
  { p: 'P124', code: 'REL_BASE_60FS_GOOSS_12X_V2',     brand: 'QPRO3', siteId: 'qpro3' },
  { p: 'P124', code: 'REL_BASE_60FS_GOOSS_12X_V2',     brand: 'QPRO4', siteId: 'qpro4' },
  { p: 'P125', code: 'REL_BOOSTER_80FS_GOOSS_15X',     brand: 'QPRO2', siteId: 'qpro2' },
  { p: 'P125', code: 'REL_BOOSTER_80FS_GOOSS_15X',     brand: 'QPRO3', siteId: 'qpro3' },
  { p: 'P125', code: 'REL_BOOSTER_80FS_GOOSS_15X',     brand: 'QPRO4', siteId: 'qpro4' },
  { p: 'P126', code: 'RET_GOOSS_BASE_50FS_10X',        brand: 'QPRO2', siteId: 'qpro2' },
  { p: 'P126', code: 'RET_GOOSS_BASE_50FS_10X',        brand: 'QPRO3', siteId: 'qpro3' },
  { p: 'P126', code: 'RET_GOOSS_BASE_50FS_10X',        brand: 'QPRO4', siteId: 'qpro4' },
  { p: 'P127', code: 'RET_GOOSS_BOOST_60FS_12X',       brand: 'QPRO2', siteId: 'qpro2' },
  { p: 'P127', code: 'RET_GOOSS_BOOST_60FS_12X',       brand: 'QPRO3', siteId: 'qpro3' },
  { p: 'P127', code: 'RET_GOOSS_BOOST_60FS_12X',       brand: 'QPRO4', siteId: 'qpro4' },
];

async function qcOne(r) {
  const site = getSite(r.siteId);
  const row = await findPromotionByCode(site, r.code);
  if (!row) return { ...r, mt: 'NOT FOUND', dialog: 'NOT FOUND', ok: false };
  const mt = row.message_template_id || 0;
  const dialogs = row.dialog_popup_list || [];
  const mtOk = mt === 0;
  const dialogOk = dialogs.length === 0;
  return { ...r, mt, dialogs: dialogs.length, mtOk, dialogOk, ok: mtOk && dialogOk };
}

const results = await Promise.all(RECORDS.map(qcOne));

console.log('\n══════════════════════════════════════════════════════════════');
console.log(' MT + DIALOG QC — P122–P127 across QPRO2/3/4');
console.log('══════════════════════════════════════════════════════════════');
console.log(` ${'Code'.padEnd(34)} ${'Brand'.padEnd(7)} ${'MT id'.padEnd(8)} ${'Dialogs'.padEnd(9)} Result`);
console.log('─'.repeat(80));

let pass = 0, fail = 0;
for (const r of results) {
  const mark = r.ok ? '✓' : '✗';
  if (r.ok) pass++; else fail++;
  const issues = [];
  if (!r.mtOk) issues.push(`MT=${r.mt} (exp 0)`);
  if (!r.dialogOk) issues.push(`${r.dialogs} dialog(s) linked`);
  console.log(` ${mark} ${r.code.padEnd(33)} ${r.brand.padEnd(7)} ${String(r.mt).padEnd(8)} ${String(r.dialogs ?? '-').padEnd(9)} ${issues.join('; ') || 'PASS'}`);
}
console.log('─'.repeat(80));
console.log(` Total: ${pass} PASS, ${fail} FAIL`);
