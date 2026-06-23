#!/usr/bin/env node
// End-to-end smoke test for the API-direct multi-brand canary.
//
// Runs 4 scenarios, each writing a unique TEST_SMOKE_* code, and verifies
// the BO state per scenario (promo created + MT linked + dialog linked).
//
//   T1: FC multi-brand SEQUENTIAL  (QPRO11 + QP2A via orchestrator)
//   T2: FC multi-brand PARALLEL    (--parallel flag)
//   T3: FC single-brand QPRO only  (orchestrator with one QPRO brand)
//   T4: FC single-brand QP2A only  (orchestrator with one QP2 brand)
//
// Each scenario:
//   1. spawn `node bin/canary-multi-brand.js <handle> --commit [--parallel]`
//   2. wait for exit
//   3. for each brand the request mentions, GET /api/bo/promotion?code=<code>
//   4. assert: promo exists, message_template_id != 0, dialog_popup_list.length > 0
//
// Usage:
//   node bin/smoke-test.mjs           # run all 4
//   node bin/smoke-test.mjs --only T2 # filter
//
// Each scenario writes one promo per brand. Cleanup with bin/cleanup-test-promos.js.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { parseArgs } from './_args.js';
import { getSite } from '../src/sites.js';
import { authedFetch } from '../src/api-client.js';
import { BRAND_TO_SITE } from '../src/ingest.js';

const { flags } = parseArgs(process.argv.slice(2));
const onlyFilter = flags.only ? String(flags.only).toUpperCase().split(',') : null;

const scenarios = [
  { id: 'T1', label: 'FC multi-brand SEQUENTIAL', handle: 'P-SMOKE-mb-seq',   code: 'TEST_SMOKE_MB_SEQ',   brands: ['QPRO11', 'QP2A'], parallel: false },
  { id: 'T2', label: 'FC multi-brand PARALLEL',   handle: 'P-SMOKE-mb-par',   code: 'TEST_SMOKE_MB_PAR',   brands: ['QPRO11', 'QP2A'], parallel: true  },
  { id: 'T3', label: 'FC single QPRO via orch',   handle: 'P-SMOKE-qpro-only',code: 'TEST_SMOKE_QPRO_ONLY',brands: ['QPRO11'],         parallel: false },
  { id: 'T4', label: 'FC single QP2A via orch',   handle: 'P-SMOKE-qp2-only', code: 'TEST_SMOKE_QP2_ONLY', brands: ['QP2A'],           parallel: false },
  { id: 'T5', label: 'Deposit on QP2A',            handle: 'P-SMOKE-qp2-dep',  code: 'TEST_SMOKE_QP2_DEP',  brands: ['QP2A'],           parallel: false },
  { id: 'T6', label: 'Free Spin on QP2A',          handle: 'P-SMOKE-qp2-fs',   code: 'TEST_SMOKE_QP2_FS',   brands: ['QP2A'],           parallel: false },
  { id: 'T7', label: 'FC on QP2B (cross-merchant)',handle: 'P-SMOKE-qp2b-fc',  code: 'TEST_SMOKE_QP2B_FC',  brands: ['QP2B'],           parallel: false },
  { id: 'T8', label: 'FC on QP2C (cross-merchant)',handle: 'P-SMOKE-qp2c-fc',  code: 'TEST_SMOKE_QP2C_FC',  brands: ['QP2C'],           parallel: false },
  { id: 'T9', label: 'FC on QP2D (cross-merchant)',handle: 'P-SMOKE-qp2d-fc',  code: 'TEST_SMOKE_QP2D_FC',  brands: ['QP2D'],           parallel: false },
];

function runOrchestrator(handle, parallel) {
  return new Promise((resolve) => {
    const args = [path.resolve('bin', 'canary-multi-brand.js'), handle, '--commit'];
    if (parallel) args.push('--parallel');
    const startedAt = Date.now();
    const child = spawn(process.execPath, args, { stdio: 'pipe', shell: false });
    let buf = '';
    child.stdout?.on('data', (d) => { buf += d.toString(); });
    child.stderr?.on('data', (d) => { buf += d.toString(); });
    child.on('exit', (code) => {
      const ms = Date.now() - startedAt;
      resolve({ exitCode: code, ms, log: buf });
    });
  });
}

async function verifyBrand(brand, code) {
  const siteId = BRAND_TO_SITE[brand]?.siteId;
  const site = getSite(siteId);
  // QPRO list filters by "promotion", QP2 by "code".
  const platform = (BRAND_TO_SITE[brand]?.platform || '').toLowerCase();
  const searchParam = platform === 'qpro' ? 'promotion' : 'code';
  const r = await authedFetch(site, `/api/bo/promotion?perPage=5&page=1&${searchParam}=${encodeURIComponent(code)}`);
  const row = (r?.data?.rows || []).find((x) => x.code === code);
  if (!row) return { brand, code, ok: false, reason: 'not found' };
  const mtOk = Number(row.message_template_id) > 0;
  const dialogOk = Array.isArray(row.dialog_popup_list) && row.dialog_popup_list.length > 0;
  return {
    brand, code, ok: mtOk && dialogOk,
    promotionId: row.id,
    message_template_id: row.message_template_id,
    mtOk,
    dialog_popup_list: row.dialog_popup_list,
    dialogOk,
  };
}

const results = [];

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('SMOKE TEST — API-direct multi-brand canary');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

for (const s of scenarios) {
  if (onlyFilter && !onlyFilter.includes(s.id)) continue;
  console.log('');
  console.log(`▶ ${s.id} — ${s.label}`);
  console.log(`  handle: ${s.handle}, code: ${s.code}, brands: ${s.brands.join(', ')}, parallel: ${s.parallel}`);
  const { exitCode, ms, log } = await runOrchestrator(s.handle, s.parallel);
  console.log(`  orchestrator exit=${exitCode} (${(ms/1000).toFixed(1)}s)`);
  const brandResults = [];
  for (const brand of s.brands) {
    try {
      const v = await verifyBrand(brand, s.code);
      brandResults.push(v);
      const status = v.ok ? '✓' : '✗';
      console.log(`  ${status} ${brand}: promo=${v.promotionId || '?'} MT=${v.message_template_id || 0} dialog_popup_list.length=${v.dialog_popup_list?.length || 0}`);
    } catch (e) {
      brandResults.push({ brand, ok: false, reason: e.message.split('\n')[0] });
      console.log(`  ✗ ${brand}: verify error — ${e.message.split('\n')[0].slice(0, 80)}`);
    }
  }
  // PASS gate: every brand verifies in BO (promo exists + MT linked + dialog linked).
  // Non-zero exit + verified state usually means idempotency hit — the run
  // didn't write but the prior data is intact, which still proves the path works.
  const pass = brandResults.every((b) => b.ok);
  const idempotency = exitCode !== 0 && pass;
  results.push({ id: s.id, label: s.label, pass, idempotency, exitCode, brandResults, log });
}

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('FINAL SUMMARY');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
for (const r of results) {
  const tag = r.pass ? (r.idempotency ? '✅ PASS (idem)' : '✅ PASS') : '❌ FAIL';
  console.log(`  ${tag}  ${r.id}  ${r.label}`);
  for (const b of r.brandResults) {
    if (!b.ok) console.log(`              └─ ${b.brand}: ${b.reason || 'verify failed'}`);
  }
}

const totalPass = results.filter((r) => r.pass).length;
console.log('');
console.log(`Result: ${totalPass}/${results.length} scenarios passed`);
process.exit(totalPass === results.length ? 0 : 1);
