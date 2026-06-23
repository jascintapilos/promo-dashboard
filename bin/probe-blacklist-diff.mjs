// Probe QPRO (all 17) + QP2 (ibc22) blacklist templates, diff against the
// 2026-05-28 baseline snapshots, and flag gaps vs the standard category combos.
//
// Read-only: GET /api/bo/blacklist only. Preserves the baseline — writes fresh
// snapshots into captures/blacklist-templates/<TODAY>/ instead of overwriting.
//
//   node bin/probe-blacklist-diff.mjs
//   node bin/probe-blacklist-diff.mjs --sites=qpro1,ibc22

import { authedFetch } from '../src/api-client.js';
import { parseTemplateName } from '../src/blacklist-template.js';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const TODAY = '2026-06-08';
const BASE = path.resolve('captures/blacklist-templates');
const OUT = path.join(BASE, TODAY);
await mkdir(OUT, { recursive: true });

const argSites = (process.argv.find((a) => a.startsWith('--sites=')) || '').split('=')[1];
const QPRO = Array.from({ length: 17 }, (_, i) => `qpro${i + 1}`);
const QP2 = ['ibc22'];
const ALL = argSites ? argSites.split(',').map((s) => s.trim()).filter(Boolean) : [...QPRO, ...QP2];

// QP2 listing endpoint is unknown — try candidates in order, first hit wins.
const QP2_CANDIDATES = [
  '/api/bo/blacklist?perPage=200&page=1',
  '/api/bo/blacklisttemplate?perPage=200&page=1',
  '/api/bo/blacklist-template?perPage=200&page=1',
  '/api/bo/blacklist_template?perPage=200&page=1',
  '/api/bo/blacklisttemplates?perPage=200&page=1',
  '/api/bo/promotionblacklist?perPage=200&page=1',
  '/api/bo/promotion/blacklisttemplate?perPage=200&page=1',
  '/api/bo/gameproviderblacklist?perPage=200&page=1',
  '/api/bo/blacklist/template?perPage=200&page=1',
];

// Standard category combos the team configures (used to flag gaps).
const STANDARD = [
  { label: 'Slots Only (FS shortcut)', want: new Set(['SLOTS']) },
  { label: 'Live Casino Only', want: new Set(['LIVE CASINO']) },
  { label: 'Live Casino + Slots', want: new Set(['LIVE CASINO', 'SLOTS']) },
  { label: 'Slots + Live Casino + Sports', want: new Set(['SLOTS', 'LIVE CASINO', 'SPORT']) },
  { label: 'Sports + Esports', want: new Set(['SPORT', 'E-SPORTS']) },
  { label: 'Sports Only', want: new Set(['SPORT']) },
  { label: 'Esports Only', want: new Set(['E-SPORTS']) },
  { label: 'Crash Only', want: new Set(['CRASH']) },
  { label: 'Fishing Only', want: new Set(['FISHING']) },
  { label: 'Cricket Only', want: new Set(['CRICKET']) },
  { label: 'All games (wildcard)', want: 'ALL' },
];

function setEq(a, b) {
  if (a === 'ALL' || b === 'ALL') return a === b;
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
function currSet(t) {
  return [...new Set((t.settings || []).map((s) => s.settings_currency_id))].sort((a, b) => a - b).join(',');
}
async function loadBaseline(siteId) {
  try { return JSON.parse(await readFile(path.join(BASE, `${siteId}.json`), 'utf8')); }
  catch { return null; }
}
async function fetchQpro(siteId) {
  const r = await authedFetch(siteId, '/api/bo/blacklist?perPage=200&page=1');
  return r?.data?.rows || [];
}
async function fetchQp2(siteId) {
  for (const ep of QP2_CANDIDATES) {
    try {
      const r = await authedFetch(siteId, ep);
      const rows = r?.data?.rows || r?.data || [];
      const list = Array.isArray(rows) ? rows : Object.values(rows);
      if (list.length && list[0] && (list[0].name || list[0].id)) return { rows: list, endpoint: ep };
    } catch (e) { /* try next */ }
  }
  return { rows: null, endpoint: null };
}

const report = { generatedAt: TODAY, sites: {} };

for (const siteId of ALL) {
  const isQp2 = QP2.includes(siteId);
  let rows, endpoint = '/api/bo/blacklist';
  try {
    if (isQp2) { const r = await fetchQp2(siteId); rows = r.rows; endpoint = r.endpoint; }
    else { rows = await fetchQpro(siteId); }
  } catch (e) {
    console.log(`\n━━━ ${siteId} ━━━  ERROR: ${(e.message || '').split('\n')[0]}`);
    report.sites[siteId] = { error: (e.message || '').split('\n')[0] };
    continue;
  }

  if (isQp2 && !rows) {
    console.log(`\n━━━ ${siteId} (QP2) ━━━  No listing endpoint found. Tried:\n  ${QP2_CANDIDATES.join('\n  ')}`);
    report.sites[siteId] = { platform: 'qp2', endpointFound: false, tried: QP2_CANDIDATES };
    continue;
  }

  await writeFile(path.join(OUT, `${siteId}.json`), JSON.stringify(rows, null, 2));
  const active = rows.filter((t) => Number(t.status) === 1);

  console.log(`\n━━━ ${siteId}${isQp2 ? ' (QP2)' : ''} ━━━  ${rows.length} templates (${active.length} active)  via ${endpoint}`);
  rows.forEach((t) => {
    const parsed = parseTemplateName(t.name);
    const pretty = parsed === 'ALL' ? 'ALL' : `{${[...parsed].sort().join(', ')}}`;
    console.log(`  id=${String(t.id).padStart(3)} status=${t.status} curr=[${currSet(t)}] upd=${(t.updated_at || '').slice(0, 10)} "${t.name}" → ${pretty}`);
  });

  // Diff vs baseline
  const baseline = await loadBaseline(siteId);
  const diff = { added: [], removed: [], changed: [] };
  if (baseline) {
    const baseById = new Map(baseline.map((t) => [t.id, t]));
    const liveById = new Map(rows.map((t) => [t.id, t]));
    for (const [id, t] of liveById) {
      if (!baseById.has(id)) { diff.added.push(`id=${id} "${t.name}"`); continue; }
      const b = baseById.get(id);
      const fields = [];
      if (b.name !== t.name) fields.push(`name "${b.name}"→"${t.name}"`);
      if (Number(b.status) !== Number(t.status)) fields.push(`status ${b.status}→${t.status}`);
      if (currSet(b) !== currSet(t)) fields.push(`curr [${currSet(b)}]→[${currSet(t)}]`);
      if ((b.settings || []).length !== (t.settings || []).length) fields.push(`settings ${(b.settings || []).length}→${(t.settings || []).length}`);
      if ((b.updated_at || '') !== (t.updated_at || '')) fields.push(`updated_at ${(b.updated_at || '').slice(0, 19)}→${(t.updated_at || '').slice(0, 19)}`);
      if (fields.length) diff.changed.push(`id=${id} "${t.name}": ${fields.join('; ')}`);
    }
    for (const [id, t] of baseById) if (!liveById.has(id)) diff.removed.push(`id=${id} "${t.name}"`);

    const hasChange = diff.added.length || diff.removed.length || diff.changed.length;
    console.log(`  ── diff vs 2026-05-28: ${hasChange ? '' : 'NO CHANGE'}`);
    diff.added.forEach((x) => console.log(`     + ADDED   ${x}`));
    diff.removed.forEach((x) => console.log(`     - REMOVED ${x}`));
    diff.changed.forEach((x) => console.log(`     ~ CHANGED ${x}`));
  } else {
    console.log(`  ── diff vs 2026-05-28: NO BASELINE (first probe of this site)`);
  }

  // Gap analysis vs standard combos
  const activeParsed = active.map((t) => ({ id: t.id, name: t.name, parsed: parseTemplateName(t.name) }));
  const missing = [];
  for (const s of STANDARD) {
    const hit = activeParsed.find((a) => setEq(a.parsed, s.want));
    if (!hit) missing.push(s.label);
  }
  if (missing.length) console.log(`  ── MISSING standard combos: ${missing.join(' | ')}`);
  else console.log(`  ── all standard combos present`);

  report.sites[siteId] = {
    platform: isQp2 ? 'qp2' : 'qpro',
    endpoint,
    total: rows.length,
    active: active.length,
    templates: active.map((t) => ({ id: t.id, name: t.name, parsed: parseTemplateName(t.name) === 'ALL' ? 'ALL' : [...parseTemplateName(t.name)].sort() })),
    diff: baseline ? diff : 'no-baseline',
    missingStandard: missing,
  };
}

await writeFile(path.join(OUT, '_report.json'), JSON.stringify(report, (k, v) => (v instanceof Set ? [...v] : v), 2));
console.log(`\n\nFull machine report → captures/blacklist-templates/${TODAY}/_report.json`);
console.log(`Fresh snapshots     → captures/blacklist-templates/${TODAY}/<site>.json  (baseline preserved)`);
