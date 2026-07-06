#!/usr/bin/env node
// Probe current category + provider config for WC promos P165-P168 across all brands.
// Usage: node bin/probe-wc-categories.mjs

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const CODES = ['WC_GLD_100FC_10X', 'WC_PLT_188FC_10X', 'WC_DMD_288FC_10X', 'WC_VIP_REL_30PCT_12X'];

const QPRO_BRANDS = ['qpro3', 'qpro4', 'qpro5', 'qpro7', 'qpro10', 'qpro15', 'qpro16'];
const QP2_BRAND   = 'ibc22';

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getCategories(site) {
  const res = await authedFetch(site, '/api/bo/categories?perPage=999&page=1');
  return (res?.data?.rows || []).map(r => ({ id: r.id, name: r.name }));
}

async function getProviders(site) {
  const res = await authedFetch(site, '/api/bo/gameprovider?perPage=999&page=1');
  return (res?.data?.rows || []).map(r => ({ id: r.id, code: r.code, name: r.name, type: r.type }));
}

async function findPromoByCode(site, platform, code) {
  if (platform === 'qpro') {
    const res = await authedFetch(site, `/api/bo/promotion?perPage=50&page=1&search=${code}`);
    return (res?.data?.rows || []).find(r => r.code === code) || null;
  } else {
    // QP2 — search across all merchants
    const res = await authedFetch(site, `/api/bo/promotion?perPage=50&page=1&search=${code}`);
    return (res?.data?.rows || []).find(r => r.code === code) || null;
  }
}

async function getPromoDetail(site, platform, id) {
  const res = await authedFetch(site, `/api/bo/promotion/${id}`);
  return res?.data?.rows || res?.data || null;
}

// ── QPRO probe ──────────────────────────────────────────────────────────────

async function probeQpro(siteId) {
  const site = getSite(siteId);
  const [cats, provs] = await Promise.all([getCategories(site), getProviders(site)]);
  const catById = Object.fromEntries(cats.map(c => [c.id, c.name]));
  const provById = Object.fromEntries(provs.map(p => [p.id, `${p.code} (${p.name})`]));

  // Sports providers on this brand
  const sportsProviders = provs.filter(p =>
    /sport|saba|cmd|im\s?sport|sbt|pinnacle|maxbet|1x2|ufa|crown|iba|rp(?:1|2)|btl|mns|bet|odds/i.test(p.name + ' ' + p.code)
  );

  const rows = [];
  for (const code of CODES) {
    const listing = await findPromoByCode(site, 'qpro', code);
    if (!listing) { rows.push({ code, status: 'NOT FOUND', cats: '-', providers: '-' }); continue; }
    const det = await getPromoDetail(site, 'qpro', listing.id);
    // Detail GET returns promotion_category (not promotion_category_turnover)
    const catRows = Array.isArray(det?.promotion_category) ? det.promotion_category : [];
    const catIds = catRows.map(r => r.category_id);
    const catNames = catIds.map(id => catById[id] || `id=${id}`);
    const gpIds = Object.values(det?.game_provider_ids || det?.provider_ids || {});
    const gpNames = gpIds.map(id => provById[id] || `id=${id}`);
    rows.push({
      code,
      promoId: listing.id,
      status: listing.status,
      cats: catNames.length ? catNames.join(', ') : '(all/none)',
      providerCount: gpIds.length,
      providers: gpNames.length ? gpNames.slice(0, 10).join(', ') + (gpNames.length > 10 ? ` …+${gpNames.length-10}` : '') : '(all/none)',
    });
  }
  return { siteId, rows, sportsProviders, catCatalog: cats };
}

// ── QP2 probe ───────────────────────────────────────────────────────────────

async function probeQp2(siteId) {
  const site = getSite(siteId);
  // QP2 has no live gameprovider catalog — uses hardcoded codes. Only fetch categories.
  const cats = await getCategories(site);
  const catById = Object.fromEntries(cats.map(c => [c.id, c.name]));
  const sportsProviders = []; // QP2 uses string codes, not a catalog

  const rows = [];
  for (const code of CODES) {
    const listing = await findPromoByCode(site, 'qp2', code);
    if (!listing) { rows.push({ code, status: 'NOT FOUND', cats: '-', providers: '-' }); continue; }
    const det = await getPromoDetail(site, 'qp2', listing.id);
    const catIds = Object.values(det?.promotion_category_ids || {});
    const catNames = catIds.map(id => catById[id] || `id=${id}`);
    // QP2 providers are string codes in promotion's target[].game_provider_codes
    const targetProviders = det?.target?.flatMap(t => Object.values(t.game_provider_codes || {})) || [];
    rows.push({
      code,
      promoId: listing.id,
      status: listing.status,
      cats: catNames.length ? catNames.join(', ') : '(all/none)',
      providerCount: targetProviders.length,
      providers: targetProviders.length ? targetProviders.slice(0, 10).join(', ') + (targetProviders.length > 10 ? ` …+${targetProviders.length-10}` : '') : '(all/none)',
    });
  }
  return { siteId, rows, sportsProviders, catCatalog: cats };
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log('Probing WC promo categories + providers across all brands...\n');

// Run one QPRO brand and QP2 in parallel first, then the rest
const [qp2Result, qpro4Result] = await Promise.all([
  probeQp2(QP2_BRAND),
  probeQpro('qpro4'),
]);

const remainingQpro = await Promise.all(
  QPRO_BRANDS.filter(b => b !== 'qpro4').map(b => probeQpro(b))
);

const allResults = [qp2Result, qpro4Result, ...remainingQpro];

// ── Print results ────────────────────────────────────────────────────────────

for (const r of allResults) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`BRAND: ${r.siteId.toUpperCase()}`);
  console.log(`${'─'.repeat(70)}`);

  for (const row of r.rows) {
    console.log(`  ${row.code}`);
    console.log(`    ID:        ${row.promoId ?? 'N/A'} | Status: ${row.status ?? '?'}`);
    console.log(`    Categories: ${row.cats}`);
    console.log(`    Providers (${row.providerCount ?? '?'}): ${row.providers}`);
  }

  console.log(`\n  Sports providers on this brand (${r.sportsProviders.length}):`);
  if (r.sportsProviders.length) {
    r.sportsProviders.forEach(p => console.log(`    [${p.id}] ${p.code} — ${p.name}`));
  } else {
    console.log('    (none matched heuristic — check full catalog)');
  }

  console.log(`\n  Full category catalog (${r.catCatalog.length}):`);
  r.catCatalog.forEach(c => console.log(`    [${c.id}] ${c.name}`));
}

console.log('\n\nDone.');
