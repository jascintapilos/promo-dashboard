// Get FS MT content from QPRO2 — fetch MT detail for FS promos
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('qpro2');

// List all MTs, find one with FS-related name/code
const res = await authedFetch(site, '/api/bo/messagetemplate?limit=200');
const rows = res.data?.rows || [];
const fsMts = rows.filter(r => /spin|free.?spin|fs/i.test(r.name || r.code || ''));
console.log(`FS-related MTs: ${fsMts.length}`);
for (const r of fsMts.slice(0, 3)) {
  console.log(`\n=== MT id=${r.id} code=${r.code} name=${r.name} locale=${r.settings_locale_id} ===`);
  console.log('message:', (r.message || '').slice(0, 500));
}
