#!/usr/bin/env node
// Batch dry-run: process every ingested request, write one markdown plan per
// (request, brand), and print a coverage summary. Useful for assessing
// pipeline health before any live writes.
//
//   node bin/dry-run-all.js [--out=captures/plans] [--ready-only]
//
// --ready-only suppresses BLOCKED plans (only writes ones that validate).

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from './_args.js';
import { loadAllRequests, resolveDuplicates, plansForRequest, validatePlan } from '../src/planner.js';
import { loadBoCodeIndex, fetchBoCodeAsRecord } from '../src/bo-cache.js';

const { flags } = parseArgs(process.argv.slice(2));
const outDir = path.resolve(flags.out || 'captures/plans');
const readyOnly = flags['ready-only'] === true;
const useBo = flags['no-bo'] !== true;
await mkdir(outDir, { recursive: true });

const { byHandle, byCode } = await loadAllRequests();
const bo = useBo ? await loadBoCodeIndex() : { byCode: new Map(), totalCodes: 0 };
if (useBo) console.error(`BO snapshot: ${bo.totalCodes} codes loaded for parent-lookup fallback`);

let totals = { requests: 0, plans: 0, ready: 0, blocked: 0, skipped: 0, inheritedFromBo: 0 };
const blockedExamples = [];
const platformCounts = {};

for (const request of byHandle.values()) {
  totals.requests++;
  const resolved = await resolveDuplicates(request, byCode, {
    boIndex: bo.byCode,
    boFetcher: fetchBoCodeAsRecord,
  });
  if (resolved._resolution?.inherited_via?.startsWith('bo')) totals.inheritedFromBo++;
  const plans = plansForRequest(resolved);
  for (const p of plans) {
    totals.plans++;
    platformCounts[p.platform || '(unknown)'] = (platformCounts[p.platform || '(unknown)'] || 0) + 1;
    if (!p.plan) {
      totals.skipped++;
      continue;
    }
    if (p.status === '✅ READY') totals.ready++;
    else {
      totals.blocked++;
      if (readyOnly) continue;
      if (blockedExamples.length < 10) blockedExamples.push({ id: request.request_id, brand: p.brand, gaps: p.gaps });
    }
    const f = path.join(outDir, `${request.request_id}-${p.brand}.md`);
    await writeFile(f, p.plan + '\n');
  }
}

console.log(`Requests processed:        ${totals.requests}`);
console.log(`  Inherited from BO snapshot: ${totals.inheritedFromBo}`);
console.log(`Plans generated:           ${totals.plans}`);
console.log(`  ✅ READY:                ${totals.ready}  (${((totals.ready / totals.plans) * 100).toFixed(0)}%)`);
console.log(`  ⛔ BLOCKED:              ${totals.blocked}`);
console.log(`  ⏭  Skipped (no platform): ${totals.skipped}`);

console.log('\nBy platform:');
for (const [k, v] of Object.entries(platformCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(12)} ${v}`);
}

if (blockedExamples.length) {
  console.log('\nBlocked examples (first 10):');
  for (const b of blockedExamples) {
    console.log(`  ${b.id}-${b.brand}: ${b.gaps.slice(0, 4).join('; ')}${b.gaps.length > 4 ? ` (+${b.gaps.length - 4} more)` : ''}`);
  }
}

console.log(`\nOutput: ${path.relative(process.cwd(), outDir)}/`);
