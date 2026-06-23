#!/usr/bin/env node
// Read-only sweep: list promos CREATED or EDITED in the window across QP2 + QPRO BOs.
// Window: 2026-06-01 .. 2026-06-07 inclusive (date portion of created_at / updated_at).
// Usage: node bin/_scan-changes-lastweek.mjs

import { authedFetch } from '../src/api-client.js';
import { listSites } from '../src/sites.js';
import { writeFileSync } from 'node:fs';

const FROM = '2026-06-01';
const TO   = '2026-06-07';
const inWindow = (ts) => {
  if (!ts) return false;
  const d = String(ts).slice(0, 10);
  return d >= FROM && d <= TO;
};

const sites = listSites().filter((s) => ['qp2', 'qpro'].includes(s.platform) && !s.id.startsWith('ws'));
const results = [];

for (const site of sites) {
  process.stdout.write(`Scanning ${site.id} …`);
  try {
    let page = 1, collected = 0, total = 0;
    while (true) {
      const resp = await authedFetch(site, `/api/bo/promotion?perPage=100&page=${page}&sort_by=updated_at&sort_order=desc`);
      const rows = resp?.data?.rows || [];
      total = resp?.data?.total || total;
      if (rows.length === 0) break;
      for (const r of rows) {
        const createdHit = inWindow(r.created_at);
        const updatedHit = inWindow(r.updated_at);
        if (createdHit || updatedHit) {
          results.push({
            siteId: site.id,
            label: site.label || site.id,
            platform: site.platform,
            id: r.id,
            code: r.code || r.promo_code,
            name: r.name,
            status: r.status ?? r.promotion_status,
            created_by: String(r.created_by || '').trim(),
            updated_by: String(r.updated_by || '').trim(),
            created_at: r.created_at,
            updated_at: r.updated_at,
            kind: createdHit ? 'created' : 'edited',
          });
        }
      }
      collected += rows.length;
      // sorted by updated_at desc — stop once we page past the window and gathered enough
      const oldestUpd = rows.reduce((m, r) => (r.updated_at && r.updated_at < m ? r.updated_at : m), rows[0].updated_at || '9999');
      if (String(oldestUpd).slice(0, 10) < FROM) break;
      if (collected >= total || rows.length < 100) break;
      page++;
    }
    process.stdout.write(` done (${collected}/${total} scanned)\n`);
  } catch (err) {
    process.stdout.write(` ERROR: ${err.message}\n`);
  }
}

const QP2_STATUS  = { 0:'Off', 1:'Active', 2:'Inactive', 3:'Archived' };
const QPRO_STATUS = { 0:'Inactive', 1:'Active', 2:'Archived' };

const bySite = {};
for (const r of results) (bySite[r.siteId] = bySite[r.siteId] || []).push(r);

console.log('\n════════════════════════════════════════════════════════════');
console.log(`  PROMO CHANGES ${FROM} .. ${TO}  (created OR edited)`);
console.log('════════════════════════════════════════════════════════════');
for (const siteId of Object.keys(bySite).sort()) {
  const rows = bySite[siteId];
  const { label, platform } = rows[0];
  const sm = platform === 'qp2' ? QP2_STATUS : QPRO_STATUS;
  rows.sort((a, b) => (b.updated_at < a.updated_at ? -1 : 1));
  console.log(`\n${label || siteId}  [${platform.toUpperCase()}]  (${rows.length})`);
  for (const r of rows) {
    const st = sm[r.status] || `status=${r.status}`;
    const tag = r.kind === 'created' ? 'NEW ' : 'EDIT';
    console.log(`  [${tag}] id=${String(r.id).padEnd(6)} ${st.padEnd(9)} c:${(r.created_at||'').slice(0,10)} u:${(r.updated_at||'').slice(0,10)} by:${(r.created_by||r.updated_by||'?').padEnd(16)} ${r.code}`);
  }
}

const created = results.filter((r) => r.kind === 'created').length;
const edited  = results.filter((r) => r.kind === 'edited').length;
console.log('\n════════════════════════════════════════════════════════════');
console.log(`  TOTAL: ${results.length}  (NEW: ${created}, EDIT-only: ${edited})  across ${Object.keys(bySite).length} brand(s)`);
console.log('════════════════════════════════════════════════════════════\n');

writeFileSync('captures/changes-lastweek.json', JSON.stringify(results, null, 2));
console.log('Saved → captures/changes-lastweek.json');
