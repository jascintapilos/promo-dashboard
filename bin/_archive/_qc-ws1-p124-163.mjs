// Parallel QC for the 78 WS1 saves of P124-P163.
// For each (rn, site), GETs /PM/GetPromotionInfoByCode and verifies:
//   - PromotionId returned (record exists)
//   - PromotionCode matches expected
//   - PromotionName populated
//   - PromotionType matches (Bonus / FreeCredit / etc.)
//
// Run: node bin/_qc-ws1-p124-163.mjs [--concurrency=20]

import fs from 'node:fs';
import { igmpPost } from '../src/igmp-client.js';

const concArg = process.argv.find(a => a.startsWith('--concurrency='));
const CONCURRENCY = concArg ? Number(concArg.split('=')[1]) : 20;

const dir = 'captures/requests';
const files = fs.readdirSync(dir).filter(f => /^P1(2[4-9]|[3-5][0-9]|6[0-3])-/.test(f)).sort();
const SKIP_RN = new Set(['P132']);

const SITES = ['ws1-v3-my', 'ws1-v3-sg'];
const targets = [];
for (const f of files) {
  const r = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
  if (SKIP_RN.has(r.request_id)) continue;
  const expectedType = ({ 'deposit': 'Bonus', 'free credit': 'FreeCredit', 'free spin': 'FreeSpin' })[String(r.bonus_type || '').toLowerCase()];
  for (const site of SITES) {
    targets.push({ rn: r.request_id, code: r.promo_code, expectedType, site });
  }
}
console.log(`QC ${targets.length} WS1 saves in parallel (concurrency=${CONCURRENCY})...`);

async function qcOne(t) {
  try {
    const res = await igmpPost(t.site, '/PM/GetPromotionInfoByCode', { PromotionCode: t.code });
    const promo = res?.data;
    if (!promo) return { ...t, qc_status: 'MISSING' };
    const codeOk = promo.PromotionCode === t.code;
    const nameOk = !!promo.PromotionName && promo.PromotionName.length > 0;
    const typeOk = !t.expectedType || promo.PromotionType === t.expectedType;
    const checks = { codeOk, nameOk, typeOk };
    return {
      ...t,
      qc_status: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL',
      checks,
      promotion_id: promo.PromotionId,
      bo_code: promo.PromotionCode,
      bo_name: promo.PromotionName,
      bo_type: promo.PromotionType,
      bo_active: promo.IsActive,
      bo_published: promo.IsPublished,
    };
  } catch (e) {
    return { ...t, qc_status: 'ERROR', error: e.message };
  }
}

async function runBatched(items, fn, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

const t0 = Date.now();
const results = await runBatched(targets, qcOne, CONCURRENCY);
const dur = ((Date.now() - t0) / 1000).toFixed(1);

const pass = results.filter(r => r.qc_status === 'PASS').length;
const fail = results.filter(r => r.qc_status === 'FAIL').length;
const miss = results.filter(r => r.qc_status === 'MISSING').length;
const err  = results.filter(r => r.qc_status === 'ERROR').length;

console.log(`\n━━━━━━ WS1 QC SUMMARY (${dur}s) ━━━━━━`);
console.log(`  PASS: ${pass}/${targets.length}`);
console.log(`  FAIL: ${fail}`);
console.log(`  MISSING: ${miss}`);
console.log(`  ERROR: ${err}`);

if (fail) {
  console.log('\nFailures:');
  for (const r of results.filter(x => x.qc_status === 'FAIL')) {
    const failing = Object.entries(r.checks).filter(([k, v]) => !v).map(([k]) => k).join(',');
    console.log(`  ${r.rn} ${r.site} code=${r.code} — failing: ${failing}  bo_code="${r.bo_code}" bo_name="${r.bo_name}" bo_type="${r.bo_type}"`);
  }
}
if (miss) {
  console.log('\nMissing on BO:');
  results.filter(r => r.qc_status === 'MISSING').forEach(r => console.log(`  ${r.rn} ${r.site} code=${r.code}`));
}
if (err) {
  console.log('\nErrors:');
  results.filter(r => r.qc_status === 'ERROR').forEach(r => console.log(`  ${r.rn} ${r.site} — ${r.error?.slice(0, 150)}`));
}

fs.writeFileSync('captures/api-runs/qc-ws1-p124-163-summary.json', JSON.stringify({ generated: new Date().toISOString(), pass, fail, missing: miss, error: err, results }, null, 2));
console.log(`\nFull QC report → captures/api-runs/qc-ws1-p124-163-summary.json`);
