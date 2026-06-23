/**
 * Probe: find FreeSpin type number, paginate FC, and check detail paths.
 */
import { igmpPost } from '../src/igmp-client.js';

const SITE = 'ws1-v3-my';

// 1. Find FreeSpin PromotionType value (try 7-15)
console.log('--- Hunting FreeSpin PromotionType ---');
for (const t of [7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const r = await igmpPost(SITE, `/PM/GetPromotionsList?pageNum=1&rowPerPage=5`,
    { PromotionCode: '', PromotionName: '', PromotionType: t, IsActive: '', IsPublished: '' });
  const rows = r?.data || [];
  if (rows.length) console.log(`  PromotionType=${t}: ${rows.length} rows, sample type=${rows[0]?.PromotionType}`);
}

// 2. Paginate FC to find total count
console.log('\n--- FreeCredit total (PromotionType=4) ---');
let fcTotal = 0;
for (let pg = 1; pg <= 10; pg++) {
  const r = await igmpPost(SITE, `/PM/GetPromotionsList?pageNum=${pg}&rowPerPage=200`,
    { PromotionCode: '', PromotionName: '', PromotionType: 4, IsActive: '', IsPublished: '' });
  const rows = r?.data || [];
  fcTotal += rows.length;
  if (rows.length < 200) { console.log(`  page ${pg}: ${rows.length} rows (done, total ${fcTotal})`); break; }
  else console.log(`  page ${pg}: ${rows.length} rows`);
}

// 3. Check FC detail path (LogTimeStamp location)
console.log('\n--- FC detail path check ---');
const r4 = await igmpPost(SITE, `/PM/GetPromotionsList?pageNum=1&rowPerPage=200`,
  { PromotionCode: '', PromotionName: '', PromotionType: 4, IsActive: '', IsPublished: '' });
const fcPromos = (r4?.data || []).filter(p => p.IsActive && !/^TEST_/i.test(p.PromotionCode));
const sample = fcPromos[0];
if (sample) {
  console.log(`  Sample FC: ${sample.PromotionCode} (${sample.PromotionId})`);
  const d = await igmpPost(SITE, '/PM/GetFreeCreditInfo', { PromotionId: sample.PromotionId });
  console.log('  Top-level keys:', Object.keys(d || {}));
  console.log('  d.data keys:', Object.keys(d?.data || {}));
  const pr = d?.data?.Promotion || {};
  console.log('  Promotion keys (first 15):', Object.keys(pr).slice(0, 15));
  console.log('  LogTimeStamp:', pr.LogTimeStamp);
  console.log('  CreatedBy:', JSON.stringify(pr.CreatedBy)?.slice(0, 120));
  // Check if maybe it's at d.data directly
  console.log('  d.data.LogTimeStamp:', d?.data?.LogTimeStamp);
  console.log('  d.data.CreatedBy:', JSON.stringify(d?.data?.CreatedBy)?.slice(0, 80));
}
