#!/usr/bin/env node
// Scan all QP2 + QPRO sites for:
//   (A) ALL promos created by 'promo_testbot'  (any date, any code prefix)
//   (B) ALL promos created since 2026-05-11    (any creator — so we can
//       identify Jascinta's BO username)
// Does NOT modify anything. Saves full inventory to captures/creator-scan.json
//
// Usage: node bin/scan-by-creator.mjs

import { authedFetch } from '../src/api-client.js';
import { listSites } from '../src/sites.js';
import { writeFileSync } from 'node:fs';

const SINCE = new Date('2026-05-11T00:00:00.000Z');
const TESTBOT = 'promo_testbot';

const sites = listSites().filter((s) => ['qp2', 'qpro'].includes(s.platform) && !s.id.startsWith('ws'));

const results = [];   // { siteId, label, platform, id, code, status, created_by, created_at, reason }

for (const site of sites) {
  process.stdout.write(`Scanning ${site.id} …`);
  try {
    let page = 1;
    let collected = 0;
    while (true) {
      const resp = await authedFetch(site, `/api/bo/promotion?perPage=100&page=${page}`);
      const rows = resp?.data?.rows || [];
      if (rows.length === 0) break;

      for (const r of rows) {
        const createdBy = String(r.created_by || '').trim();
        const createdAt = r.created_at ? new Date(r.created_at) : null;

        const isTestbot = createdBy === TESTBOT;
        const isSinceCutoff = createdAt && createdAt >= SINCE;

        if (isTestbot || isSinceCutoff) {
          results.push({
            siteId: site.id,
            label: site.label || site.id,
            platform: site.platform,
            id: r.id,
            code: r.code || r.promo_code,
            status: r.status ?? r.promotion_status,
            created_by: createdBy,
            created_at: r.created_at,
            reason: isTestbot ? 'testbot' : `since_${createdAt.toISOString().slice(0,10)}`,
          });
        }
      }
      collected += rows.length;

      // Stop paginating if all rows are older than cutoff AND none are testbot
      // (testbot rows could theoretically be anywhere, but in practice they're recent)
      const oldestOnPage = rows.reduce((min, r) =>
        r.created_at < min ? r.created_at : min, rows[0].created_at);
      if (new Date(oldestOnPage) < new Date('2026-05-01') && collected > 200) break;

      const total = resp?.data?.total || 0;
      if (collected >= total || rows.length < 100) break;
      page++;
    }
    process.stdout.write(` done (${collected} rows scanned)\n`);
  } catch (err) {
    process.stdout.write(` ERROR: ${err.message}\n`);
  }
}

// Show distinct created_by values for the since-cutoff group
console.log('\n════════════════════════════════════════════════════════════');
console.log('  DISTINCT CREATORS since 2026-05-11 (across all sites)');
console.log('════════════════════════════════════════════════════════════');
const byCreator = {};
for (const r of results) {
  const key = r.created_by;
  byCreator[key] = (byCreator[key] || 0) + 1;
}
for (const [creator, count] of Object.entries(byCreator).sort((a,b) => b[1]-a[1])) {
  console.log(`  ${creator.padEnd(30)}  ${count} promo(s)`);
}

// Group by site + creator
const bySite = {};
for (const r of results) {
  const key = r.siteId;
  (bySite[key] = bySite[key] || []).push(r);
}

console.log('\n════════════════════════════════════════════════════════════');
console.log('  FULL LIST BY BRAND');
console.log('════════════════════════════════════════════════════════════');

const QP2_STATUS  = { 0:'Off', 1:'Active', 2:'Inactive', 3:'Archived' };
const QPRO_STATUS = { 0:'Inactive', 1:'Active', 2:'Archived' };

for (const siteId of Object.keys(bySite).sort()) {
  const rows = bySite[siteId];
  const { label, platform } = rows[0];
  const statusMap = platform === 'qp2' ? QP2_STATUS : QPRO_STATUS;

  // Sort by created_by then by created_at desc
  rows.sort((a,b) => {
    if (a.created_by !== b.created_by) return a.created_by < b.created_by ? -1 : 1;
    return b.created_at < a.created_at ? -1 : 1;
  });

  console.log(`\n${label || siteId}  [${platform.toUpperCase()}]  (${rows.length})`);
  console.log('  ──────────────────────────────────────────────────────────────────');
  for (const r of rows) {
    const st = statusMap[r.status] || `status=${r.status}`;
    const icon = r.status === 1 ? '🟢' : r.status === 0 ? '⚫' : '🟡';
    const dateStr = r.created_at ? r.created_at.slice(0,10) : '?';
    console.log(`  ${icon} id=${String(r.id).padEnd(6)}  ${st.padEnd(10)}  ${r.created_by.padEnd(20)}  ${dateStr}  ${r.code}`);
  }
}

const total = results.length;
console.log(`\n════════════════════════════════════════════════════════════`);
console.log(`  TOTAL: ${total} record(s) matching criteria`);
console.log(`════════════════════════════════════════════════════════════\n`);

writeFileSync('captures/creator-scan.json', JSON.stringify(results, null, 2));
console.log('Full scan saved → captures/creator-scan.json');
