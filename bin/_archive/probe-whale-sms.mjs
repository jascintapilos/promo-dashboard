import { authedFetch } from '../../src/api-client.js';
import { getSite } from '../../src/sites.js';

const site = getSite('ibc22');

const CODES = [
  'WHALE_CRM_PROBE_88PCT_100_FTD_LOSE_2',
  'WHALE_CRM_PROBE_88PCT_150_FTD_LOSE_2',
  'WHALE_CRM_PROBE_88PCT_200_FTD_LOSE_2',
  'WHALE_CRM_PROBE_88PCT_300_FTD_LOSE_2',
  'WHALE_VM_PROBE_NODEP_FC88_20X',
  'WHALE_VM_PROBE_NODEP_FC118_20X',
  'WHALE_VM_PROBE_NODEP_FC138_20X',
  'WHALE_VM_PROBE_NODEP_FC148_20X',
  'WHALE_CRM_PROBE_20PCT_100_FTD_LOSE_4',
  'WHALE_CRM_PROBE_20PCT_150_FTD_LOSE_4',
  'WHALE_CRM_PROBE_20PCT_200_FTD_LOSE_4',
  'WHALE_CRM_PROBE_20PCT_300_FTD_LOSE_4',
  'WHALE_CRM_PROBE_20PCT_100_FTD_WIN_2',
  'WHALE_CRM_PROBE_20PCT_200_FTD_WIN_2',
  'WHALE_CRM_PROBE_20PCT_300_FTD_WIN_2',
  'WHALE_CRM_PROBE_88PCT_100_FTD_WIN_3',
  'WHALE_CRM_PROBE_88PCT_200_FTD_WIN_3',
  'WHALE_CRM_PROBE_88PCT_300_FTD_WIN_3',
  'WHALE_CRM_PROBE_20PCT_100_FTD_WIN_4',
  'WHALE_CRM_PROBE_20PCT_200_FTD_WIN_4',
  'WHALE_CRM_PROBE_20PCT_300_FTD_WIN_4',
  // 30% LOSE_3 and DEP variants
  'WHALE_CRM_PROBE_DEP_30PCT_88_FTD_LOSE_3',
  'WHALE_CRM_PROBE_DEP_30PCT_118_FTD_LOSE_3',
  'WHALE_CRM_PROBE_DEP_30PCT_138_FTD_LOSE_3',
  'WHALE_CRM_PROBE_DEP_30PCT_148_FTD_LOSE_3',
];

// Fetch message templates — try without section filter, large page
const resp = await authedFetch(site, `/api/bo/messagetemplate?perPage=500&page=1`);
const rows = resp?.data?.rows || [];
console.log(`Total templates fetched: ${rows.length}`);

// Find any that mention WHALE
const whaleRows = rows.filter(r =>
  (r.name || '').toUpperCase().includes('WHALE') ||
  (r.code || '').toUpperCase().includes('WHALE')
);
console.log(`Templates with WHALE in name/code: ${whaleRows.length}`);

// Build set of SMS template IDs (section determines type in QP2)
const sections = [...new Set(whaleRows.map(r => r.section))];
console.log(`Sections found: ${sections.join(', ')}`);

// Group by section
const bySec = {};
for (const r of whaleRows) {
  (bySec[r.section] = bySec[r.section] || []).push(r);
}
for (const [sec, items] of Object.entries(bySec)) {
  console.log(`\nSection ${sec} (${items.length} templates):`);
  for (const r of items) {
    console.log(`  id=${r.id}  name="${r.name}"`);
  }
}

// Now check current message_template_sms_id for each promo
console.log('\n── Per-promo SMS MT status ──');
for (const code of CODES) {
  const listResp = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(code)}&perPage=10`);
  const listRow = (listResp?.data?.rows || [])[0];
  if (!listRow) { console.log(`  ${code}: NOT FOUND`); continue; }
  const det = (await authedFetch(site, `/api/bo/promotion/${listRow.id}`)).data.rows;
  const smsId = det.message_template_sms_id || 0;
  const mtId  = det.message_template_id || 0;
  console.log(`  ${code}: mt=${mtId}  sms_mt=${smsId || '(none)'}`);
}
