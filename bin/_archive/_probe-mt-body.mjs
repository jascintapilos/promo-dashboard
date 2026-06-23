#!/usr/bin/env node
// Compare MY_EN body for FT_REL_TLEO_20PCT_200MX on qpro5 vs qpro3 to see how much differs
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

for (const [brand, mt] of [['qpro5', null], ['qpro3', 419]]) {
  const site = getSite(brand);
  let mtId = mt;
  if (!mtId) {
    const lr = await authedFetch(site, `/api/bo/promotion?code=FT_REL_TLEO_20PCT_200MX&perPage=5`);
    const lp = Object.values(lr.data?.rows || {}).find(p => p.code === 'FT_REL_TLEO_20PCT_200MX');
    mtId = lp?.message_template_id;
  }
  const im = await authedFetch(site, `/api/bo/messagetemplate/${mtId}`);
  console.log(`\n━━━ ${brand} MT=${mtId} ━━━`);
  for (const d of Object.values(im.data?.message_details || {})) {
    const lid = Number(d.settings_locale_id);
    if (lid === 1 || lid === 3) {
      console.log(`\n  locale=${lid} subject="${d.subject}"`);
      console.log(`  message (${(d.message||'').length} chars):`);
      console.log(`  ${(d.message || '').slice(0, 600)}`);
    }
  }
}
