#!/usr/bin/env node
// List all TEST_ promo codes across every configured BO site.
// Usage: node bin/list-test-promos.mjs
// Output: table grouped by brand, with id + code + status.

import { authedFetch } from '../src/api-client.js';
import { listSites } from '../src/sites.js';

const sites = listSites().filter((s) => ['qp2', 'qpro'].includes(s.platform));

const QP2_STATUS = { 1: 'Active', 2: 'Inactive', 3: 'Archived' };
const QPRO_STATUS = { 0: 'Inactive', 1: 'Active', 2: 'Archived' };

const results = [];   // { siteId, label, platform, id, code, status, statusLabel }

for (const site of sites) {
  // Skip ws1 / ws2 — not a promo-automation target
  if (site.id.startsWith('ws')) continue;

  process.stdout.write(`Scanning ${site.id} …`);
  try {
    let rows = [];

    if (site.platform === 'qp2') {
      // QP2: search by code prefix TEST_
      const resp = await authedFetch(site, '/api/bo/promotion?code=TEST_&perPage=200&page=1');
      rows = resp?.data?.rows || [];
      // Filter to TEST_ prefixed only (BO may return partial matches)
      rows = rows.filter((r) => String(r.code || r.promo_code || '').toUpperCase().startsWith('TEST_'));

    } else if (site.platform === 'qpro') {
      // QPRO: paginate through — use keyword search
      let page = 1;
      while (true) {
        const resp = await authedFetch(
          site,
          `/api/bo/promotion?keyword=TEST_&perPage=100&page=${page}`,
        );
        const pageRows = (resp?.data?.rows || []).filter((r) =>
          String(r.code || r.promo_code || '').toUpperCase().startsWith('TEST_'),
        );
        rows.push(...pageRows);
        const total = resp?.data?.total || 0;
        if (rows.length >= total || pageRows.length === 0) break;
        page++;
      }
    }

    process.stdout.write(` ${rows.length} found\n`);
    for (const r of rows) {
      const rawStatus = r.status ?? r.promotion_status;
      const statusLabel =
        site.platform === 'qp2'
          ? (QP2_STATUS[rawStatus] || `status=${rawStatus}`)
          : (QPRO_STATUS[rawStatus] || `status=${rawStatus}`);
      results.push({
        siteId: site.id,
        label: site.label || site.id,
        platform: site.platform,
        id: r.id,
        code: r.code || r.promo_code,
        status: rawStatus,
        statusLabel,
      });
    }
  } catch (err) {
    process.stdout.write(` ERROR: ${err.message}\n`);
  }
}

// Group by site
const bySite = {};
for (const r of results) {
  (bySite[r.siteId] = bySite[r.siteId] || []).push(r);
}

console.log('\n');
console.log('═══════════════════════════════════════════════════════════════');
console.log('  TEST_ PROMOS BY BRAND');
console.log('═══════════════════════════════════════════════════════════════');

let grand = 0;
for (const siteId of Object.keys(bySite).sort()) {
  const rows = bySite[siteId];
  const { label, platform } = rows[0];
  console.log(`\n${label || siteId}  [${platform.toUpperCase()}]  (${rows.length} record${rows.length !== 1 ? 's' : ''})`);
  console.log('  ─────────────────────────────────────────────────────────');
  for (const r of rows) {
    const flag = r.statusLabel === 'Active' ? '🟢' : r.statusLabel === 'Inactive' ? '🟡' : '⚫';
    console.log(`  ${flag}  id=${String(r.id).padEnd(6)}  ${r.statusLabel.padEnd(10)}  ${r.code}`);
  }
  grand += rows.length;
}

console.log(`\n═══════════════════════════════════════════════════════════════`);
console.log(`  TOTAL: ${grand} TEST_ promos across ${Object.keys(bySite).length} site(s)`);
console.log('═══════════════════════════════════════════════════════════════\n');

// Also write a machine-readable JSON for the deactivation script
import { writeFileSync } from 'node:fs';
writeFileSync('captures/test-promos-inventory.json', JSON.stringify(results, null, 2));
console.log('Inventory saved → captures/test-promos-inventory.json');
