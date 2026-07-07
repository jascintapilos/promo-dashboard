#!/usr/bin/env node
// READ-ONLY estate sweep — category-restricted promos still carrying the FULL
// game-provider catalog (pre-4843b74 mapper bug, 2026-07-02).
//
// Prior remediations covered P128-P142 (bin/fix-category-providers-june.mjs)
// and the P169-P172 QP2C copies (bin/fix-wc-slvr-qp2-providers.mjs). This
// sweep walks the ENTIRE active estate: ibc22 (QP2A/B/C/D, all merchants
// share one BO) + QPRO1-17, via listing pages AND a detail GET per promo —
// listing summary strings are not trusted (BO UI rendering bug).
//
// Flag rule per promo:
//   categories restricted (0 < catCount < site total categories)
//   AND provider count >= full-catalog threshold for that BO.
// Threshold = min(provider-catalog size, max provider count observed on any
// active promo) — robust to catalog drift since the promo was saved.
// QP2 has no usable /api/bo/gameprovider listing (HTTP 500), so only the
// observed max applies there.
//
// Also reported (secondary): OVERBROAD — providers restricted but the set is
// a superset of what the promo's categories allow (not the full catalog).
//
//   node bin/sweep-cat-gp-estate.mjs                 # all 18 sites
//   node bin/sweep-cat-gp-estate.mjs --brands qpro5,ibc22
//
// Writes tmp/estate-cat-gp-sweep.json for the remediation batch builder.
// NO WRITES to any BO.

import { authedFetch } from '../src/api-client.js';
import { listSites, getSite } from '../src/sites.js';
import { filterQp2ProvidersByCat } from '../src/api-mapper-qp2.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const brandsArg = (() => {
  const i = args.findIndex((a) => a.startsWith('--brands'));
  if (i < 0) return null;
  const v = args[i].includes('=') ? args[i].split('=')[1] : args[i + 1];
  return v ? v.split(',').map((s) => s.trim()) : null;
})();

const SITES = brandsArg
  ? brandsArg.map((id) => getSite(id))
  : listSites().filter((s) => s.platform === 'qpro' || s.platform === 'qp2');

// Provider-count floor below which "observed max" is not believable as a
// full catalog (these BOs all have 40-60 providers).
const FULL_FLOOR = 30;

// The mapper's "all games" convention (ALLOWED_WALLET_CATEGORY_NAMES /
// QP2_ALLOWED_WALLET_CATEGORY_NAMES). A promo whose categories cover ALL of
// these is intentionally unrestricted — full providers is correct there.
// Only promos with a NARROWER category set count as "restricted".
const MAIN_CATS = ['SPORT', 'LIVE CASINO', 'SLOTS', 'E-SPORTS', 'FISHING', 'CRASH', 'CRICKET'];

// Providers-over-expected margin for the secondary OVERBROAD flag — wide
// enough to absorb catalog-taxonomy noise (providers tagged inconsistently).
const OVERBROAD_MARGIN = 10;

const objVals = (o) => (o == null ? [] : Array.isArray(o) ? o : Object.values(o));

async function listActive(site) {
  const rows = [];
  let page = 1, lastPage = 1;
  do {
    const params = new URLSearchParams({
      perPage: '200', page: String(page), status: '1',
      category_id: '', game_provider_code: '', currency_id: '',
      bonus_condition: '', merchant_id: '', date_type: 'valid_from',
      sort_by: 'id', sort_order: 'desc',
    });
    const r = await authedFetch(site, `/api/bo/promotion?${params}`);
    rows.push(...objVals(r.data?.rows));
    lastPage = r.data?.paginations?.last_page ?? 1;
    page++;
  } while (page <= lastPage);
  return rows;
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ── Per-site sweep ────────────────────────────────────────────────────────────

async function sweepSite(site) {
  const res = { site: site.id, platform: site.platform, label: site.label || site.id,
    totalCats: 0, catalogGp: null, observedMaxGp: 0, active: 0, detailsFetched: 0,
    rows: [], errors: [] };

  // Category catalog
  const catRes = await authedFetch(site, '/api/bo/categories?perPage=500');
  const catRows = objVals(catRes.data?.rows);
  const catById = Object.fromEntries(catRows.map((c) => [c.id, c.name]));
  res.totalCats = catRows.length;

  // Provider catalog (QPRO only — the QP2 endpoint 500s)
  let gpById = {}, expectedByCat = null;
  if (site.platform === 'qpro') {
    try {
      const gpRes = await authedFetch(site, '/api/bo/gameprovider?perPage=999&page=1');
      const gpRows = objVals(gpRes.data?.rows);
      expectedByCat = {};
      for (const g of gpRows) {
        gpById[g.id] = g.code ?? g.name ?? `id:${g.id}`;
        for (const c of g.categories || []) {
          const key = String(c.category || '').toUpperCase();
          (expectedByCat[key] ??= new Set()).add(g.id);
        }
      }
      res.catalogGp = gpRows.length;
    } catch (e) {
      res.errors.push(`gameprovider catalog: ${e.message.split('\n')[0].slice(0, 80)}`);
    }
  }

  const promos = await listActive(site);
  res.active = promos.length;

  // Detail GET per promo — the only trustworthy source for cats + providers.
  const detailed = await pool(promos, 2, async (p) => {
    try {
      const r = await authedFetch(site, `/api/bo/promotion/${p.id}`);
      return { p, d: r.data?.rows ?? null };
    } catch (e) {
      res.errors.push(`detail ${p.id} ${p.code}: ${e.message.split('\n')[0].slice(0, 80)}`);
      return { p, d: null };
    }
  });
  res.detailsFetched = detailed.filter((x) => x.d).length;

  for (const { p, d } of detailed) {
    if (!d) continue;

    // Categories — QPRO: promotion_category[{category_id}] or
    // promotion_category_turnover; QP2: promotion_category_ids{}
    let catIds = [];
    if (Array.isArray(d.promotion_category) && d.promotion_category.length) {
      catIds = d.promotion_category.map((c) => c.category_id ?? c.id).filter((v) => v != null);
    } else if (d.promotion_category_turnover != null) {
      catIds = objVals(d.promotion_category_turnover).filter((v) => v != null);
    }
    if (!catIds.length && d.promotion_category_ids != null) {
      catIds = objVals(d.promotion_category_ids).filter((v) => v != null);
    }
    const catNames = catIds.map((id) => catById[id] ?? `id:${id}`);

    // Providers — QPRO: game_provider_ids[] (numeric). QP2 detail:
    // game_provider_codes{} numeric ids; target[0].game_provider_codes{} string codes.
    let gpVals = [], gpCodes = [];
    if (site.platform === 'qpro') {
      gpVals = objVals(d.game_provider_ids).filter((v) => v != null);
      gpCodes = gpVals.map((id) => gpById[id] ?? `id:${id}`);
    } else {
      gpVals = objVals(d.game_provider_codes).filter((v) => v != null);
      const t0 = Array.isArray(d.target) ? d.target[0] : d.target?.['0'] ?? d.target;
      gpCodes = objVals(t0?.game_provider_codes).filter((v) => v != null).map(String);
      if (gpCodes.length > gpVals.length) gpVals = gpCodes;
    }
    const gpCount = gpVals.length;
    if (gpCount > res.observedMaxGp) res.observedMaxGp = gpCount;

    const merchants = objVals(d.merchant_ids).map((m) => (typeof m === 'object' ? (m.name ?? m.code ?? m.id) : m));

    res.rows.push({
      id: p.id, code: p.code, name: p.name,
      created: (d.created_at ?? p.created_at ?? '').slice(0, 10),
      status: p.status, promo_type: d.promo_type ?? p.promo_type,
      catCount: catIds.length, catNames, gpCount, gpCodes, merchants,
      _catIds: catIds,
      _gpIds: site.platform === 'qpro' ? gpVals : [],
    });
  }

  // Expected provider count per promo's categories (secondary OVERBROAD signal)
  for (const row of res.rows) {
    row.expectedGp = null;
    if (!row.catCount) continue;
    if (site.platform === 'qpro' && expectedByCat) {
      const exp = new Set();
      for (const n of row.catNames) for (const id of expectedByCat[String(n).toUpperCase()] ?? []) exp.add(id);
      if (exp.size) row.expectedGp = exp.size;
    } else if (site.platform === 'qp2') {
      const filtered = filterQp2ProvidersByCat(row.catNames);
      if (filtered) row.expectedGp = new Set(Object.values(filtered.targetCodes)).size;
    }
  }

  return res;
}

// ── Run ───────────────────────────────────────────────────────────────────────

console.log(`\nESTATE SWEEP [READ-ONLY] — category restricted + full provider catalog`);
console.log(`Sites: ${SITES.map((s) => s.id).join(', ')}\n`);

const results = [];
await pool(SITES, 3, async (site) => {
  process.stdout.write(`  … ${site.id} starting\n`);
  try {
    const r = await sweepSite(site);
    results.push(r);
    console.log(`  ✓ ${site.id.padEnd(8)} active=${String(r.active).padStart(4)}  details=${String(r.detailsFetched).padStart(4)}  cats=${r.totalCats}  gpCatalog=${r.catalogGp ?? '-'}  gpMaxSeen=${r.observedMaxGp}${r.errors.length ? `  ⚠ ${r.errors.length} errors` : ''}`);
  } catch (e) {
    results.push({ site: site.id, fatal: e.message.split('\n')[0].slice(0, 120), rows: [] });
    console.log(`  ✗ ${site.id}: ${e.message.split('\n')[0].slice(0, 100)}`);
  }
});

// ── Flag pass ─────────────────────────────────────────────────────────────────

const hits = [], overbroad = [];
for (const r of results) {
  if (r.fatal) continue;
  const threshold = r.catalogGp != null
    ? Math.min(r.catalogGp, r.observedMaxGp >= FULL_FLOOR ? r.observedMaxGp : r.catalogGp)
    : (r.observedMaxGp >= FULL_FLOOR ? r.observedMaxGp : Infinity);
  r.fullThreshold = Number.isFinite(threshold) ? threshold : null;
  for (const row of r.rows) {
    // Restricted = has categories AND does not cover the full all-games
    // convention set (covering all MAIN_CATS = intentionally unrestricted).
    const catSet = new Set(row.catNames.map((n) => String(n).toUpperCase()));
    const coversAllMain = MAIN_CATS.every((c) => catSet.has(c));
    if (!row.catCount || coversAllMain) continue;
    if (row.gpCount >= threshold) {
      hits.push({ site: r.site, threshold, ...row });
    } else if (row.expectedGp != null && row.gpCount - row.expectedGp >= OVERBROAD_MARGIN) {
      overbroad.push({ site: r.site, threshold, ...row });
    }
  }
}

const fmt = (rows) => rows
  .sort((a, b) => a.site.localeCompare(b.site) || a.id - b.id)
  .map((h) => `  ${h.site.padEnd(8)} ${String(h.id).padEnd(6)} ${String(h.code).padEnd(34)} cats=[${h.catNames.join(',')}]  gp=${h.gpCount}/${h.threshold}${h.expectedGp ? ` (expect ${h.expectedGp})` : ''}  created=${h.created || '?'}${h.merchants?.length ? `  merch=[${h.merchants.join(',')}]` : ''}`)
  .join('\n');

console.log('\n' + '═'.repeat(100));
console.log(`  PRIMARY HITS — category restricted + FULL provider catalog: ${hits.length}\n`);
console.log(hits.length ? fmt(hits) : '  ✓ none');
console.log('\n' + '─'.repeat(100));
console.log(`  SECONDARY — providers restricted but OVERBROAD for the category: ${overbroad.length}\n`);
console.log(overbroad.length ? fmt(overbroad) : '  ✓ none');

mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/estate-cat-gp-sweep.json', JSON.stringify({
  generatedAt: new Date().toISOString(),
  sites: results.map(({ rows, ...meta }) => meta),
  hits, overbroad,
}, null, 2));
console.log(`\n  Full results → tmp/estate-cat-gp-sweep.json`);
console.log('  NO WRITES PERFORMED.\n');
