#!/usr/bin/env node
// Diff qpro15 FC228 blacklist_sub_categories vs qpro2 source
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
const code = 'FT_TLEO_FC228_10X';
for (const b of ['qpro2','qpro15']) {
  const s = getSite(b);
  const lr = await authedFetch(s, `/api/bo/promotion?code=${code}&perPage=5`);
  const lp = Object.values(lr.data?.rows || {}).find(p => p.code === code);
  const d = (await authedFetch(s, `/api/bo/promotion/${lp.id}`)).data?.rows;
  const subs = d.blacklist_sub_categories || [];
  console.log(`${b} (${subs.length}):`);
  for (const e of subs) console.log(`  ${e.game_provider_code} (${e.game_provider_id}) → ${Array.isArray(e.sub_category_name)?e.sub_category_name.join(','):e.sub_category_name}`);
}
