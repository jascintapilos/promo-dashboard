// READ-ONLY probe: find message template(s) for REL_79FS_GOO_100425 on ibc22.
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('ibc22');
const NEEDLE = 'REL_79FS_GOO_100425';

let page = 1, lastPage = 1;
const hits = [];
do {
  const res = await authedFetch(site, `/api/bo/messagetemplate?perPage=200&page=${page}`);
  const rows = res?.data?.rows || [];
  lastPage = res?.data?.paginations?.last_page || 1;
  for (const r of rows) {
    const hay = `${r.code || ''} ${r.name || ''}`;
    if (hay.includes(NEEDLE) || /79FS_GOO/i.test(hay)) hits.push(r);
  }
  page++;
} while (page <= lastPage);

console.log(`\nMatched ${hits.length} template row(s):`);
for (const r of hits) {
  console.log(`  id=${r.id}  type=${r.type}  section=${r.section}  status=${r.status}  code=${r.code}`);
  console.log(`      name=${r.name}`);
}

// Pull detail for each matched template id (unique ids)
const ids = [...new Set(hits.map(r => r.id))];
for (const id of ids) {
  const det = await authedFetch(site, `/api/bo/messagetemplate/${id}?edit=1`);
  const mt = det?.data?.message_template;
  const md = det?.data?.message_details || {};
  console.log(`\n${'='.repeat(70)}`);
  console.log(`TEMPLATE id=${id} code=${mt?.code} type=${mt?.type} section=${mt?.section} status=${mt?.status}`);
  console.log(`name=${mt?.name}`);
  for (const [locId, e] of Object.entries(md)) {
    console.log(`\n--- locale_id=${locId} (${e.settings_locales_code || ''}) subject="${e.subject || ''}" ---`);
    console.log(e.message || '(empty)');
  }
}
