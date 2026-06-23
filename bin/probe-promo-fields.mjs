#!/usr/bin/env node
// Probe what creator/author fields exist in promotion list + detail responses.
// Usage: node bin/probe-promo-fields.mjs

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

// Check one QP2 record and one QPRO record
const probes = [
  { site: 'ibc22',  id: 1181, label: 'QP2 id=1181' },
  { site: 'qpro7',  id: 341,  label: 'QPRO7 id=341' },
];

for (const p of probes) {
  const site = getSite(p.site);

  // 1. Check the LIST endpoint row shape
  console.log(`\n━━━ ${p.label} — LIST row fields ━━━`);
  const listResp = await authedFetch(site, `/api/bo/promotion?perPage=5&page=1`);
  const row = (listResp?.data?.rows || [])[0];
  if (row) {
    // Print all keys and their values
    for (const [k, v] of Object.entries(row)) {
      if (k.match(/creat|updat|author|user|oper|by|name|modif/i)) {
        console.log(`  ${k}: ${JSON.stringify(v)}`);
      }
    }
    console.log('  -- all keys:', Object.keys(row).join(', '));
  }

  // 2. Check the DETAIL endpoint
  console.log(`\n━━━ ${p.label} — DETAIL endpoint ━━━`);
  const detResp = await authedFetch(site, `/api/bo/promotion/${p.id}`);
  const det = detResp?.data?.rows || detResp?.data;
  if (det && typeof det === 'object') {
    for (const [k, v] of Object.entries(det)) {
      if (k.match(/creat|updat|author|user|oper|by|name|modif/i)) {
        console.log(`  ${k}: ${JSON.stringify(v)}`);
      }
    }
    console.log('  -- all keys:', Object.keys(det).join(', '));
  }
}
