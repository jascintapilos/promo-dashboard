// Probe multiple QPRO BOs for FS MTs with EN (locale 6) or ZH (locale 7) content
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const SITES = ['qpro1','qpro2','qpro3','qpro4','qpro5','qpro6','qpro7','qpro8'];

for (const siteId of SITES) {
  try {
    const site = getSite(siteId);
    const res = await authedFetch(site, '/api/bo/messagetemplate?limit=200');
    const rows = res.data?.rows || [];
    // FS MTs: name/code contains spin/fs, locale 6 or 7
    const fsMts = rows.filter(r =>
      /spin|free.?spin|\bfs\b/i.test(r.name || r.code || '') &&
      (r.settings_locale_id == 6 || r.settings_locale_id == 7)
    );
    if (!fsMts.length) { console.log(`${siteId}: no EN/ZH FS MTs`); continue; }
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${siteId}: ${fsMts.length} EN/ZH FS MT row(s)`);
    // Show up to 2 samples
    for (const r of fsMts.slice(0, 2)) {
      console.log(`\n--- ${siteId} id=${r.id} locale=${r.settings_locale_id} code=${r.code} ---`);
      console.log(r.message || '(empty)');
    }
  } catch (e) {
    console.log(`${siteId}: ERROR — ${e.message.split('\n')[0]}`);
  }
}
