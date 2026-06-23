import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('ibc22');
const origin = site.baseUrl;

// ── 1. Wider bundle grep: every http.get/post call + every "blacklist"/"template" near each other
console.log('=== 1. Wider SPA grep (http verbs + blacklist/template) ===');
try {
  const html = await (await fetch(origin)).text();
  const srcs = [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((m) => m[1])
    .map((s) => (s.startsWith('http') ? s : `${origin}${s.startsWith('/') ? '' : '/'}${s}`));
  const calls = new Set();
  for (const url of [...new Set(srcs)]) {
    let js = '';
    try { js = await (await fetch(url)).text(); } catch { continue; }
    // any http.(get|post|put|delete)("/...path...") whose path mentions blacklist
    for (const m of js.matchAll(/\.(get|post|put|delete)\(\s*["'`]([^"'`]*blacklist[^"'`]*)["'`]/gi)) {
      calls.add(`${m[1].toUpperCase()} ${m[2]}`);
    }
    // any string literal containing both "blacklist" and "template"
    for (const m of js.matchAll(/["'`]([^"'`]*blacklist[^"'`]*template[^"'`]*|[^"'`]*template[^"'`]*blacklist[^"'`]*)["'`]/gi)) {
      calls.add(`LIT ${m[1]}`);
    }
    // method names containing Blacklist
    for (const m of js.matchAll(/(\w*[Bb]lacklist\w*)\s*\(/g)) calls.add(`fn ${m[1]}()`);
  }
  [...calls].sort().forEach((c) => console.log('   ', c));
  if (!calls.size) console.log('    (nothing)');
} catch (e) { console.log('  ERROR', e.message.split('\n')[0]); }

// ── 2. /promotion/blacklist variations (GET w/ params, POST)
console.log('\n=== 2. /promotion/blacklist method+param variations ===');
const tries = [
  ['GET', '/api/bo/promotion/blacklist?perPage=200&page=1'],
  ['GET', '/api/bo/promotion/blacklist?merchant_id=1&perPage=200&page=1'],
  ['POST', '/api/bo/promotion/blacklist', {}],
  ['POST', '/api/bo/promotion/blacklist', { perPage: 200, page: 1 }],
  ['POST', '/api/bo/promotion/blacklistgame', { game_provider_id: [], merchant_id: 1 }],
  ['GET', '/api/bo/promotion/blacklisttemplate?perPage=200&page=1'],
  ['GET', '/api/bo/promotiontemplate?perPage=200&page=1'],
];
for (const [method, ep, body] of tries) {
  try {
    const r = await authedFetch(site, ep, body ? { method, body } : { method });
    const rows = r?.data?.rows || r?.data || r;
    const n = Array.isArray(rows) ? rows.length : (rows && typeof rows === 'object' ? Object.keys(rows).length : 0);
    console.log(`  ${method} ${ep}  → OK (n=${n})  ${JSON.stringify(rows).slice(0, 160)}`);
  } catch (e) { console.log(`  ${method} ${ep}  → ${e.message.split('\n')[0].replace(/^HTTP /, '')}`); }
}

// ── 3. Enumerate ALL distinct blacklist_template_id in use across QP2 promos
console.log('\n=== 3. QP2 template IDs in use (scan promos, all statuses) ===');
const seen = new Map(); // id → { count, sample: {code, subcats} }
async function scan(status) {
  let page = 1, last = 1;
  do {
    const r = await authedFetch(site, `/api/bo/promotion?perPage=100&page=${page}&status=${status}&sort_by=id&sort_order=desc`);
    last = r?.data?.paginations?.last_page ?? 1;
    const rows = r?.data?.rows || [];
    // detail fetch is expensive; sample list-level field if present, else fetch detail for first N unseen
    for (const p of rows) {
      // list endpoint may not carry blacklist_template_id; fetch detail lazily but cap
      let bid = p.blacklist_template_id;
      let subs = null;
      if (bid == null) {
        try { const d = await authedFetch(site, `/api/bo/promotion/${p.id}`); bid = d?.data?.rows?.blacklist_template_id; subs = d?.data?.rows?.blacklist_sub_categories; } catch {}
      }
      if (bid != null) {
        if (!seen.has(bid)) seen.set(bid, { count: 0, code: p.code, subcats: subs });
        seen.get(bid).count++;
      }
    }
    page++;
  } while (page <= last && page <= 6); // cap pages
}
await scan(1); // active
console.log(`  distinct blacklist_template_id in use (active promos):`);
[...seen.entries()].sort((a, b) => a[0] - b[0]).forEach(([id, v]) => {
  const cats = v.subcats ? [...new Set(v.subcats.flatMap((s) => s.sub_category_name || []))].length : '?';
  console.log(`    id=${id}  usedBy=${v.count} promos  e.g. ${v.code}  (blacklisted subcats sample: ${cats})`);
});
