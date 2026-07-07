// Ad-hoc probe: FT_REL_30PCT_8X — inbox MT content + blacklist template, all BOs.
// Read-only. Saves full dump to captures/probe-ft-rel-30pct-8x.json

import { authedFetch } from '../src/api-client.js';
import { writeFile } from 'node:fs/promises';

const CODE = 'FT_REL_30PCT_8X';
const SITES = [
  { site: 'ibc22',  platform: 'qp2'  },
  { site: 'qpro3',  platform: 'qpro' },
  { site: 'qpro4',  platform: 'qpro' },
  { site: 'qpro5',  platform: 'qpro' },
  { site: 'qpro7',  platform: 'qpro' },
  { site: 'qpro10', platform: 'qpro' },
  { site: 'qpro15', platform: 'qpro' },
  { site: 'qpro16', platform: 'qpro' },
];

const out = {};

for (const { site, platform } of SITES) {
  const rec = { platform };
  out[site] = rec;
  try {
    const r = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(CODE)}&perPage=10`);
    const rows = r?.data?.rows || [];
    const promo = rows.find((p) => p.code === CODE);
    if (!promo) { rec.error = 'code not found in listing'; console.log(`${site}: NOT FOUND`); continue; }
    rec.promo = promo;
    console.log(`\n━━━ ${site} ━━━ id=${promo.id} status=${promo.status} mt=${promo.message_template_id} blacklist=${promo.blacklist_template_id}`);
    console.log(`  name="${promo.name}"`);

    if (promo.message_template_id) {
      try {
        const mt = await authedFetch(site, `/api/bo/messagetemplate/${promo.message_template_id}`);
        rec.messageTemplate = mt?.data?.rows || mt?.data;
        const details = rec.messageTemplate?.message_details || {};
        for (const [lid, d] of Object.entries(details)) {
          console.log(`  MT locale ${lid} (${d.settings_locales_code}): title="${d.title}" bodyLen=${(d.message || '').length}`);
        }
      } catch (e) { rec.mtError = e.message; console.log(`  MT fetch ERROR: ${e.message.split('\n')[0]}`); }
    } else {
      console.log('  NO message_template_id on promo');
    }

    try {
      const path = platform === 'qp2'
        ? '/api/bo/gameprovider/getAllBlacklistTemplate'
        : '/api/bo/blacklist?perPage=200&page=1';
      const bl = await authedFetch(site, path);
      const blRows = bl?.data?.rows || bl?.data || [];
      rec.blacklistCatalog = (Array.isArray(blRows) ? blRows : []).map((t) => ({ id: t.id, name: t.name, status: t.status }));
      const assigned = rec.blacklistCatalog.find((t) => t.id === promo.blacklist_template_id);
      console.log(`  blacklist_template_id=${promo.blacklist_template_id} → ${assigned ? `"${assigned.name}"` : 'NOT IN CATALOG'}`);
    } catch (e) { rec.blError = e.message; console.log(`  blacklist fetch ERROR: ${e.message.split('\n')[0]}`); }
  } catch (e) {
    rec.error = e.message;
    console.log(`${site}: ERROR — ${e.message.split('\n')[0]}`);
  }
}

await writeFile('captures/probe-ft-rel-30pct-8x.json', JSON.stringify(out, null, 2));
console.log('\nSaved → captures/probe-ft-rel-30pct-8x.json');
