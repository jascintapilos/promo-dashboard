/**
 * Probe: find the list endpoints for FC and FS promos on WS1 IGMP.
 * Try known patterns and PromotionType filter values.
 */
import { igmpPost } from '../src/igmp-client.js';

const SITE = 'ws1-v3-my';

// 1. Try PromotionType filter values 1-6 on GetPromotionsList
console.log('--- GetPromotionsList with different PromotionType values ---');
for (const t of [1, 2, 3, 4, 5, 6]) {
  const r = await igmpPost(SITE, `/PM/GetPromotionsList?pageNum=1&rowPerPage=200`,
    { PromotionCode: '', PromotionName: '', PromotionType: t, IsActive: '', IsPublished: '' });
  const rows = r?.data || [];
  if (rows.length) console.log(`  PromotionType=${t}: ${rows.length} rows, sample type=${rows[0]?.PromotionType}`);
  else console.log(`  PromotionType=${t}: 0 rows`);
}

// 2. Try likely FC list endpoints
console.log('\n--- Candidate FC list endpoints ---');
for (const ep of [
  '/PM/GetFreeCreditList',
  '/PM/GetFCPromotionList',
  '/PM/GetFreeCreditPromotionList',
  '/PM/GetFreeCreditListByMerchant',
]) {
  try {
    const r = await igmpPost(SITE, `${ep}?pageNum=1&rowPerPage=50`, {});
    const rows = r?.data || (Array.isArray(r?.data) ? r.data : null);
    if (r && !r.error) {
      console.log(`  ${ep}: SUCCESS — keys=${Object.keys(r?.data||r||{}).join(',')}`);
      if (Array.isArray(r?.data)) console.log(`    array len=${r.data.length}, sample=${JSON.stringify(r.data[0]).slice(0,120)}`);
    } else console.log(`  ${ep}: error — ${JSON.stringify(r).slice(0,80)}`);
  } catch (e) { console.log(`  ${ep}: threw — ${e.message.slice(0,60)}`); }
}

// 3. Try likely FS list endpoints
console.log('\n--- Candidate FS list endpoints ---');
for (const ep of [
  '/PM/GetFreeSpinList',
  '/PM/GetFreeSpinPromotionList',
  '/PM/GetFreeSpinCampaignList',
  '/PM/GetFSPromotionList',
]) {
  try {
    const r = await igmpPost(SITE, `${ep}?pageNum=1&rowPerPage=50`, {});
    if (r && !r.error) {
      console.log(`  ${ep}: SUCCESS — keys=${Object.keys(r?.data||r||{}).join(',')}`);
      if (Array.isArray(r?.data)) console.log(`    array len=${r.data.length}`);
    } else console.log(`  ${ep}: error — ${JSON.stringify(r).slice(0,80)}`);
  } catch (e) { console.log(`  ${ep}: threw — ${e.message.slice(0,60)}`); }
}
