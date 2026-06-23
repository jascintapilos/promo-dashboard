#!/usr/bin/env node
// Probe WS1 MY & SG for TLEO codes, compare to QPRO canonical source.
// Report missing codes per region.
import fs from 'node:fs';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const SOURCE = JSON.parse(fs.readFileSync('tmp/qpro2-tleo-source.json', 'utf8'));
const canonicalCodes = new Set(Object.keys(SOURCE));
console.log(`Canonical TLEO codes from qpro2: ${canonicalCodes.size}\n`);

// WS1 regions available: ws1 (MY), ws1-classic-my, ws2 (SG is ws2 probably, or ws1 handles both)
const regions = ['ws1', 'ws1-classic-my', 'ws2'];

for (const region of regions) {
  console.log(`\n━━━ ${region.toUpperCase()} ━━━`);
  try {
    const site = getSite(region);
    // Try to fetch promotions with TLEO code filter
    const r = await authedFetch(site, '/api/bo/promotion?code=TLEO&perPage=300&page=1');
    const rows = r.data?.rows || [];
    const tleo = (Array.isArray(rows) ? rows : Object.values(rows)).filter(p => p.code?.includes('TLEO'));
    const foundCodes = new Set(tleo.map(p => p.code));
    console.log(`Found: ${foundCodes.size} TLEO codes`);

    // Compare
    const missing = [...canonicalCodes].filter(c => !foundCodes.has(c));
    const extra = [...foundCodes].filter(c => !canonicalCodes.has(c));

    if (missing.length) {
      console.log(`\nMISSING (${missing.length}):`);
      missing.forEach(c => console.log(`  ✗ ${c}`));
    } else {
      console.log(`✓ All canonical codes present`);
    }
    if (extra.length) {
      console.log(`\nEXTRA (${extra.length}):`);
      extra.forEach(c => console.log(`  + ${c}`));
    }
  } catch (e) {
    console.log(`ERROR: ${e.message.split('\n')[0]}`);
  }
}
