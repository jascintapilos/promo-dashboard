#!/usr/bin/env node
// Read-only audit — checks every active promo on all QPRO + QP2 sites for
// mismatches between category turnover and game provider restriction.
//
// Two bug patterns flagged:
//   A) catTO/catIds SET  + providers open (all) → category restricted but players can
//      use any provider to clear TO                              [June-style bug]
//   B) providers RESTRICTED + catTO/catIds EMPTY → provider list narrowed but all
//      wallets count toward TO                                   [TLEO-style bug]
//
// Promos with neither restriction (all providers + no catTO) are fine.
// Promos with both set correctly are fine.
//
// Usage:
//   node bin/audit-category-provider-gaps.mjs
//   node bin/audit-category-provider-gaps.mjs --all-statuses   # include inactive

import { authedFetch } from '../src/api-client.js';
import { listSites, getSite } from '../src/sites.js';

const ALL_STATUSES = process.argv.includes('--all-statuses');

const sites = listSites();
const QPRO_SITES = sites.filter(s => s.platform === 'qpro').map(s => s.id);
const QP2_SITES  = sites.filter(s => s.platform === 'qp2').map(s => s.id);

const findings = [];   // { siteId, id, code, status, pattern, detail }
const stats    = {};   // siteId → { total, active, flagged }

// ── Helpers ───────────────────────────────────────────────────────────────────

function objLen(o) {
  if (!o) return 0;
  if (Array.isArray(o)) return o.length;
  return Object.keys(o).length;
}

function flag(siteId, p, pattern, detail) {
  findings.push({ siteId, id: p.id, code: p.code, status: p.status, pattern, detail });
  stats[siteId].flagged++;
}

// ── QPRO audit ────────────────────────────────────────────────────────────────

async function auditQpro(siteId) {
  const site = getSite(siteId);
  stats[siteId] = { total: 0, active: 0, flagged: 0 };

  // Get total provider count for this brand
  let totalGp = 0;
  try {
    const gpr = await authedFetch(site, '/api/bo/gameprovider?perPage=999');
    const rows = gpr?.data?.rows || [];
    totalGp = rows.length;
  } catch { totalGp = 999; /* skip baseline check if unreachable */ }

  // Fetch all promos
  let rows = [];
  try {
    const r = await authedFetch(site, '/api/bo/promotion?perPage=999&page=1');
    rows = Object.values(r?.data?.rows ?? {});
  } catch (e) {
    console.error(`  ${siteId}: listing failed — ${e.message.slice(0,60)}`);
    return;
  }

  stats[siteId].total = rows.length;

  for (const p of rows) {
    if (!ALL_STATUSES && p.status !== 1) continue;
    stats[siteId].active++;

    const gpCount  = objLen(p.game_provider_ids);
    const catCount = objLen(p.promotion_category_turnover);

    // Pattern A: catTO set, providers fully open
    if (catCount > 0 && gpCount >= totalGp) {
      flag(siteId, p, 'A: catTO set, providers open',
        `catTO=${catCount}  gpIds=${gpCount}/${totalGp}`);
      continue;
    }

    // Pattern B: providers restricted, catTO empty
    if (gpCount > 0 && gpCount < totalGp && catCount === 0) {
      flag(siteId, p, 'B: providers restricted, catTO empty',
        `gpIds=${gpCount}/${totalGp}  catTO=0`);
    }
  }
}

// ── QP2 audit ─────────────────────────────────────────────────────────────────
// QP2 listing uses:
//   game_provider  — comma-separated string of restricted provider codes
//   category       — comma-separated string of category codes (e.g. "FS, SL")
// Both fields are present in the listing row.

function parseQp2Gp(p) {
  const s = p.game_provider || '';
  return s ? s.split(',').map(x => x.trim()).filter(Boolean) : [];
}

function parseQp2Cat(p) {
  const s = p.category || '';
  return s ? s.split(',').map(x => x.trim()).filter(Boolean) : [];
}

async function auditQp2(siteId) {
  const site = getSite(siteId);
  stats[siteId] = { total: 0, active: 0, flagged: 0 };

  let rows = [];
  let totalGp = 0;
  try {
    const r = await authedFetch(site, '/api/bo/promotion?perPage=999&page=1');
    rows = Object.values(r?.data?.rows ?? {});
    // Infer total (all providers) from widest promo in listing
    for (const p of rows) {
      const c = parseQp2Gp(p).length;
      if (c > totalGp) totalGp = c;
    }
  } catch (e) {
    console.error(`  ${siteId}: listing failed — ${e.message.slice(0,60)}`);
    return;
  }

  stats[siteId].total = rows.length;
  process.stdout.write(`  ${siteId}: total providers inferred = ${totalGp}\n`);

  for (const p of rows) {
    if (!ALL_STATUSES && p.status !== 1) continue;
    stats[siteId].active++;

    const gps     = parseQp2Gp(p);
    const cats    = parseQp2Cat(p);
    const gpCount = gps.length;
    const catCount = cats.length;

    // Pattern A: category specifically restricted (≤3 cats) + providers fully open
    // Exclude promos with many cats listed (those are intentionally broad)
    if (catCount > 0 && catCount <= 3 && gpCount >= totalGp) {
      flag(siteId, p, 'A: category restricted, providers open',
        `cats=[${cats.join(',')}]  gp=${gpCount}/${totalGp}`);
      continue;
    }

    // Pattern B: providers restricted (not all) + no category set
    // Threshold: < 45 providers = clearly restricted; skip if likely FS (1 provider)
    if (gpCount > 1 && gpCount < totalGp - 5 && catCount === 0) {
      flag(siteId, p, 'B: providers restricted, category empty',
        `gp=${gpCount}/${totalGp}  cats=[]`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`\nCategory / Provider Gap Audit — ${ALL_STATUSES ? 'all statuses' : 'active only'}\n`);
console.log('Sites:', [...QPRO_SITES, ...QP2_SITES].join(', '), '\n');

// Run QPRO sites in parallel batches of 5
async function runPool(tasks, limit = 5) {
  let next = 0;
  async function worker() {
    while (next < tasks.length) { const i = next++; await tasks[i](); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
}

const qproTasks = QPRO_SITES.map(id => async () => {
  process.stdout.write(`  probing ${id}...\n`);
  await auditQpro(id);
  const s = stats[id];
  process.stdout.write(`  ${id}: ${s.total} promos, ${s.active} active → ${s.flagged} flagged\n`);
});

await runPool(qproTasks, 5);

for (const id of QP2_SITES) {
  process.stdout.write(`  probing ${id}...\n`);
  await auditQp2(id);
  const s = stats[id];
  process.stdout.write(`  ${id}: ${stats[id].total} promos, ${stats[id].active} active → ${stats[id].flagged} flagged\n`);
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(80));
console.log('  FINDINGS\n');

if (!findings.length) {
  console.log('  ✓ No mismatches found across all sites.\n');
} else {
  const byPattern = {};
  for (const f of findings) {
    (byPattern[f.pattern] = byPattern[f.pattern] ?? []).push(f);
  }

  for (const [pattern, items] of Object.entries(byPattern)) {
    console.log(`  ── ${pattern} (${items.length}) ──`);
    // Group by site
    const bySite = {};
    for (const f of items) (bySite[f.siteId] = bySite[f.siteId] ?? []).push(f);
    for (const [siteId, sItems] of Object.entries(bySite)) {
      for (const f of sItems) {
        console.log(`    [${siteId}] [${String(f.id).padEnd(5)}] ${f.code.padEnd(40)} ${f.detail}`);
      }
    }
    console.log();
  }
}

// ── Stats table ───────────────────────────────────────────────────────────────

console.log('═'.repeat(80));
console.log('  SUMMARY TABLE\n');
let totalActive = 0, totalFlagged = 0;
const allSites = [...QPRO_SITES, ...QP2_SITES];
for (const id of allSites) {
  const s = stats[id] ?? { total: 0, active: 0, flagged: 0 };
  totalActive  += s.active;
  totalFlagged += s.flagged;
  const bar = s.flagged > 0 ? ' ⚠' : ' ✓';
  console.log(`  ${id.padEnd(10)}  total=${String(s.total).padEnd(4)}  active=${String(s.active).padEnd(4)}  flagged=${s.flagged}${bar}`);
}
console.log(`\n  Total active promos checked: ${totalActive}`);
console.log(`  Total flagged:               ${totalFlagged}\n`);
