#!/usr/bin/env node
// Dry-run a single request — resolve duplicate_of references, render the
// BO Config Plan(s), validate completeness. Writes markdown to
// captures/plans/<P###>-<brand>.md and prints status to stdout.
//
//   node bin/dry-run.js <REQUEST_ID> [--out=captures/plans]
//
// Example:
//   node bin/dry-run.js P063
//   node bin/dry-run.js P019 --out=tmp/

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from './_args.js';
import { loadAllRequests, resolveDuplicates, plansForRequest, validatePlan } from '../src/planner.js';
import { loadBoCodeIndex, fetchBoCodeAsRecord } from '../src/bo-cache.js';

const { flags, positional } = parseArgs(process.argv.slice(2));
const requestId = positional[0];
if (!requestId) {
  console.error('usage: dry-run.js <REQUEST_ID> [--out=<dir>] [--no-bo]');
  process.exit(2);
}

const outDir = path.resolve(flags.out || 'captures/plans');
await mkdir(outDir, { recursive: true });

const { byHandle, byId, byCode } = await loadAllRequests();
// Accept either a composite handle (P069-r77) or a bare Request ID (P069).
// Bare IDs match the first occurrence — convenient for the common case but
// silently skips later duplicates from quarterly-table overlap.
const request = byHandle.get(requestId) || byId.get(requestId);
if (!request) {
  console.error(`Request "${requestId}" not found in captures/requests/.`);
  console.error(`Try a composite handle like "P069-r77". (Re-run bin/ingest-requests.js if the log was updated.)`);
  process.exit(2);
}

// Optionally skip the BO snapshot fallback (faster, no network).
const useBo = flags['no-bo'] !== true;
const bo = useBo ? await loadBoCodeIndex() : { byCode: new Map(), totalCodes: 0 };
if (useBo) console.error(`BO snapshot: ${bo.totalCodes} codes loaded`);

const resolved = await resolveDuplicates(request, byCode, {
  boIndex: bo.byCode,
  boFetcher: fetchBoCodeAsRecord,
});
const gaps = validatePlan(resolved);
const plans = plansForRequest(resolved);

console.log(`Request:    ${requestId} (${request.requestor})`);
console.log(`Bonus:      ${request.bonus_type}${request.bonus_sub_type ? ' - ' + request.bonus_sub_type : ''}`);
console.log(`Brands:     ${request.brands.join(', ')}`);
console.log(`Platforms:  ${[...new Set(plans.map((p) => p.platform).filter(Boolean))].join(', ')}`);

if (resolved._resolution?.inherited_from) {
  const via = resolved._resolution.inherited_via ? ` via ${resolved._resolution.inherited_via}` : '';
  console.log(`Inherited:  ${resolved._resolution.inherited_from}${via}` +
    (resolved._resolution.chain.length > 1 ? ` (chain: ${resolved._resolution.chain.join(' → ')})` : ''));
}
if (resolved._resolution?.error) {
  console.log(`⚠ Resolution error: ${resolved._resolution.error}`);
}

console.log('\nValidation:');
if (gaps.length === 0) {
  console.log('  ✅ All required fields present');
} else {
  console.log(`  ⛔ ${gaps.length} gap(s):`);
  for (const g of gaps) console.log(`     • ${g}`);
}

console.log('\nPlans:');
for (const p of plans) {
  if (!p.plan) {
    console.log(`  ⏭  ${p.brand}: SKIPPED — ${p.gaps.join('; ')}`);
    continue;
  }
  const f = path.join(outDir, `${requestId}-${p.brand}.md`);
  await writeFile(f, p.plan + '\n');
  const rel = path.relative(process.cwd(), f);
  console.log(`  ${p.status} ${p.brand} (${p.platform}) → ${rel}`);
}
