#!/usr/bin/env node
// Probe gameprovider catalog — full category membership map.
// Shows which providers belong to SPORT / LIVE CASINO / SLOTS on QPRO.
// QP2 doesn't expose this endpoint — we use QPRO codes to infer QP2 subsets.

import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

async function probeQpro(siteId) {
  const site = getSite(siteId);
  const res = await authedFetch(site, '/api/bo/gameprovider?perPage=999&page=1');
  const rows = res?.data?.rows || [];

  // Build category → provider codes map
  const catMap = {};
  for (const r of rows) {
    const cats = Array.isArray(r.categories) ? r.categories : [];
    for (const c of cats) {
      const key = `${c.category} (${c.code})`;
      if (!catMap[key]) catMap[key] = [];
      catMap[key].push(r.code);
    }
  }

  console.log(`\n[${siteId}] Category → Provider codes:\n`);
  for (const [cat, codes] of Object.entries(catMap).sort()) {
    console.log(`  ${cat.padEnd(25)} (${codes.length}) → ${codes.sort().join(', ')}`);
  }

  // Also show providers that have NO categories tagged (unclassified)
  const untagged = rows.filter(r => !r.categories?.length);
  if (untagged.length) {
    console.log(`\n  UNTAGGED (${untagged.length}) → ${untagged.map(r => r.code).join(', ')}`);
  }

  console.log(`\n  Total providers: ${rows.length}`);
  return catMap;
}

const catMap = await probeQpro('qpro1');

// Cross-reference against QP2's 53 provider codes
// (from QP2A_TARGET_GAME_PROVIDER_CODES in api-mapper-qp2.js)
const QP2_CODES = new Set([
  '365G','9W','AP','AVI','BG','BOOM','BNG','BTG','CMD','CQ9','EVOK','EZ',
  'FC','FP','FS','GXW','HSG','IM','JDB','JILI','JK','KA','LIVE','LUCKY',
  'MAHA','MAX','MGP','MONKEY','NET2','NEX4D','NEXT','NLC','PGS','PGS2','PGS3',
  'PNG','PP','PP2','PTI','QQPK','RG','RT2','SA','SBO','SBO2','SEXY','SG',
  'SIMPLE','SPRIBE','SPRIBE2','TF','TTG2','VIVO','WBET','WM','XE','YB','YL',
]);

const TARGET_CATS = ['SPORT (SP)', 'LIVE CASINO (LC)', 'SLOTS (SL)'];
console.log('\n\nQP2 provider codes by category (intersection with QP2 53-code set):\n');
for (const cat of TARGET_CATS) {
  const inQpro = catMap[cat] || [];
  const inQp2  = inQpro.filter(c => QP2_CODES.has(c));
  const notInQp2 = inQpro.filter(c => !QP2_CODES.has(c));
  console.log(`  ${cat}`);
  console.log(`    QP2 subset (${inQp2.length}): ${inQp2.sort().join(', ')}`);
  if (notInQp2.length) {
    console.log(`    QPRO-only (${notInQp2.length}): ${notInQp2.sort().join(', ')}`);
  }
}

// Also: QP2 codes that appear in NONE of the target categories
const allTargetQproCodes = new Set(TARGET_CATS.flatMap(c => catMap[c] || []));
const qp2Uncat = [...QP2_CODES].filter(c => !allTargetQproCodes.has(c));
if (qp2Uncat.length) {
  console.log(`\n  QP2 codes not in SPORT/LC/SLOTS on QPRO (${qp2Uncat.length}): ${qp2Uncat.sort().join(', ')}`);
}

console.log('\nDone.');
