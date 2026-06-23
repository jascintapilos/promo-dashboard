// QP2 blacklist template LISTING — endpoint discovered from SPA bundle 2026-06-08:
//   GET /api/bo/gameprovider/getAllBlacklistTemplate   (params: name, status, paginate)
//   GET /api/bo/gameprovider/getBlacklistTemplate/{id} (returns black_list_sub_categories)
import { authedFetch } from '../src/api-client.js';
import { parseTemplateName } from '../src/blacklist-template.js';
import { getSite } from '../src/sites.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const site = getSite('ibc22');
const OUT = path.resolve('captures/blacklist-templates/2026-06-08');
await mkdir(OUT, { recursive: true });

async function tryList() {
  const variants = [
    '/api/bo/gameprovider/getAllBlacklistTemplate?paginate=false',
    '/api/bo/gameprovider/getAllBlacklistTemplate?perPage=200&page=1',
    '/api/bo/gameprovider/getAllBlacklistTemplate',
  ];
  for (const ep of variants) {
    try {
      const r = await authedFetch(site, ep);
      const rows = r?.data?.rows || r?.data || r;
      const list = Array.isArray(rows) ? rows : (rows?.rows || Object.values(rows || {}));
      if (Array.isArray(list)) return { rows: list, ep };
    } catch (e) { console.log(`  (${ep} → ${e.message.split('\n')[0].replace(/^HTTP /, '')})`); }
  }
  return { rows: null, ep: null };
}

const { rows, ep } = await tryList();
if (!rows) { console.log('LISTING FAILED on all variants'); process.exit(1); }

console.log(`\n━━━ ibc22 (QP2A/B/C/D) — ${rows.length} blacklist templates  via ${ep} ━━━\n`);
const enriched = [];
for (const t of rows) {
  let coverage = parseTemplateName(t.name);
  // pull detail to count blacklisted sub-categories (the inverse of coverage)
  let blCount = null, currIds = null;
  try {
    const d = await authedFetch(site, `/api/bo/gameprovider/getBlacklistTemplate/${t.id}`);
    const det = d?.data?.rows || d?.data || d;
    const subs = det?.black_list_sub_categories || det?.blacklist_sub_categories || det?.settings || [];
    blCount = Array.isArray(subs) ? subs.length : null;
    currIds = Array.isArray(subs) ? [...new Set(subs.map((s) => s.settings_currency_id ?? s.currency_id).filter((x) => x != null))].sort((a, b) => a - b) : null;
  } catch { /* detail optional */ }
  const pretty = coverage === 'ALL' ? 'ALL' : `{${[...coverage].sort().join(', ')}}`;
  console.log(`  id=${String(t.id).padStart(3)} status=${t.status} upd=${(t.updated_at || '').slice(0, 10)} by=${t.updated_by_username || t.created_by_username || '?'}  bl#=${blCount ?? '?'}  "${t.name}" → ${pretty}`);
  enriched.push({ id: t.id, name: t.name, status: t.status, updated_at: t.updated_at, coverage: coverage === 'ALL' ? 'ALL' : [...coverage].sort(), blacklistedSubcatCount: blCount });
}

await writeFile(path.join(OUT, 'ibc22.json'), JSON.stringify(rows, null, 2));
await writeFile(path.join(OUT, 'ibc22_enriched.json'), JSON.stringify(enriched, null, 2));

// Gap analysis (active only)
const STANDARD = [
  ['Slots Only (FS)', new Set(['SLOTS'])], ['Live Casino Only', new Set(['LIVE CASINO'])],
  ['Live Casino + Slots', new Set(['LIVE CASINO', 'SLOTS'])], ['Slots + Live Casino + Sports', new Set(['SLOTS', 'LIVE CASINO', 'SPORT'])],
  ['Sports + Esports', new Set(['SPORT', 'E-SPORTS'])], ['Sports Only', new Set(['SPORT'])],
  ['Esports Only', new Set(['E-SPORTS'])], ['Crash Only', new Set(['CRASH'])],
  ['Fishing Only', new Set(['FISHING'])], ['Cricket Only', new Set(['CRICKET'])], ['All games', 'ALL'],
];
const seq = (a, b) => (a === 'ALL' || b === 'ALL') ? a === b : (a.size === b.size && [...a].every((x) => b.has(x)));
const active = rows.filter((t) => Number(t.status) === 1).map((t) => parseTemplateName(t.name));
const missing = STANDARD.filter(([, want]) => !active.some((p) => seq(p, want))).map(([l]) => l);
console.log(`\n  active=${rows.filter((t) => Number(t.status) === 1).length}/${rows.length}`);
console.log(`  MISSING standard combos: ${missing.length ? missing.join(' | ') : '(none)'}`);
console.log(`\nSaved → captures/blacklist-templates/2026-06-08/ibc22.json (+ _enriched)`);
