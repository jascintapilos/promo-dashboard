/**
 * Pull Smartico scheduled campaigns + orphan segments for the Ops Dashboard
 * CRM log — via the Smartico MCP static token (no login, no 2FA). Replaces the
 * boapi6 scraper (expiring human session + TOTP).
 *
 * The MCP is SLOW (segment list ~13s/page, campaign list ~3.5s/page, and a
 * campaign's creator needs one entity_get). So this keeps a persistent cache
 * (smartico-mcp-cache.local.json) and works INCREMENTALLY: it pages newest-first
 * and stops as soon as it reaches records already cached from the last run.
 *   - First run (empty cache) = full YTD backfill (~20-30 min). Run once in the
 *     background:  node bin/pull-smartico-mcp.mjs --backfill
 *   - Nightly = only the day's new records (~1 min).
 *
 * Output: team scheduled-campaigns + team orphan segments (usage_cnt 0), columns
 *   Date | Brand | Region | CRM Tool | Segment Name | Created By.
 *
 * Destinations (pick one; default is a dry-run preview):
 *   --push    POST the rows straight to the dashboard server as the `crmSmartico`
 *             dataset over the signed relay — NO Google Sheet. (The CRM log is a
 *             split feed: Smartico + FastTrack land as separate server datasets.)
 *   (no flag) dry run — print counts + sample, write nothing.
 *
 *   node bin/pull-smartico-mcp.mjs --backfill         # one-time full cache build (dry)
 *   node bin/pull-smartico-mcp.mjs                     # incremental dry run
 *   node bin/pull-smartico-mcp.mjs --push             # incremental, push crmSmartico
 */
import { smarticoMcpClient } from '../src/smartico-mcp-client.js';
import { listSites } from '../src/sites.js';
import { parseArgs } from './_args.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import crypto from 'node:crypto';
import path from 'node:path';
import { readWorkerRelaySecret, sign } from '../src/qc-dashboard/relay-auth.js';

const { flags } = parseArgs(process.argv.slice(2));
const PUSH       = flags.push === true;
const BACKFILL   = flags.backfill === true;      // ignore the cache's synced-through marks (full re-page)
const YEAR = new Date().getFullYear();
const CUTOFF = String(flags.since || `${YEAR}-01-01`);
const CONCURRENCY = Math.max(1, parseInt(flags.concurrency || '8'));
const CACHE_FILE = path.resolve('smartico-mcp-cache.local.json');
const HUB = (process.env.QC_HUB_URL || 'https://qc-dashboard.zoom66.xyz').replace(/\/+$/, '');

// Confirmed team (2026-10-07). joey@enigma / Diandra@enigma excluded (not promo team).
const TEAM = {
  'alysa@enigma': 'Alysa', 'booninn@enigma': 'Wen', 'jinwen@enigma': 'Carmen',
  'gabrielle@enigma': 'Gaby', 'bangun@enigma': 'Bangun', 'ridwan@enigma': 'Ridwan',
  'elyssa@enigma': 'Elyssa', 'jascinta@enigma': 'Jascinta', 'waiyip@enigma': 'Wai Yip',
};
const teamName = (u) => TEAM[String(u || '').toLowerCase()] || null;

// ── Brand + Region (same rules as the old pull) ──
function extractBrand(name) { const m = (name || '').match(/(?<![a-zA-Z])QPRO(\d+)(?![a-zA-Z])/i); return m ? `QPRO${m[1]}` : ''; }
const QPRO_REGIONS = {};
for (const site of listSites()) { const q = site.label.match(/QPRO(\d+)/); const r = site.label.match(/\(([A-Z/]+)\)/); if (q && r) QPRO_REGIONS[parseInt(q[1])] = r[1]; }
const REGION_MAP = [[/(?<![a-zA-Z])MYS?(?![a-zA-Z])/, 'MY'], [/(?<![a-zA-Z])SGP?(?![a-zA-Z])/, 'SG'], [/(?<![a-zA-Z])IDN?(?![a-zA-Z])/, 'ID'], [/(?<![a-zA-Z])TH(?![a-zA-Z])/, 'TH'], [/(?<![a-zA-Z])KH(?![a-zA-Z])/, 'KH']];
const CURRENCY_REGION = { MYR: 'MY', SGD: 'SG', IDR: 'ID', THB: 'TH', KHR: 'KH' };
function extractRegion(name, cond) {
  for (const [re, code] of REGION_MAP) if (re.test(name || '')) return code;
  const q = (name || '').match(/(?<![a-zA-Z])QPRO(\d+)(?![a-zA-Z])/i);
  if (q && QPRO_REGIONS[parseInt(q[1])]) return QPRO_REGIONS[parseInt(q[1])];
  const m = (cond || '').match(/\b(MYR|SGD|IDR|THB|KHR)\b/i);
  return m ? (CURRENCY_REGION[m[1].toUpperCase()] || '') : '';
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); } }));
  return out;
}

// ── Cache ──
let cache = { campaigns: {}, segments: {}, campaignsThrough: '', segmentsThrough: '', updatedAt: '' };
if (existsSync(CACHE_FILE)) { try { cache = { ...cache, ...JSON.parse(readFileSync(CACHE_FILE, 'utf8')) }; cache.campaigns ||= {}; cache.segments ||= {}; } catch { /* rebuild */ } }
const saveCache = () => { cache.updatedAt = new Date().toISOString(); try { writeFileSync(CACHE_FILE, JSON.stringify(cache)); } catch (e) { console.warn(`cache write failed: ${e.message}`); } };

const client = smarticoMcpClient();
console.log(`\nSmartico MCP pull — ${BACKFILL ? 'BACKFILL (full re-page)' : 'incremental'} · since ${CUTOFF} · ${PUSH ? 'PUSH crmSmartico' : 'DRY RUN'}\n`);

// ── Segments: page newest until past the YTD cutoff OR into already-synced territory ──
const segThrough = BACKFILL ? '' : (cache.segmentsThrough || '');
let newestSeg = segThrough;
process.stdout.write('Segments: paging newest… ');
{
  let page = 0, stop = false;
  while (!stop && page < 400) {
    const { records } = await client.entityList('segment', { sort: { field: 'create_date', dir: 'desc' }, limit: 50, offset: page * 50 });
    if (!records.length) break;
    for (const s of records) {
      const d = s.create_date || '';
      if (d > newestSeg) newestSeg = d;
      if (d < CUTOFF) { stop = true; break; }             // past YTD window
      if (segThrough && d <= segThrough) { stop = true; break; } // reached last run's newest → rest already cached
      cache.segments[s.segment_id] = { segment_id: s.segment_id, create_date: d, username: s.username || '', segment_name: s.segment_name || s.name || String(s.segment_id), conditions_readable: s.conditions_readable || '', usage_cnt: s.usage_cnt || 0 };
    }
    page++;
    process.stdout.write(`\r  segments: page ${page} (${Object.keys(cache.segments).length} cached)…`);
  }
}
cache.segmentsThrough = newestSeg || cache.segmentsThrough;
process.stdout.write('\n');

// ── Campaigns: page newest scheduled until past cutoff / already-synced; entity_get the new ones ──
const campThrough = BACKFILL ? '' : (cache.campaignsThrough || '');
let newestCamp = campThrough;
const toAttribute = [];
process.stdout.write('Campaigns: paging newest scheduled… ');
{
  let page = 0, stop = false;
  while (!stop && page < 400) {
    const { records } = await client.entityList('campaign', { filters: { audience_exec_type_id: 3 }, sort: { field: 'create_date', dir: 'desc' }, limit: 50, offset: page * 50 });
    if (!records.length) break;
    for (const c of records) {
      const d = c.create_date || '';
      if (d > newestCamp) newestCamp = d;
      if (d < CUTOFF) { stop = true; break; }
      if (campThrough && d <= campThrough) { stop = true; break; }
      if (!cache.campaigns[c.audience_id]) toAttribute.push(c);
    }
    page++;
    process.stdout.write(`\r  campaigns: page ${page} (${toAttribute.length} new to attribute)…`);
  }
}
process.stdout.write('\n');
if (toAttribute.length) {
  console.log(`  entity_get ${toAttribute.length} new campaigns (concurrency ${CONCURRENCY})…`);
  let done = 0;
  await mapLimit(toAttribute, CONCURRENCY, async (c) => {
    try { const f = await client.entityGet('campaign', c.audience_id); cache.campaigns[c.audience_id] = { create_date: f.create_date || c.create_date || '', username: f.username || '', audience_name: f.audience_name || c.audience_name || '', conditions_readable: f.segment_conditions_readable || f.conditions_readable || '', segment_id: f.segment_id ?? null }; }
    catch (e) { cache.campaigns[c.audience_id] = { create_date: c.create_date || '', username: '', audience_name: c.audience_name || '', conditions_readable: '', segment_id: null, _error: e.message.slice(0, 80) }; }
    if (++done % 100 === 0) process.stdout.write(`\r  attributed ${done}/${toAttribute.length}…`);
  });
  if (toAttribute.length > 100) process.stdout.write('\n');
}
cache.campaignsThrough = newestCamp || cache.campaignsThrough;
saveCache();

// ── Build team rows (YTD) from the cache ──
// Orphan = a team segment NOT targeted by any team scheduled campaign. Computed
// from the campaigns' cached segment_id (authoritative + timing-safe), not the
// segment's own usage_cnt (which freezes at fetch time and would double-count a
// segment later used by a campaign). Matches the old scraper's dedup.
const coveredSegmentIds = new Set(
  Object.values(cache.campaigns).filter((e) => teamName(e.username) && e.segment_id != null).map((e) => e.segment_id),
);
const campaignRows = Object.values(cache.campaigns)
  .filter((e) => (e.create_date || '') >= CUTOFF && teamName(e.username))
  .map((e) => ({ create_date: e.create_date, name: e.audience_name, conditions: e.conditions_readable, who: teamName(e.username) }));
const orphanRows = Object.values(cache.segments)
  .filter((s) => (s.create_date || '') >= CUTOFF && teamName(s.username) && !coveredSegmentIds.has(s.segment_id))
  .map((s) => ({ create_date: s.create_date, name: s.segment_name, conditions: s.conditions_readable, who: teamName(s.username) }));

const all = [...campaignRows, ...orphanRows].sort((a, b) => (b.create_date || '').localeCompare(a.create_date || ''));
console.log(`\nTeam rows (YTD): ${all.length} (${campaignRows.length} campaigns + ${orphanRows.length} orphan segments)`);
const byMember = {}; for (const r of all) byMember[r.who] = (byMember[r.who] || 0) + 1;
for (const [n, c] of Object.entries(byMember).sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(4)}  ${n}`);

// Census of ALL creators seen (for identity reconciliation)
const census = {};
for (const e of Object.values(cache.campaigns)) if ((e.create_date || '') >= CUTOFF) { const u = (e.username || '(blank)').toLowerCase(); census[u] = (census[u] || 0) + 1; }
for (const s of Object.values(cache.segments)) if ((s.create_date || '') >= CUTOFF && (s.usage_cnt || 0) === 0) { const u = (s.username || '(blank)').toLowerCase(); census[u] = (census[u] || 0) + 1; }
const nonTeam = Object.entries(census).filter(([u]) => !TEAM[u] && u !== '(blank)').sort((a, b) => b[1] - a[1]);
if (nonTeam.length) console.log(`\nNon-team creators seen YTD (excluded): ${nonTeam.map(([u, n]) => `${u}:${n}`).join(', ')}`);

const HEADER = ['Date', 'Brand', 'Region', 'CRM Tool', 'Segment Name', 'Created By'];
const dataRows = all.map((r) => [(r.create_date || '').slice(0, 10), extractBrand(r.name || ''), extractRegion(r.name || '', r.conditions || ''), 'Smartico', r.name || '', r.who]);

if (!PUSH) {
  console.log('\nSample (first 6):');
  for (const r of dataRows.slice(0, 6)) console.log(' ', r.map((v) => String(v).padEnd(16).slice(0, 16)).join(' | '));
  console.log(`\n(DRY RUN — re-run with --push to send ${dataRows.length} rows to the dashboard as crmSmartico.)`);
  process.exit(0);
}

// ── Push crmSmartico straight to the dashboard server (relay-signed, no sheet) ──
const secret = readWorkerRelaySecret();
if (!secret.present) { console.error(`push: relay secret unavailable — ${secret.reason}`); process.exit(1); }
const payload = { key: 'crmSmartico', pulledAt: new Date().toISOString(), ok: dataRows.length > 0, detail: '', headers: HEADER, rows: dataRows };
const relPath = '/api/relay/ops/dataset/crmSmartico';
const gz = gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
const timestamp = Date.now(), nonce = crypto.randomBytes(16).toString('hex');
const headers = { 'content-type': 'application/gzip', 'x-relay-timestamp': String(timestamp), 'x-relay-nonce': nonce, 'x-relay-signature': sign({ secret: secret.secret, method: 'POST', path: relPath, timestamp, nonce, bodyBuffer: gz }), 'x-relay-worker': `smartico-push-${process.pid}` };
const res = await fetch(`${HUB}${relPath}`, { method: 'POST', headers, body: gz });
const text = await res.text();
if (!res.ok) { console.error(`push rejected (${res.status}): ${text.slice(0, 200)}`); process.exit(1); }
console.log(`\n✅ Pushed ${dataRows.length} crmSmartico rows to ${HUB} → ${text}`);
