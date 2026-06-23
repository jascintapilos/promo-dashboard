import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('qpro5');

// Test PUT with exactly ONE sub-cat ID (441, from Slots Only)
const body = { name: 'Live Casino and Slot', remarks: '', status: 1, sub_categories: { '1': [441] } };
const r = await authedFetch(site, '/api/bo/blacklist/9', { method: 'PUT', body });
console.log('PUT response:', JSON.stringify(r));

// Check from LIST (which does show settings)
const list = await authedFetch(site, '/api/bo/blacklist?perPage=200');
const t9 = (list?.data?.rows || []).find(x => x.id === 9);
console.log('\nTemplate 9 from LIST:');
console.log('settings count:', (t9?.settings||[]).length);
console.log('settings:', JSON.stringify(t9?.settings));
console.log('updated_at:', t9?.updated_at);
