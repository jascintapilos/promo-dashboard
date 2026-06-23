import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
const site = getSite('qpro2');

// Fetch all locales for MT 397 (TEST_22FS_GOO_20X)
const res = await authedFetch(site, '/api/bo/messagetemplate?limit=200');
const all = res.data?.rows || [];
const mt397 = all.filter(r => r.id == 397);
console.log(`MT 397 locales: ${mt397.map(r=>r.settings_locale_id)}`);
for (const r of mt397) {
  console.log(`\n=== locale ${r.settings_locale_id} name=${r.name} ===`);
  console.log(r.message);
}
