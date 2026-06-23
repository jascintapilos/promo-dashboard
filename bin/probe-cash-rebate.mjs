#!/usr/bin/env node
// Probe every brand for a rebate promo campaign across:
//   1. 5.1 Rebate Settings        /api/bo/rebate/settings   (QPRO only)
//   2. 3.3 Promotion Contents     /api/bo/promotioncontent  (QPRO + QP2)
//   3. promotionData collection   /items/promotionData      (WS1/WS2 Directus)
//
//   node bin/probe-cash-rebate.mjs                              ← default "rebate"
//   node bin/probe-cash-rebate.mjs --pattern "cash rebate"      ← custom
//   node bin/probe-cash-rebate.mjs --brands qpro1,ws1,ws2       ← subset
//   node bin/probe-cash-rebate.mjs --skip-bia                   ← QPRO/QP2 only

import { authedFetch, getSession, getAllPromotionContents } from '../src/api-client.js';
import { listSites } from '../src/sites.js';

function getArg(flag, def = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const RAW_PATTERN  = getArg('--pattern') || 'rebate';
const BRANDS_ARG   = getArg('--brands');
const BRANDS_LIST  = BRANDS_ARG ? BRANDS_ARG.split(',').map(s => s.trim()) : null;
const SKIP_BIA     = process.argv.includes('--skip-bia');

// Build a flexible regex:
//   - case-insensitive
//   - any internal whitespace collapses to \s*
//   - "%"  is treated as optional + tolerant of spacing
const escaped = RAW_PATTERN
  .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  .replace(/\s+/g, '\\s*')
  .replace(/%/g, '\\s*%?');
const RE_FULL    = new RegExp(escaped, 'i');
// Coarser fallback: just "cash rebate" with optional whitespace
const RE_REBATE  = /cash\s*rebate/i;
// "0.9" anchor for in-context match
const RE_ZERO_9  = /0\s*\.\s*9/;

const sites = listSites()
  .filter(s => s.platform === 'qpro' || s.platform === 'qp2' || (!SKIP_BIA && s.platform === 'bia'))
  .filter(s => !BRANDS_LIST || BRANDS_LIST.includes(s.id));

console.log('═'.repeat(80));
console.log(`  PROBE: "${RAW_PATTERN}"`);
console.log(`  Strict regex: ${RE_FULL}`);
console.log(`  Brands: ${sites.map(s => s.id).join(', ')} (${sites.length})`);
console.log('═'.repeat(80));

const hits = { rebate: [], contents: [], bia: [], allRebate: [] };

// Directus auth helper: POST /auth/login → { data: { access_token, refresh_token } }
// The username on bo-sites.json (e.g. "promo_testbot") is a label not an email;
// override with BIA_EMAIL env var, fall back to Jascinta's known email.
async function biaLogin(site) {
  // Credentials supplied via env (never persisted in repo). Default email
  // matches the BIA service account in current use.
  const email    = process.env.BIA_EMAIL    || 'promo_testbot@client.com';
  const password = process.env.BIA_PASSWORD;
  if (!password) {
    throw new Error('BIA_PASSWORD env var required for WS1/WS2 (Directus auth).');
  }
  const res = await fetch(`${site.baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, mode: 'json' }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`auth/login ${res.status}: ${txt.slice(0, 200)}`);
  }
  const j = await res.json();
  return j.data.access_token;
}

async function probeBiaSite(site) {
  const log = (msg) => console.log(`[${site.id}] ${msg}`);
  log(`platform=bia (Directus) ${site.baseUrl}`);

  let token;
  try {
    token = await biaLogin(site);
  } catch (e) {
    log(`  ✗ login: ${e.message.slice(0, 200)}`);
    return;
  }

  // Search promotionData. Directus filters use ?filter[field][_icontains]=...
  // Field names: per probe summary, promotionData has Promotion Code, Promotion ID,
  // Promotion Name, Region Code. Try a few common keys + raw search.
  const fieldGuesses = ['Promotion_Name', 'promotion_name', 'name', 'Promotion Name'];
  let rows = null, fieldUsed = null;

  // First: unfiltered list to discover real field names + count
  try {
    const r = await fetch(`${site.baseUrl}/items/promotionData?limit=-1`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      log(`  ✗ promotionData list ${r.status}: ${txt.slice(0, 200)}`);
      return;
    }
    const j = await r.json();
    rows = j.data || [];
    log(`  promotionData: ${rows.length} rows`);
  } catch (e) {
    log(`  ✗ list: ${e.message.slice(0, 200)}`);
    return;
  }

  if (!rows || !rows.length) return;

  // Discover which field carries the human-readable name
  const sample = rows[0];
  const stringKeys = Object.entries(sample)
    .filter(([_, v]) => typeof v === 'string' && v.length > 0)
    .map(([k]) => k);
  log(`  Sample row keys (string-valued): ${stringKeys.join(', ')}`);

  // Filter client-side across every string field
  for (const row of rows) {
    const hayParts = Object.entries(row)
      .filter(([_, v]) => typeof v === 'string')
      .map(([k, v]) => `${k}=${v}`);
    const hay = hayParts.join(' | ');
    if (RE_REBATE.test(hay)) {
      hits.bia.push({
        site: site.id,
        id: row.id,
        // best-effort name fields
        promotion_name: row.promotion_name || row.Promotion_Name || row.name || row.Promotion_Code || null,
        promotion_code: row.promotion_code || row.Promotion_Code || null,
        region_code:    row.region_code || row.Region_Code || null,
        status:         row.status || null,
        _matches:       hayParts.filter(p => RE_REBATE.test(p)).slice(0, 3),
      });
    }
  }
  log(`  rebate matches: ${hits.bia.filter(h => h.site === site.id).length}`);
}

async function probeSite(site) {
  if (site.platform === 'bia') return probeBiaSite(site);

  const log = (msg) => console.log(`[${site.id}] ${msg}`);
  try {
    const session = await getSession(site);
    const merchants = session.merchants;
    log(`platform=${site.platform} merchants=[${merchants.map(m => m.name).join(',')}]`);

    // ── 1. Rebate Settings (QPRO only) ─────────────────────────────────────
    if (site.platform === 'qpro') {
      try {
        const r = await authedFetch(site, '/api/bo/rebate/settings?perPage=500&page=1');
        const rows = r.data?.rows || r.data || [];
        let strictHit = 0, looseHit = 0;
        for (const row of rows) {
          const name = row.name || '';
          if (RE_REBATE.test(name)) {
            hits.allRebate.push({ site: site.id, id: row.id, name, percentage: row.percentage, status: row.status });
            looseHit++;
            if (RE_FULL.test(name) || (RE_REBATE.test(name) && RE_ZERO_9.test(name))) {
              hits.rebate.push({ site: site.id, id: row.id, name, percentage: row.percentage, status: row.status });
              strictHit++;
            }
          }
        }
        log(`  rebate: scanned=${rows.length}  cash-rebate=${looseHit}  strict=${strictHit}`);
      } catch (e) {
        log(`  rebate: ✗ ${e.message.slice(0, 120)}`);
      }
    }

    // ── 2. 3.3 Promotion Contents — per merchant, active + inactive ────────
    for (const m of merchants) {
      try {
        const active = await getAllPromotionContents(site, { siteFilterId: m.id, status: 1, type: 0, perPage: 100 });
        let inactive = { rows: [] };
        try {
          inactive = await getAllPromotionContents(site, { siteFilterId: m.id, status: 0, type: 0, perPage: 100 });
        } catch { /* some BOs return 500 on status=0 — ignore */ }
        const all = [...active.rows, ...inactive.rows];
        let strictHit = 0;
        for (const row of all) {
          const title = row.title || '';
          const code  = row.code || '';
          if (RE_FULL.test(title) || RE_FULL.test(code) ||
              (RE_REBATE.test(title) && RE_ZERO_9.test(title))) {
            hits.contents.push({
              site: site.id, merchant: m.name,
              id: row.id, code: row.code, title: row.title,
              status: row.status, locales: row.locales,
              visibility: row.member_visibility_name,
            });
            strictHit++;
          }
        }
        log(`  ${m.name} 3.3: ${active.rows.length} active + ${inactive.rows.length} inactive  strict=${strictHit}`);
      } catch (e) {
        log(`  ${m.name} 3.3: ✗ ${e.message.slice(0, 120)}`);
      }
    }
  } catch (e) {
    log(`✗ ${e.message.slice(0, 200)}`);
  }
}

// Limit concurrency to 4 so we don't fan out 17 logins at once
const CONCURRENCY = 4;
const queue = [...sites];
const workers = Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const site = queue.shift();
    if (site) await probeSite(site);
  }
});
await Promise.all(workers);

// ── Report ────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(80));
console.log('  RESULTS');
console.log('═'.repeat(80));

console.log(`\n▸ Matches for "${RAW_PATTERN}":`);
console.log(`  Rebate Settings (QPRO 5.1):       ${hits.rebate.length}`);
console.log(`  Promotion Contents (3.3 QPRO/QP2):${hits.contents.length}`);
console.log(`  promotionData (WS1/WS2 Directus): ${hits.bia.length}`);

if (hits.rebate.length) {
  console.log('\n── Rebate Settings ──');
  for (const h of hits.rebate) {
    const stat = h.status === 1 ? 'Active' : `status=${h.status}`;
    console.log(`  ${h.site.padEnd(8)} id=${String(h.id).padEnd(5)} ${stat.padEnd(8)} pct=${String(h.percentage).padEnd(6)} "${h.name}"`);
  }
}

if (hits.contents.length) {
  console.log('\n── 3.3 Promotion Contents ──');
  for (const h of hits.contents) {
    const stat = h.status === 1 ? 'Active' : 'Inactive';
    console.log(`  ${h.site.padEnd(8)} ${(h.merchant || '').padEnd(10)} id=${String(h.id).padEnd(5)} ${stat.padEnd(8)} code=${(h.code || '').padEnd(15)} vis="${h.visibility}"`);
    console.log(`           title="${h.title || ''}"`);
    console.log(`           locales=${h.locales || ''}`);
  }
}

// Context dump: every "cash rebate" rebate setting (regardless of pct)
if (hits.allRebate.length) {
  console.log(`\n▸ Context — every Rebate Setting containing "cash rebate" (${hits.allRebate.length}):`);
  // Sort by site, then percentage
  hits.allRebate.sort((a, b) =>
    a.site.localeCompare(b.site) ||
    (parseFloat(a.percentage) - parseFloat(b.percentage))
  );
  for (const h of hits.allRebate) {
    const stat = h.status === 1 ? 'Active' : `status=${h.status}`;
    console.log(`  ${h.site.padEnd(8)} id=${String(h.id).padEnd(5)} ${stat.padEnd(8)} pct=${String(h.percentage).padEnd(6)} "${h.name}"`);
  }
}

if (hits.bia.length) {
  console.log('\n── WS1/WS2 promotionData ──');
  for (const h of hits.bia) {
    console.log(`  ${h.site.padEnd(16)} id=${String(h.id).padEnd(5)} region=${(h.region_code || '').padEnd(5)} code=${(h.promotion_code || '').padEnd(20)} name="${h.promotion_name || ''}"`);
    if (h._matches?.length) {
      for (const m of h._matches) console.log(`           ↳ ${m.slice(0, 200)}`);
    }
  }
}

if (!hits.rebate.length && !hits.contents.length && !hits.bia.length) {
  console.log('\n  ⚠  No matches.');
  console.log('     Try a looser pattern:  --pattern "cash rebate"');
  console.log('     Or scan a single brand:  --brands qpro1');
}
console.log('═'.repeat(80) + '\n');
