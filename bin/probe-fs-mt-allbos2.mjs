// Broader probe — all QPRO BOs, any FS MT regardless of locale
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const SITES = ['qpro1','qpro2','qpro3','qpro4','qpro5','qpro6','qpro7','qpro8',
               'qpro9','qpro10','qpro11','qpro12','qpro13','qpro14','qpro15',
               'qpro16','qpro17'];

for (const siteId of SITES) {
  try {
    const site = getSite(siteId);
    const res = await authedFetch(site, '/api/bo/messagetemplate?limit=200');
    const rows = res.data?.rows || [];
    const fsMts = rows.filter(r => /spin|free.?spin|\bfs\b/i.test(r.name || r.code || ''));
    if (!fsMts.length) continue;
    // Group by id, show locales available
    const byId = {};
    for (const r of fsMts) (byId[r.id] = byId[r.id] || []).push(r.settings_locale_id);
    const summary = Object.entries(byId).map(([id, locs]) => `MT${id}[locales:${locs.join(',')}]`).join('  ');
    console.log(`${siteId}: ${summary}`);
  } catch (e) {
    console.log(`${siteId}: ERROR — ${e.message.split('\n')[0]}`);
  }
}
