/**
 * Probe: what PromotionTypes does GetPromotionsList return for WS1 MY?
 * Also fetch detail for a sample FC promo to check LogTimeStamp path.
 */
import { igmpPost } from '../src/igmp-client.js';

const SITE = 'ws1-v3-my';
const all = [];
for (let pg = 1; pg <= 10; pg++) {
  const r = await igmpPost(SITE, `/PM/GetPromotionsList?pageNum=${pg}&rowPerPage=200`,
    { PromotionCode: '', PromotionName: '', PromotionType: 0, IsActive: '', IsPublished: '' });
  const rows = r?.data || [];
  if (!rows.length) break;
  all.push(...rows);
  if (rows.length < 200) break;
}

// Tally by type
const byType = {};
for (const p of all) {
  const t = p.PromotionType || '(null)';
  byType[t] = (byType[t] || 0) + 1;
}
console.log(`\nTotal promos on GetPromotionsList (WS1 MY): ${all.length}`);
console.log('By PromotionType:');
for (const [t, n] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${t}`);
}

// Sample one FC promo and check the detail structure
const sample = all.find(p => p.PromotionType === 'FreeCredit');
if (sample) {
  console.log(`\nSample FC promo: ${sample.PromotionCode} (id ${sample.PromotionId})`);
  const d = await igmpPost(SITE, '/PM/GetFreeCreditInfo', { PromotionId: sample.PromotionId });
  const pr = d?.data?.Promotion || {};
  console.log('  d.data keys:', Object.keys(d?.data || {}));
  console.log('  Promotion keys:', Object.keys(pr));
  console.log('  LogTimeStamp:', pr.LogTimeStamp);
  console.log('  CreatedBy:', JSON.stringify(pr.CreatedBy));
} else {
  console.log('\nNo FreeCredit promos found in GetPromotionsList.');
}

// Sample one FS promo if any
const sampleFs = all.find(p => p.PromotionType === 'FreeSpin');
if (sampleFs) {
  console.log(`\nSample FS promo: ${sampleFs.PromotionCode} (id ${sampleFs.PromotionId})`);
  const d = await igmpPost(SITE, '/PM/GetFreeSpinPromotionInfo', { PromotionId: sampleFs.PromotionId });
  const pr = d?.data?.Promotion || {};
  console.log('  d.data keys:', Object.keys(d?.data || {}));
  console.log('  Promotion keys:', Object.keys(pr));
  console.log('  LogTimeStamp:', pr.LogTimeStamp);
  console.log('  CreatedBy:', JSON.stringify(pr.CreatedBy));
} else {
  console.log('\nNo FreeSpin promos found in GetPromotionsList.');
  // Try listing with PromotionType=3 or specific type
  console.log('\nProbing GetPromotionsList with PromotionType=3 (FS) ...');
  const r = await igmpPost(SITE, `/PM/GetPromotionsList?pageNum=1&rowPerPage=200`,
    { PromotionCode: '', PromotionName: '', PromotionType: 3, IsActive: '', IsPublished: '' });
  console.log('  rows:', (r?.data || []).length);
  const first = (r?.data || [])[0];
  if (first) console.log('  sample type:', first.PromotionType);
}
