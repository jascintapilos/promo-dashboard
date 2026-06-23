import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const dir = 'captures/requests';
const files = fs.readdirSync(dir).filter(f => /^P1(2[4-9]|[3-5][0-9]|6[0-3])-/.test(f)).sort();
const SKIP = new Set(['P132']);

const targets = [];
for (const f of files) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (SKIP.has(r.request_id)) continue;
  targets.push({ rn: r.request_id, handle: r.handle, code: r.promo_code });
}

console.error(`LIVE COMMIT: ${targets.length} fixtures × 7 destinations = ${targets.length * 7} writes`);

function runOne(handle) {
  return new Promise((resolve) => {
    const start = Date.now();
    const p = spawn(process.execPath, ['bin/canary-multi-brand.js', handle, '--parallel', '--commit'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', code => {
      const dur = ((Date.now() - start) / 1000).toFixed(1);
      const summaryIdx = out.lastIndexOf('MULTI-BRAND SUMMARY');
      const summary = summaryIdx >= 0 ? out.slice(summaryIdx).split('\n').slice(2, 10).map(l => l.trim()).filter(Boolean) : [];
      resolve({ exit: code, dur, summary, raw: out, rawErr: err });
    });
  });
}

const results = [];
let i = 0;
for (const t of targets) {
  i++;
  process.stderr.write(`[${i}/${targets.length}] ${t.rn} (${t.code})... `);
  const r = await runOne(t.handle);
  const passed = r.summary.filter(l => /✅\s*OK/.test(l)).length;
  const total  = r.summary.length;
  const failed = r.summary.filter(l => !/✅\s*OK/.test(l) && /\b(QPRO|WS1)/.test(l));
  process.stderr.write(`exit=${r.exit} ${passed}/${total} ok (${r.dur}s)`);
  if (failed.length) process.stderr.write(`  ✗ ${failed.join(' | ')}`);
  process.stderr.write('\n');
  results.push({ ...t, exit: r.exit, dur: r.dur, passed, total, failed: failed.map(l => l.trim()), summary: r.summary });
  // Save incrementally in case of interruption
  fs.writeFileSync('captures/api-runs/commit-sweep-p124-163-progress.json', JSON.stringify({ generated: new Date().toISOString(), so_far: i, total: targets.length, results }, null, 2));
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('COMMIT SUMMARY');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const allOk = results.filter(r => r.exit === 0 && r.passed === r.total).length;
console.log(`  ${allOk}/${results.length} rows all-pass`);
const partials = results.filter(r => r.exit === 0 && r.passed < r.total);
const fails = results.filter(r => r.exit !== 0);
if (partials.length) {
  console.log(`\nPartial passes (${partials.length}):`);
  partials.forEach(r => console.log(`  ${r.rn} ${r.code} — ${r.passed}/${r.total} ok; failed: ${r.failed.join(', ')}`));
}
if (fails.length) {
  console.log(`\nHard fails (${fails.length}):`);
  fails.forEach(r => console.log(`  ${r.rn} ${r.code} — exit=${r.exit}`));
}
console.log('\nPer-row:');
console.log('RN\tCode\texit\tpass/total\tdur');
results.forEach(r => console.log(`${r.rn}\t${r.code}\t${r.exit}\t${r.passed}/${r.total}\t${r.dur}s`));

fs.writeFileSync('captures/api-runs/commit-sweep-p124-163-summary.json', JSON.stringify({ generated: new Date().toISOString(), results }, null, 2));
console.log('\nFull summary → captures/api-runs/commit-sweep-p124-163-summary.json');
