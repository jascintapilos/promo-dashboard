// Parallel WS1-only commit for P124-P163.
// Skips P132 and the already-saved P124 (just for accounting), then runs
// canary-api-igmp.js --commit on each of (38 rows × 2 sites = 76 saves)
// in parallel batches.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const dir = 'captures/requests';
const files = fs.readdirSync(dir).filter(f => /^P1(2[4-9]|[3-5][0-9]|6[0-3])-/.test(f)).sort();
const SKIP_RN = new Set(['P132']);
const ALREADY_DONE = new Set([/* P124 was the smoke test, but re-running is idempotent on IGMP */]);

const SITES = ['ws1-v3-my', 'ws1-v3-sg'];
const CONCURRENCY = 6;

const targets = [];
for (const f of files) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (SKIP_RN.has(r.request_id) || ALREADY_DONE.has(r.request_id)) continue;
  for (const site of SITES) {
    targets.push({ rn: r.request_id, handle: r.handle, code: r.promo_code, site });
  }
}
console.error(`WS1 commits queued: ${targets.length} (${targets.length / SITES.length} rows × ${SITES.length} sites)`);

function runOne(t) {
  return new Promise(resolve => {
    const start = Date.now();
    const p = spawn(process.execPath,
      ['bin/canary-api-igmp.js', t.handle, `--site=${t.site}`, '--commit'],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', code => {
      const dur = ((Date.now() - start) / 1000).toFixed(1);
      // Heuristic: look for "✓" or "Successfully" in stdout
      const success = code === 0 && /successfully|created|saved|✓/i.test(out);
      const idLine = (out.match(/PromotionId: (\d+)/) || [])[1];
      resolve({ ...t, exit: code, dur, success, promotion_id: idLine, out_tail: out.slice(-400), err_tail: err.slice(-200) });
    });
  });
}

async function runBatched(items, fn, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      process.stderr.write(`[${i + 1}/${items.length}] ${items[i].rn} ${items[i].site}... `);
      results[i] = await fn(items[i]);
      const r = results[i];
      process.stderr.write(`exit=${r.exit} ${r.success ? '✓' : '✗'} (${r.dur}s)${r.promotion_id ? ' id=' + r.promotion_id : ''}\n`);
      if (!r.success) process.stderr.write(`     err: ${r.err_tail || r.out_tail.slice(-200)}\n`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

const t0 = Date.now();
const results = await runBatched(targets, runOne, CONCURRENCY);
const dur = ((Date.now() - t0) / 1000).toFixed(1);

const ok = results.filter(r => r.success).length;
const fail = results.filter(r => !r.success).length;

console.log(`\n━━━━━━ WS1 COMMIT SUMMARY (${dur}s) ━━━━━━`);
console.log(`  OK: ${ok}/${targets.length}`);
console.log(`  FAIL: ${fail}`);

if (fail) {
  console.log('\nFailures:');
  results.filter(r => !r.success).forEach(r => {
    console.log(`  ${r.rn} ${r.site} — exit=${r.exit}\n     ${(r.err_tail || r.out_tail.slice(-200)).replace(/\n/g, ' ')}`);
  });
}

fs.writeFileSync('captures/api-runs/ws1-commit-p124-163-summary.json', JSON.stringify({ generated: new Date().toISOString(), results }, null, 2));
console.log(`\nSummary → captures/api-runs/ws1-commit-p124-163-summary.json`);
