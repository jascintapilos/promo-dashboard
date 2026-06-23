// QC: verify MT creation + linkage for P122 on QPRO2/3/4
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const PROMO_CODE = 'WELC_BASE_80FS_GOOSS_20X';
const EXPECTED_MT_IDS = { qpro2: 422, qpro3: 491, qpro4: 423 };

for (const [siteId, expectedMtId] of Object.entries(EXPECTED_MT_IDS)) {
  console.log(`\n=== ${siteId} ===`);
  const site = getSite(siteId);

  // L1: promo list — check message_template_id
  const listRes = await authedFetch(site, `/api/bo/promotion?code=${PROMO_CODE}&status=1`);
  const rows = listRes?.data?.rows;
  const promoRow = Array.isArray(rows) ? rows.find(r => r.code === PROMO_CODE) : null;
  if (!promoRow) { console.log('  ✗ promo not found'); continue; }
  const mtLinked = promoRow.message_template_id;
  console.log(`  promo id=${promoRow.id}  message_template_id=${mtLinked}  ${mtLinked === expectedMtId ? '✓' : `✗ expected ${expectedMtId}`}`);

  // L2: MT list — verify locales + content
  const mtRes = await authedFetch(site, `/api/bo/messagetemplate?limit=500`);
  const mtRows = (mtRes?.data?.rows || []).filter(r => r.id === expectedMtId);
  const locales = mtRows.map(r => r.settings_locale_id).sort((a,b) => a-b);
  console.log(`  MT rows: ${mtRows.length}  locales: [${locales.join(', ')}]  ${locales.join(',') === '6,7' ? '✓' : '✗ expected 6,7'}`);

  for (const row of mtRows) {
    const subj = row.name || '?';
    const msgLen = (row.message || '').length;
    console.log(`    locale=${row.settings_locale_id}  name="${row.name}"  msg_len=${msgLen}`);
    // Check :brandname placeholder present
    const hasBrandname = (row.message || '').includes(':brandname');
    console.log(`    :brandname present: ${hasBrandname ? '✓' : '✗'}`);
  }
}
console.log('\nDone.');
