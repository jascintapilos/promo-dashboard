#!/usr/bin/env node
// QC: Verify all TLEO promos on QPRO sites have a dialog_popup_list linked.

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const QPRO_SITES = ['qpro2','qpro3','qpro4','qpro6','qpro8','qpro10'];

let totalOk = 0, totalMissing = 0;
const missing = [];

for (const siteId of QPRO_SITES) {
  const site = getSite(siteId);
  const r = await authedFetch(site, '/api/bo/promotion?code=FT_REL_TLEO&perPage=200&page=1');
  const rows = r.data?.rows || [];
  const tleo = (Array.isArray(rows) ? rows : Object.values(rows)).filter(p => p.code?.includes('TLEO'));

  let siteOk = 0, siteMissing = 0;
  for (const promo of tleo) {
    // dialog_popup_list is only in the LIST endpoint, not the detail GET
    const dpList = promo.dialog_popup_list;
    const hasPopup = Array.isArray(dpList) ? dpList.length > 0
                   : (dpList && typeof dpList === 'object' && Object.keys(dpList).length > 0);
    if (hasPopup) {
      siteOk++;
      totalOk++;
    } else {
      siteMissing++;
      totalMissing++;
      console.log(`  ✗ ${siteId} pid=${promo.id} ${promo.code} — NO dialog popup`);
      missing.push(`${siteId} pid=${promo.id} ${promo.code}`);
    }
  }
  console.log(`${siteId}: ${siteOk}/${tleo.length} have popup  (${siteMissing} missing)`);
}

console.log(`\n=== OVERALL ===`);
console.log(`Total with popup: ${totalOk}  Missing: ${totalMissing}`);
if (totalMissing === 0) {
  console.log('\n✓ All TLEO promos have a dialog popup linked');
} else {
  console.log('\nMissing list:');
  missing.forEach(m => console.log('  ' + m));
}
