#!/usr/bin/env node
// Probe iGMP FS catalog: list all FS-capable providers and their games.
//
// Usage:
//   node bin/probe-igmp-fs-games.mjs [--site=ws1-v3-my] [--provider=<hint>]
//
// Requires IGMP_COOKIE (or igmp-sessions.local.json with a live session).

import { parseArgs } from './_args.js';
import { igmpPost, listIgmpSites } from '../src/igmp-client.js';

const { flags } = parseArgs(process.argv.slice(2));
const siteId   = flags.site || 'ws1-v3-my';
const filterPv = flags.provider ? String(flags.provider).toLowerCase() : null;

if (!listIgmpSites().includes(siteId)) {
  console.error(`Unknown site "${siteId}". Available: ${listIgmpSites().join(', ')}`);
  process.exit(1);
}

console.log(`Probing FS catalog on ${siteId}…\n`);

// ── Fetch providers ──────────────────────────────────────────────────────────
const pvRes = await igmpPost(siteId, '/VIM/GetAllProductOfferings', { HasFreeSpin: true });
const providers = pvRes.data || [];
console.log(`FS-capable providers (${providers.length}):`);
for (const p of providers) {
  console.log(`  [${String(p.Id).padStart(4)}]  ${p.Code}  —  ${p.Name}`);
}

// ── Fetch games ──────────────────────────────────────────────────────────────
const gmRes = await igmpPost(siteId, '/VIM/GetGames', { HasFreeSpin: true, DeviceTypes: ['Mobile'] });
const allGames = gmRes.data || [];

// Group games by provider
const byProvider = new Map();
for (const g of allGames) {
  const pvId = String(g.ProductId);
  if (!byProvider.has(pvId)) byProvider.set(pvId, []);
  byProvider.get(pvId).push(g);
}

// Filter providers if --provider given
const targetProviders = filterPv
  ? providers.filter((p) =>
      String(p.Code || '').toLowerCase().includes(filterPv) ||
      String(p.Name || '').toLowerCase().includes(filterPv),
    )
  : providers;

console.log('');
for (const pv of targetProviders) {
  const pvId = String(pv.Id);
  const games = byProvider.get(pvId) || [];
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`${pv.Code}  —  ${pv.Name}  (ProductId=${pv.Id}, ${games.length} games)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  if (games.length === 0) {
    console.log('  (no games)');
  } else {
    const maxCode = Math.max(...games.map((g) => String(g.VendorDisplayCode || '').length), 20);
    console.log(`  ${'GameId'.padEnd(7)}  ${'VendorDisplayCode'.padEnd(maxCode)}  Name`);
    for (const g of games) {
      const code = String(g.VendorDisplayCode || '').padEnd(maxCode);
      console.log(`  ${String(g.Id).padEnd(7)}  ${code}  ${g.Name}`);
    }
  }
  console.log('');
}

console.log(`Total: ${allGames.length} FS games across ${providers.length} providers on ${siteId}`);
