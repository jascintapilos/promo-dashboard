/** Probe GetFreeSpinPromotionInfo detail path */
import { igmpPost } from '../src/igmp-client.js';
const SITE = 'ws1-v3-my';

const r = await igmpPost(SITE, `/PM/GetPromotionsList?pageNum=1&rowPerPage=200`,
  { PromotionCode: '', PromotionName: '', PromotionType: 11, IsActive: '', IsPublished: '' });
const rows = (r?.data || []).filter(p => p.IsActive && !/^TEST_/i.test(p.PromotionCode));
console.log(`FS active non-test promos: ${rows.length}`);
const sample = rows[0];
if (sample) {
  console.log(`Sample: ${sample.PromotionCode} (${sample.PromotionId}) type=${sample.PromotionType}`);
  const d = await igmpPost(SITE, '/PM/GetFreeSpinPromotionInfo', { PromotionId: sample.PromotionId });
  console.log('d.data keys:', Object.keys(d?.data || {}));
  const pr = d?.data?.Promotion || {};
  console.log('Promotion keys:', Object.keys(pr).slice(0, 15));
  console.log('LogTimeStamp:', pr.LogTimeStamp);
  console.log('CreatedBy:', JSON.stringify(pr.CreatedBy)?.slice(0, 100));
}
// Total FS count
let total = 0;
for (let pg = 1; pg <= 10; pg++) {
  const rp = await igmpPost(SITE, `/PM/GetPromotionsList?pageNum=${pg}&rowPerPage=200`,
    { PromotionCode: '', PromotionName: '', PromotionType: 11, IsActive: '', IsPublished: '' });
  const prows = rp?.data || [];
  total += prows.length;
  if (prows.length < 200) { console.log(`\nTotal FS (WS1 MY): ${total}`); break; }
}
