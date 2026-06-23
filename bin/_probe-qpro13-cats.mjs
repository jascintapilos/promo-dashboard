import { authedFetch } from '../src/api-client.js';
const r = await authedFetch('qpro13', '/api/bo/categories');
const rows = r?.data?.rows || r?.data || [];
const arr = Array.isArray(rows) ? rows : Object.values(rows);
console.log('QPRO13 categories:');
arr.forEach(c => console.log(`  id=${c.id}  name="${c.name}"  code="${c.code}"`));

// Also check one promo's promotion_category detail structure
const pr = await authedFetch('qpro13', '/api/bo/promotion?status=1&perPage=5&page=1');
const first = (pr?.data?.rows || [])[0];
if (first) {
  const det = await authedFetch('qpro13', `/api/bo/promotion/${first.id}`);
  const main = det?.data?.rows?.main || det?.data?.rows;
  console.log('\nFirst promo promotion_category sample:');
  console.log(JSON.stringify(main?.promotion_category?.slice(0,3), null, 2));
  console.log('blacklist_id:', main?.blacklist_id);
}
