#!/usr/bin/env node
// Check what mtId FT_REL_TLEO_LC_20PCT_300MX_BR has on qpro2, and what template says now
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('qpro2');
const res = await authedFetch(site, '/api/bo/promotion?code=FT_REL_TLEO_20PCT_300MX_BR&perPage=100&page=1');
for (const p of res.data?.rows || []) {
  console.log(`code=${p.code}  pid=${p.id}  mtId=${p.message_template_id}`);
}
const res2 = await authedFetch(site, '/api/bo/promotion?code=FT_REL_TLEO_LC_20PCT_300MX_BR&perPage=100&page=1');
for (const p of res2.data?.rows || []) {
  console.log(`code=${p.code}  pid=${p.id}  mtId=${p.message_template_id}`);
  if (p.message_template_id) {
    const mt = await authedFetch(site, `/api/bo/messagetemplate/${p.message_template_id}`);
    const en1 = mt.data?.message_details?.['1'];
    const m = en1?.message?.match(/<li>([\s\S]*?)<\/li>/g)?.filter(li =>
      li.toLowerCase().includes('categor') || li.includes('game') || li.includes('eligible')
    );
    console.log('  Category-related <li> items in locale 1:');
    for (const li of m || []) {
      console.log('   ', li.replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').trim());
    }
  }
}
