import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
const site = getSite('ibc22');
const det = await authedFetch(site, `/api/bo/promotion/360`);
const p = det?.data?.rows || det?.data;
console.log('currencies_ids:', JSON.stringify(p.currencies_ids));

const paths = [
  `/api/bo/promotioncurrency?promotion_id=360`,
  `/api/bo/promotioncurrency?promotion_id=360&perPage=50`,
  `/api/bo/promotion/360/currency`,
  `/api/bo/promotionfreespin?promotion_id=360`,
  `/api/bo/promotion/360/freespin`,
  `/api/bo/promotioncurrency?promotionId=360`,
];
for (const path of paths) {
  try {
    const r = await authedFetch(site, path);
    const rows = r?.data?.rows || r?.data;
    console.log(`\nOK ${path}`);
    console.log(JSON.stringify(rows, null, 2).slice(0, 2500));
  } catch (e) {
    console.log(`\nERR ${path} -> ${e.message.split('\n')[1]?.trim() || e.message.split('\n')[0]}`);
  }
}
