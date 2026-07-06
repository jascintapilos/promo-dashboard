import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('qpro4');
const det = await authedFetch(site, '/api/bo/promotion/474').then(r => r?.data?.rows);
// Print all fields that contain "category" or "turnover"
for (const [k,v] of Object.entries(det||{})) {
  if (/cat|turn/i.test(k)) console.log(k, ':', JSON.stringify(v));
}
console.log('\nAll keys:', Object.keys(det||{}).join(', '));
