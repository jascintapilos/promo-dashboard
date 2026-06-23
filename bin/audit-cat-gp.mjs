#!/usr/bin/env node
// READ-ONLY audit — Categories & Game Providers on all QPRO + QP2 promos.
//
// BO CONTEXT: The Edit Promotion Code modal's Category and Game Provider
// dropdowns show "Please Select" even for promos that ARE configured —
// this is a BO UI rendering bug (Angular fails to restore saved values
// in those dropdowns). The data stored at API level is correct.
//
// This script confirms what is ACTUALLY stored by reading:
//   • List endpoint: p.category + p.game_provider (summary strings)
//   • Detail endpoint: promotion_category[] + game_provider_ids[] (QPRO)
//                   or promotion_category_ids{} + game_provider_codes{} (QP2)
//
// Usage:
//   node bin/audit-cat-gp.mjs                    # all QPRO1-17 + QP2A-D (status=1)
//   node bin/audit-cat-gp.mjs --brands qpro1,qpro5,ibc22
//   node bin/audit-cat-gp.mjs --status=0          # inactive promos
//   node bin/audit-cat-gp.mjs --detail            # also print per-promo rows
//   node bin/audit-cat-gp.mjs --code FT_TLEO_FC228_10X  # single code lookup
//
// Writes tmp/cat-gp-audit.json for follow-up fixers.

import { authedFetch } from '../src/api-client.js';
import { getSite, listSites } from '../src/sites.js';
import { writeFileSync, mkdirSync } from 'node:fs';

// ── Args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function argVal(flag) {
  const i = args.findIndex(a => a.startsWith(`${flag}=`));
  if (i >= 0) return args[i].split('=').slice(1).join('=');
  const j = args.indexOf(flag);
  return j >= 0 && args[j + 1] ? args[j + 1] : null;
}
const BRANDS_ARG    = argVal('--brands');
const STATUS_ARG    = argVal('--status') ?? '1';
const CODE_ARG      = argVal('--code');
const SHOW_DETAIL   = args.includes('--detail');
const SHOW_MISSING  = args.includes('--missing');   // only print promos with missing cats/GPs

// ── Site selection ───────────────────────────────────────────────────────────
const ALL_SITES = listSites().filter(s => s.platform === 'qpro' || s.platform === 'qp2');
const BRANDS = BRANDS_ARG
  ? BRANDS_ARG.split(',').map(s => s.trim())
  : ALL_SITES.map(s => s.id);

// ── Helpers ──────────────────────────────────────────────────────────────────
async function listPromos(site, status) {
  const rows = [];
  let page = 1, lastPage = 1;
  do {
    const params = new URLSearchParams({
      perPage: '200', page: String(page),
      status: String(status),
      category_id: '', game_provider_code: '', currency_id: '',
      bonus_condition: '', merchant_id: '', date_type: 'valid_from',
      sort_by: 'id', sort_order: 'desc',
    });
    const r = await authedFetch(site, `/api/bo/promotion?${params}`);
    const pageRows = Object.values(r.data?.rows ?? {});
    rows.push(...pageRows);
    lastPage = r.data?.paginations?.last_page ?? 1;
    page++;
  } while (page <= lastPage);
  return rows;
}

async function getDetail(site, id) {
  const r = await authedFetch(site, `/api/bo/promotion/${id}`);
  return r.data?.rows ?? null;
}

// Lookup category/provider catalogs once per site and return lookup maps.
async function loadCatalogs(site) {
  const catRes = await authedFetch(site, '/api/bo/categories?perPage=500');
  const catById = {};
  for (const c of Object.values(catRes.data?.rows ?? {})) catById[c.id] = c.name;

  const gpById   = {};
  const gpByCode = {};
  // QP2 (ibc22) doesn't expose a usable /api/bo/gameprovider listing endpoint —
  // it returns HTTP 500. QP2 promos store game_provider_codes as string codes
  // (e.g. "PP2", "JILI") which are already human-readable, so no catalog
  // lookup is needed. For QPRO, load the catalog so numeric IDs resolve to names.
  if (site.platform !== 'qp2') {
    try {
      const gpRes = await authedFetch(site, '/api/bo/gameprovider?perPage=200&page=1');
      for (const g of Object.values(gpRes.data?.rows ?? {})) {
        gpById[g.id]   = g.name ?? g.code;
        gpByCode[String(g.code ?? '').toUpperCase()] = g.name ?? g.code;
      }
    } catch { /* catalog unavailable — IDs shown as id:N */ }
  }
  return { catById, gpById, gpByCode };
}

// Resolve promo category names from either platform's detail shape.
function resolveCatNames(detail, catById) {
  // QPRO → promotion_category = [{ category_id, ... }] or []
  if (Array.isArray(detail.promotion_category) && detail.promotion_category.length) {
    return detail.promotion_category.map(c => catById[c.category_id] ?? `id:${c.category_id}`);
  }
  // QP2 → promotion_category_ids = {0: id, 1: id, ...} or {}
  const qp2cats = detail.promotion_category_ids;
  if (qp2cats && typeof qp2cats === 'object') {
    const ids = Object.values(qp2cats).filter(v => v != null);
    if (ids.length) return ids.map(id => catById[id] ?? `id:${id}`);
  }
  // Also try the list-row summary field (string: "Slots, Live Casino")
  if (typeof detail.category === 'string' && detail.category.trim()) {
    return detail.category.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

// Resolve game provider names from either platform's detail shape.
function resolveGpNames(detail, gpById, gpByCode) {
  // QPRO → game_provider_ids = [id, id, ...] or []
  if (Array.isArray(detail.game_provider_ids) && detail.game_provider_ids.length) {
    return detail.game_provider_ids.map(id => gpById[id] ?? `id:${id}`);
  }
  // QP2 detail row → game_provider_codes = {0: id, 1: id, ...} (numeric IDs despite name)
  const qp2gp = detail.game_provider_codes;
  if (qp2gp && typeof qp2gp === 'object') {
    const vals = Object.values(qp2gp).filter(v => v != null);
    if (vals.length) {
      return vals.map(v => {
        if (typeof v === 'string') return gpByCode[v.toUpperCase()] ?? v;
        return gpById[v] ?? `id:${v}`;
      });
    }
  }
  // Fall back to list-row summary field (string: "PP2 - Pragmatic Play, JILI")
  if (typeof detail.game_provider === 'string' && detail.game_provider.trim()) {
    return detail.game_provider.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

// ── Main ─────────────────────────────────────────────────────────────────────
const W = 100;
console.log('═'.repeat(W));
console.log(`  CATEGORIES & GAME PROVIDERS AUDIT  [READ-ONLY]`);
console.log(`  status=${STATUS_ARG}  brands=${BRANDS.length}  detail=${SHOW_DETAIL}`);
console.log('═'.repeat(W));

const allIssues  = [];   // promos with missing cats or GPs
const allSummary = [];
let gPromos = 0, gNocat = 0, gNogp = 0, gBothMissing = 0;

for (const brandId of BRANDS) {
  let site;
  try { site = getSite(brandId); } catch (e) {
    console.log(`  ${brandId}: unknown site — ${e.message}`);
    continue;
  }

  const label = (site.label || brandId).replace(/\s*—.*$/, '').slice(0, 36);
  process.stdout.write(`  ${brandId.padEnd(8)} ${label.padEnd(37)} ... `);

  try {
    const catalogs = await loadCatalogs(site);

    let promos;
    if (CODE_ARG) {
      const r = await authedFetch(site, `/api/bo/promotion?code=${encodeURIComponent(CODE_ARG)}&perPage=5`);
      promos = Object.values(r.data?.rows ?? {}).filter(p => p.code === CODE_ARG);
    } else {
      const statuses = STATUS_ARG === 'all' ? ['1', '0'] : [STATUS_ARG];
      promos = [];
      for (const st of statuses) promos.push(...await listPromos(site, st));
    }

    let nNocat = 0, nNogp = 0, nBoth = 0;
    const detailRows = [];

    for (const p of promos) {
      // Quick pre-check from list-level fields — avoids detail fetch when clearly set.
      const listCat = (p.category ?? '').trim();
      const listGp  = (p.game_provider ?? '').trim();
      const needsDetail = !listCat || !listGp || SHOW_DETAIL || SHOW_MISSING;

      let catNames = listCat ? listCat.split(',').map(s => s.trim()) : [];
      let gpNames  = listGp  ? listGp.split(',').map(s => s.trim())  : [];

      if (needsDetail) {
        const det = await getDetail(site, p.id);
        if (det) {
          const resolvedCat = resolveCatNames(det, catalogs.catById);
          const resolvedGp  = resolveGpNames(det, catalogs.gpById, catalogs.gpByCode);
          if (resolvedCat.length) catNames = resolvedCat;
          if (resolvedGp.length)  gpNames  = resolvedGp;
        }
      }

      const hasNocat = catNames.length === 0;
      const hasNogp  = gpNames.length  === 0;
      if (hasNocat) nNocat++;
      if (hasNogp)  nNogp++;
      if (hasNocat && hasNogp) nBoth++;

      if (hasNocat || hasNogp) {
        allIssues.push({ brand: brandId, id: p.id, code: p.code, name: p.name,
          promo_type: p.promo_type, status: p.status, catNames, gpNames });
      }

      if ((SHOW_DETAIL && !SHOW_MISSING) || (SHOW_MISSING && (hasNocat || hasNogp))) {
        detailRows.push({ id: p.id, code: p.code, name: p.name, catNames, gpNames });
      }
    }

    gPromos += promos.length; gNocat += nNocat; gNogp += nNogp; gBothMissing += nBoth;
    allSummary.push({ brand: brandId, label, promos: promos.length, nNocat, nNogp, nBoth });

    const flag = (nNocat > 0 || nNogp > 0) ? ' ⚠' : ' ✓';
    console.log(
      `${String(promos.length).padStart(4)} promos | no-cat: ${String(nNocat).padStart(3)} | no-gp: ${String(nNogp).padStart(3)} | both-missing: ${String(nBoth).padStart(3)}${flag}`,
    );

    if (detailRows.length) {
      for (const row of detailRows) {
        const catStr = row.catNames.join(', ') || '⚠ EMPTY';
        const gpStr  = row.gpNames.join(', ')  || '⚠ EMPTY';
        console.log(`         [${row.id}] ${row.code}`);
        console.log(`           cats : ${catStr}`);
        console.log(`           gps  : ${gpStr}`);
      }
    }

  } catch (e) {
    console.log(`ERROR: ${e.message.split('\n')[0].slice(0, 70)}`);
    allSummary.push({ brand: brandId, error: e.message.split('\n')[0] });
  }
}

console.log('─'.repeat(W));
console.log(
  `  ${'TOTAL'.padEnd(47)} ${String(gPromos).padStart(4)} promos | no-cat: ${String(gNocat).padStart(3)} | no-gp: ${String(gNogp).padStart(3)} | both-missing: ${String(gBothMissing).padStart(3)}`,
);
console.log('═'.repeat(W));

if (allIssues.length) {
  console.log(`\n  ⚠  ${allIssues.length} promos with missing category or game-provider at API level:`);
  console.log(`     (Note: BO edit form dropdown blank is a UI rendering bug — confirm below.)\n`);
  for (const p of allIssues) {
    const catStr = p.catNames.length ? p.catNames.join(', ') : '** EMPTY **';
    const gpStr  = p.gpNames.length  ? p.gpNames.join(', ')  : '** EMPTY **';
    console.log(`  [${p.brand}] ${p.code} (id=${p.id})`);
    console.log(`    categories    : ${catStr}`);
    console.log(`    game_providers: ${gpStr}`);
  }
  console.log('');
} else {
  console.log(`\n  ✓ All scanned promos have categories AND game providers set at API level.`);
  console.log(`    The "Please Select" display in the BO edit form is a BO UI rendering bug.\n`);
}

try { mkdirSync('tmp', { recursive: true }); } catch {}
const outPath = 'tmp/cat-gp-audit.json';
writeFileSync(outPath, JSON.stringify({ status: STATUS_ARG, generatedFor: BRANDS, totals: { gPromos, gNocat, gNogp, gBothMissing }, summary: allSummary, issues: allIssues }, null, 2));
console.log(`  Full results written to ${outPath}`);
console.log(`  NO WRITES PERFORMED.\n`);
