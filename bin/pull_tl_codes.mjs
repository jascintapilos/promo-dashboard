/**
 * Sheet step (market-parameterized) — pull the TL-approved code universe for ONE market
 * from the live "All Codes" tab into the three per-pillar scratchpad lists that the Python
 * pipeline reads. Replaces the older per-pillar sheet steps with a single PROMO_MARKET-driven
 * puller so MY and SG (and any future market) share one classification source.
 *
 * All Codes columns: Market | Pillar | Bonus Code | Bonus Name | Bonus Type | ...
 * Output shape per row: {code, name, type, mechanic}  (type == mechanic == Bonus Type, so
 *   the acq consumer which reads `mechanic` and the ret/vip consumers which read `type` both work).
 *
 * PERF: the whole 'All Codes' tab is the same for MY and SG, yet a full build runs this
 * once PER market — so it used to fetch the sheet (and cold-load the heavy googleapis lib)
 * twice. It now caches the raw rows at SCR/.tl-allcodes-cache.json with a TTL: the 2nd
 * market in a build (and any repeat refresh within the TTL) reads the cache instead of
 * re-hitting Google, and googleapis is only loaded on a cache MISS. The warehouse DATA is
 * always pulled fresh regardless; only the (rarely-changing) code LIST is cached.
 *   TTL:   TL_CACHE_TTL_MIN env (default 60).   Force a re-fetch: TL_CACHE_BUST=1.
 *
 * Run:  PROMO_MARKET=SG node bin/pull_tl_codes.mjs      (defaults to MY)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCR = (process.env.PROMO_SCRATCH || 'C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad');
const ID = '1I7LLEir7EVsrdZnqUhR6QWRzemvDOQEY84SgmqU58GQ';

const MARKET = (process.env.PROMO_MARKET || 'MY').trim().toUpperCase();
const SUF = { MY: 'MY', SG: 'SG' }[MARKET];
if (!SUF) { console.error(`PROMO_MARKET must be MY or SG; got ${MARKET}`); process.exit(1); }

// pillar name in the sheet -> (scratchpad subdir, filename stem)
const PILLARS = [
  { sheet: 'Acquisition', dir: 'acq', stem: 'tl-acq-codes' },
  { sheet: 'Retention',   dir: 'ret', stem: 'tl-ret-codes' },
  { sheet: 'VIP',         dir: 'vip', stem: 'tl-vip-codes' },
];

// ── Raw 'All Codes' rows: served from a short-lived cache when possible ──────────
const CACHE = path.join(SCR, '.tl-allcodes-cache.json');
const TTL_MS = (Number(process.env.TL_CACHE_TTL_MIN) || 60) * 60 * 1000;

async function fetchSheet() {
  const { google } = await import('googleapis');   // heavy import — only pay it on a cache MISS
  const { installed } = JSON.parse(fs.readFileSync(path.join(ROOT, 'google-oauth-client.local.json'), 'utf8'));
  const auth = new google.auth.OAuth2(installed.client_id, installed.client_secret, 'http://localhost:3000/oauth2callback');
  auth.setCredentials(JSON.parse(fs.readFileSync(path.join(ROOT, 'google-oauth-token.local.json'), 'utf8')));
  const s = google.sheets({ version: 'v4', auth });
  const r = await s.spreadsheets.values.get({ spreadsheetId: ID, range: "'All Codes'!A1:H5000" });
  return r.data.values || [];
}

let rows, src;
let cached = null;
try { cached = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { /* no/!bad cache */ }
const ageMs = cached && cached.fetchedAt ? (Date.now() - Date.parse(cached.fetchedAt)) : Infinity;
if (cached && Array.isArray(cached.rows) && Number.isFinite(ageMs) && ageMs < TTL_MS && !process.env.TL_CACHE_BUST) {
  rows = cached.rows;
  src = `cache (${Math.round(ageMs / 60000)}min old)`;
} else {
  rows = await fetchSheet();
  try {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    // Atomic write (temp + rename) so two markets fetching concurrently can't corrupt the
    // cache file — they write distinct temps, and the rename is atomic (last-writer-wins,
    // and both wrote the SAME raw sheet, so the result is correct either way).
    const tmp = `${CACHE}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify({ fetchedAt: new Date().toISOString(), rows }), 'utf8');
    fs.renameSync(tmp, CACHE);
  } catch { /* cache is best-effort */ }
  src = 'Google Sheet (fetched)';
}

for (const p of PILLARS) {
  const seen = new Set(), uniq = [];
  for (const row of rows) {
    if ((row[0] || '').trim() !== MARKET) continue;
    if ((row[1] || '').trim() !== p.sheet) continue;
    const code = (row[2] || '').trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const type = (row[4] || '').trim();
    uniq.push({ code, name: (row[3] || '').trim(), type, mechanic: type });
  }
  const dir = path.join(SCR, p.dir);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${p.stem}-${SUF}.json`);
  fs.writeFileSync(out, JSON.stringify(uniq, null, 2), 'utf8');
  const byType = {};
  for (const c of uniq) byType[c.type] = (byType[c.type] || 0) + 1;
  console.log(`${MARKET} ${p.sheet}: ${uniq.length} codes -> ${p.stem}-${SUF}.json [${src}] | ${JSON.stringify(byType)}`);
}
