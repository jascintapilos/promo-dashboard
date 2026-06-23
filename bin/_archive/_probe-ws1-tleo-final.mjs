#!/usr/bin/env node
// Probe WS1 IGMP MY & SG for the 54 canonical TLEO codes via the proven
// /PM/GetPromotionInfoByCode endpoint (cookie-session auth from
// igmp-sessions.local.json). Report which codes are MISSING per region.
//
// Run: node bin/_probe-ws1-tleo-final.mjs

import fs from 'node:fs';
import { igmpPost } from '../src/igmp-client.js';

const SOURCE = JSON.parse(fs.readFileSync('tmp/qpro2-tleo-source.json', 'utf8'));
const canonicalCodes = Object.keys(SOURCE).sort();
console.log(`Canonical TLEO codes from qpro2: ${canonicalCodes.length}\n`);

const regions = [
  { name: 'WS1-MY', site: 'ws1-v3-my' },
  { name: 'WS1-SG', site: 'ws1-v3-sg' },
];

// Look up a single code on a region. Returns { found, id }.
async function checkWs1(site, code) {
  try {
    const res = await igmpPost(site, '/PM/GetPromotionInfoByCode', { PromotionCode: code });
    const p = res?.data;
    return p?.PromotionId ? { found: true, id: p.PromotionId } : { found: false };
  } catch (e) {
    return { found: false, error: e.message.split('\n')[0] };
  }
}

const results = {};

for (const region of regions) {
  console.log(`\n━━━ ${region.name} (${region.site}) ━━━`);
  results[region.name] = {};
  let authError = null;

  // Probe in parallel batches of 6
  for (let i = 0; i < canonicalCodes.length; i += 6) {
    const batch = canonicalCodes.slice(i, i + 6);
    await Promise.all(batch.map(async code => {
      const r = await checkWs1(region.site, code);
      results[region.name][code] = r;
      if (r.error && !authError) authError = r.error;
    }));
    process.stdout.write(`  Probed ${Math.min(i + 6, canonicalCodes.length)}/${canonicalCodes.length}...\r`);
  }
  console.log('  Probed ' + canonicalCodes.length + '/' + canonicalCodes.length + ' codes.    ');

  const found = canonicalCodes.filter(c => results[region.name][c]?.found);
  const errored = canonicalCodes.filter(c => results[region.name][c]?.error);
  if (found.length === 0 && errored.length === canonicalCodes.length) {
    console.log(`  ⚠ All lookups errored — session likely expired. First error: ${authError}`);
  } else {
    console.log(`  ${found.length}/${canonicalCodes.length} codes found on ${region.name}`);
  }
}

// ── Report ──
console.log('\n\n' + '═'.repeat(70));
console.log('  COMPARISON — WS1 IGMP vs QPRO canonical (54 codes)');
console.log('═'.repeat(70));

for (const region of regions) {
  const res = results[region.name];
  const found   = canonicalCodes.filter(c => res[c]?.found);
  const missing = canonicalCodes.filter(c => !res[c]?.found);

  console.log(`\n### ${region.name} — ${found.length}/${canonicalCodes.length} present, ${missing.length} missing\n`);

  if (missing.length === 0) {
    console.log('  ✓ All 54 canonical TLEO codes are present.');
  } else {
    console.log(`  MISSING (${missing.length}):`);
    missing.forEach((c, i) => console.log(`    ${String(i + 1).padStart(2)}. ✗ ${c}`));
  }
}

// Write JSON report
const report = {
  probedAt: new Date().toISOString(),
  canonicalCount: canonicalCodes.length,
  regions: {},
};
for (const region of regions) {
  const res = results[region.name];
  report.regions[region.name] = {
    site: region.site,
    found: canonicalCodes.filter(c => res[c]?.found),
    missing: canonicalCodes.filter(c => !res[c]?.found),
    detail: res,
  };
}
fs.writeFileSync('tmp/ws1-tleo-probe-report.json', JSON.stringify(report, null, 2));
console.log('\n\nFull report written to tmp/ws1-tleo-probe-report.json');
