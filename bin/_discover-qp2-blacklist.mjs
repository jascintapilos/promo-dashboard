// Discover the QP2 blacklist-template LISTING endpoint without a browser.
// 1) Pull the SPA bundles from the BO origin and grep for "blacklist".
// 2) Try extra endpoint shapes via authedFetch.
// 3) Inspect a QP2 promo that carries blacklist_template_id to see what's embedded.

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('ibc22');
const origin = site.baseUrl; // https://ibc22.qtp777.com

// ── 1. Grep SPA bundles for "blacklist" ───────────────────────────────────
console.log('=== 1. SPA bundle scan for "blacklist" ===');
try {
  const idx = await fetch(origin, { headers: { accept: 'text/html' } });
  const html = await idx.text();
  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  // also catch modulepreload / link rel
  const links = [...html.matchAll(/<link[^>]+href="([^"]+\.js)"/g)].map((m) => m[1]);
  const all = [...new Set([...srcs, ...links])].map((s) => (s.startsWith('http') ? s : `${origin}${s.startsWith('/') ? '' : '/'}${s}`));
  console.log(`  index.html → ${all.length} script bundles`);
  const hits = [];
  for (const url of all) {
    try {
      const r = await fetch(url);
      const js = await r.text();
      // find every occurrence of "blacklist" and print a window of context
      const re = /.{40}blacklist.{60}/gi;
      let m;
      while ((m = re.exec(js)) !== null) {
        const ctx = m[0].replace(/\s+/g, ' ');
        // keep only ones that look like a path/route
        if (/bo\/|api\/|\/blacklist|blacklist[\/?]/i.test(ctx)) hits.push(ctx);
      }
    } catch (e) { /* skip bundle */ }
  }
  const uniq = [...new Set(hits)];
  if (uniq.length) {
    console.log(`  ${uniq.length} unique "blacklist" path-ish contexts:`);
    uniq.slice(0, 40).forEach((h) => console.log(`    … ${h} …`));
  } else {
    console.log('  no path-like "blacklist" strings found in bundles');
  }
} catch (e) {
  console.log('  bundle scan ERROR:', e.message.split('\n')[0]);
}

// ── 2. Extra endpoint shapes ───────────────────────────────────────────────
console.log('\n=== 2. Extra endpoint shapes ===');
const extra = [
  '/api/bo/blacklist',
  '/api/bo/blacklist?paginate=false',
  '/api/bo/blacklist/list',
  '/api/bo/blacklisttemplate',
  '/api/bo/blacklist_templates',
  '/api/bo/promotion/blacklist',
  '/api/bo/promotionblacklisttemplate',
  '/api/bo/gameprovider/blacklist',
  '/api/bo/blacklistgroup?perPage=200&page=1',
  '/api/bo/blacklistsetting?perPage=200&page=1',
];
for (const ep of extra) {
  try {
    const r = await authedFetch(site, ep);
    const rows = r?.data?.rows || r?.data || r;
    const n = Array.isArray(rows) ? rows.length : (rows && typeof rows === 'object' ? Object.keys(rows).length : 0);
    console.log(`  ${ep}  → OK (rows/keys=${n})  sample=${JSON.stringify(rows).slice(0, 120)}`);
  } catch (e) {
    console.log(`  ${ep}  → ${e.message.split('\n')[0].replace(/^HTTP /, '')}`);
  }
}

// ── 3. Inspect a QP2 promo that carries a blacklist id ─────────────────────
console.log('\n=== 3. QP2 promo blacklist embedding ===');
try {
  // Pull recent promos, find ones with a blacklist id set on the detail.
  const list = await authedFetch(site, '/api/bo/promotion?perPage=40&page=1&sort_by=id&sort_order=desc');
  const rows = list?.data?.rows || [];
  console.log(`  scanning ${rows.length} recent promos for blacklist field…`);
  let found = 0;
  for (const p of rows) {
    if (found >= 5) break;
    try {
      const d = await authedFetch(site, `/api/bo/promotion/${p.id}`);
      const m = d?.data?.rows;
      const bid = m?.blacklist_template_id ?? m?.blacklist_id;
      if (bid != null) {
        found++;
        console.log(`  pid=${p.id} code=${p.code}  blacklist_template_id=${m?.blacklist_template_id ?? '∅'} blacklist_id=${m?.blacklist_id ?? '∅'}`);
        const blKeys = Object.keys(m).filter((k) => /black/i.test(k));
        console.log(`     black* keys on detail: ${JSON.stringify(blKeys)}`);
        for (const k of blKeys) if (k !== 'blacklist_template_id' && k !== 'blacklist_id') console.log(`       ${k} = ${JSON.stringify(m[k]).slice(0, 200)}`);
      }
    } catch (e) { /* skip */ }
  }
  if (!found) console.log('  no promo in the recent page carried a blacklist id');
} catch (e) {
  console.log('  promo scan ERROR:', e.message.split('\n')[0]);
}
