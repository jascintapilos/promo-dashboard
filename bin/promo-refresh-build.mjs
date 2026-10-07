#!/usr/bin/env node
// Promo report refresh build-driver (Task 2.1). Runs the WS1 Promo Effectiveness
// pipeline and writes the rebuilt report.json to PROMO_REFRESH_OUT. Spawned by the
// VDI worker (bin/promo-refresh-worker.mjs) with cwd = this OUTER pipeline repo.
//
// PORTABILITY — the ~250 pipeline scripts hardcode ONE scratchpad path (a Claude
// session dir). Rather than rewrite all of them, this driver ensures that path
// resolves to a usable scratchpad: in the authoring session it is a real dir (used
// as-is); in any other environment (the long-running VDI worker) it creates a
// directory JUNCTION from that path to a stable scratchpad (PROMO_SCRATCH or
// ~/.promo-scratch). One mechanism, zero script edits. (75 scripts also honor
// PROMO_SCRATCH directly after an earlier sweep; the junction covers the ~173
// inline references identically, so both resolve to the same place.)
//
// RUN ORDER IS DATA — bin/promo-refresh-stages.json (see its _README). That order is
// a DRAFT and MUST be validated by a test-run (a live, read-only warehouse pull)
// before a live refresh is trusted — run `--dry-run` first to inspect.
//
// Flags:  --dry-run   print the plan (portability + every stage) and exit; run nothing.

import { readFileSync, existsSync, mkdirSync, copyFileSync, lstatSync, openSync, writeSync, closeSync, statSync, unlinkSync } from 'node:fs';
import { spawnSync, spawn, execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const OUTER = process.cwd();
const DRY = process.argv.includes('--dry-run');
const OUT = process.env.PROMO_REFRESH_OUT || path.join(OUTER, 'scratchpad', 'report.refresh.json');
// The exact scratchpad path the pipeline scripts hardcode.
const SCRATCH = 'C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad';
const MANIFEST = JSON.parse(readFileSync(path.join(OUTER, 'bin', 'promo-refresh-stages.json'), 'utf8'));
const PY = MANIFEST.python || 'python';

function stage(n) { process.stdout.write(`STAGE:${n}\n`); }
function isJunction(p) { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } }

function ensureScratch() {
  if (existsSync(SCRATCH)) return { mode: isJunction(SCRATCH) ? 'junction' : 'real', target: SCRATCH };
  const stable = process.env.PROMO_SCRATCH || path.join(os.homedir(), '.promo-scratch');
  mkdirSync(stable, { recursive: true });
  mkdirSync(path.dirname(SCRATCH), { recursive: true });
  if (process.platform === 'win32') {
    execSync(`mklink /J "${SCRATCH.replace(/\//g, '\\')}" "${stable.replace(/\//g, '\\')}"`, { shell: 'cmd.exe', stdio: 'ignore' });
  } else {
    execSync(`ln -s "${stable}" "${SCRATCH}"`);
  }
  return { mode: 'junction(created)', target: stable };
}

// A stage is either a string (a Python script) or {script, engine, optional} where
// engine is 'python' (default) or 'node'. The 2 sheet-pulls (tl-codes) are node.
// optional:true stages are SOFT — their consumer tolerates a missing output, so a
// non-zero exit is logged and the pipeline continues instead of aborting.
function normalizeStage(s) {
  return typeof s === 'string' ? { script: s, engine: 'python', optional: false, markets: null } : { engine: 'python', optional: false, markets: null, ...s };
}
function runStage(stageDef, env) {
  const { script, engine, optional } = normalizeStage(stageDef);
  const cmd = engine === 'node' ? 'node' : PY;
  stage(path.basename(script));
  if (DRY) { process.stdout.write(`  (dry-run) ${cmd} ${script}${optional ? '  [optional]' : ''}${env.PROMO_MARKET ? '  PROMO_MARKET=' + env.PROMO_MARKET : ''}\n`); return; }
  const r = spawnSync(cmd, [script], { cwd: OUTER, env, stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) {
    if (optional) { process.stdout.write(`WARN: optional stage failed (exit ${r.status}), continuing: ${script}\n`); return; }
    throw new Error(`stage failed (exit ${r.status}): ${script}`);
  }
}

// Async variant of runStage (spawn, not spawnSync) for CONCURRENT groups. Same exit-code
// semantics: optional stages warn+resolve, others reject.
function runStageAsync(stageDef, env) {
  return new Promise((resolve, reject) => {
    const { script, engine, optional } = normalizeStage(stageDef);
    const cmd = engine === 'node' ? 'node' : PY;
    stage(path.basename(script));
    if (DRY) { process.stdout.write(`  (dry-run) ${cmd} ${script}  [parallel]${optional ? ' [optional]' : ''}\n`); return resolve(); }
    const ch = spawn(cmd, [script], { cwd: OUTER, env, stdio: ['ignore', 'inherit', 'inherit'] });
    ch.on('error', (e) => { if (optional) { process.stdout.write(`WARN: optional stage spawn error, continuing: ${script}\n`); resolve(); } else reject(e); });
    ch.on('close', (code) => {
      if (code === 0) return resolve();
      if (optional) { process.stdout.write(`WARN: optional stage failed (exit ${code}), continuing: ${script}\n`); return resolve(); }
      reject(new Error(`stage failed (exit ${code}): ${script}`));
    });
  });
}

// Run an array of INDEPENDENT stages concurrently, bounded by PROMO_PARALLEL_CAP (default 4).
// SAFE ONLY where the grouped stages provably don't read each other's outputs or write the
// same file (the manifest marks such a group as a nested array). Fail-fast: on a non-optional
// failure workers stop pulling NEW stages (already-in-flight ones finish — spawn can't be
// unlaunched), then the first error is re-thrown, which aborts the whole build non-zero
// (publish + the 'report not produced' guard are skipped, so no partial report is published).
const GROUP_CAP = Number(process.env.PROMO_PARALLEL_CAP) || 4;
async function runGroupConcurrent(stages, env) {
  process.stdout.write(`STAGE:parallel (${stages.length} pulls, cap ${Math.min(GROUP_CAP, stages.length)})\n`);
  const queue = stages.slice();
  let firstErr = null;
  const worker = async () => {
    while (queue.length && !firstErr) {   // stop dequeuing once a stage has failed (fail-fast)
      const s = queue.shift();
      try { await runStageAsync(s, env); } catch (e) { if (!firstErr) firstErr = e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(GROUP_CAP, stages.length) }, worker));
  if (firstErr) throw firstErr;
}

// Single build lock (same file as the parallel engine) — serialises every build sharing the one
// scratchpad so two never corrupt each other. A lock older than LOCK_STALE_MS (a crashed build) is stolen.
const LOCK = path.join(process.env.PROMO_LOCK_DIR || path.join(os.homedir(), '.qc-relay'), 'promo-build.lock');
const LOCK_STALE_MS = 25 * 60 * 1000;
let haveLock = false;
async function acquireLock() {
  mkdirSync(path.dirname(LOCK), { recursive: true });
  const giveUp = Date.now() + LOCK_STALE_MS + 120000;
  let waited = false;
  for (;;) {
    try { const fd = openSync(LOCK, 'wx'); writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`); closeSync(fd); haveLock = true; if (waited) process.stdout.write('build lock acquired (waited)\n'); return; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let age; try { age = Date.now() - statSync(LOCK).mtimeMs; } catch { continue; }
      if (age > LOCK_STALE_MS || Date.now() > giveUp) { try { unlinkSync(LOCK); } catch {} continue; }
      if (!waited) { process.stdout.write('another build is running — waiting for the build lock…\n'); waited = true; }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
function releaseLock() { if (haveLock) { try { unlinkSync(LOCK); } catch {} haveLock = false; } }
process.on('exit', releaseLock);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { releaseLock(); process.exit(1); });

async function main() {
  if (!DRY) await acquireLock();
  const sc = ensureScratch();
  process.stdout.write(`PORTABILITY: scratchpad ${sc.mode} -> ${sc.target}\n`);
  // Pin PROMO_SCRATCH for every child to the resolved scratch dir, so the env-aware
  // scripts (SCR = env PROMO_SCRATCH || hardcoded) and this driver's publish-read agree
  // on ONE location. Inline-hardcoded references still reach it via the junction.
  // PYTHONIOENCODING/PYTHONUTF8: the pipeline scripts print unicode (→, currency symbols);
  // under captured (non-console) stdout Windows Python defaults to cp1252 and would crash,
  // so force UTF-8 stdout for every child. Does not affect any file output (those pin utf-8).
  const base = { ...process.env, PROMO_SCRATCH: sc.target, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
  // The report carries BOTH markets, so a refresh normally rebuilds every market
  // regardless of any incoming PROMO_MARKET (the driver sets it per stage).
  // PROMO_REFRESH_MARKETS (comma-separated) overrides the manifest's market list —
  // used for a single-market validation run, e.g. PROMO_REFRESH_MARKETS=MY.
  // --start-at <basename> resumes from that stage, skipping earlier ones (whose outputs
  // are already on disk) — for continuing a run after fixing a mid-pipeline failure.
  const MARKETS = process.env.PROMO_REFRESH_MARKETS
    ? process.env.PROMO_REFRESH_MARKETS.split(',').map(s => s.trim()).filter(Boolean)
    : (MANIFEST.markets || ['MY']);
  const _sai = process.argv.indexOf('--start-at');
  const START_AT = _sai >= 0 ? process.argv[_sai + 1] : null;
  let started = !START_AT;
  const maybeRun = async (s, env) => {
    if (Array.isArray(s)) {   // a nested array is a CONCURRENT group
      if (!started) {
        if (s.some((x) => path.basename(normalizeStage(x).script) === START_AT)) started = true;
        else { process.stdout.write(`SKIP (resume before ${START_AT}): parallel group\n`); return; }
      }
      await runGroupConcurrent(s, env);
      return;
    }
    const { script } = normalizeStage(s);
    if (!started) {
      if (path.basename(script) === START_AT) started = true;
      else { process.stdout.write(`SKIP (resume before ${START_AT}): ${path.basename(script)}\n`); return; }
    }
    runStage(s, env);
  };
  process.stdout.write(`MARKETS: ${MARKETS.join(', ')}${START_AT ? `  (resume at ${START_AT})` : ''}\n`);
  // Markets run SEQUENTIALLY. True market-level concurrency was evaluated and rejected: the
  // stage runner is spawnSync (blocks the event loop, so Promise.all over markets gives no
  // speedup) AND four perMarket stages (who_targeted_pull, segment_map_pull,
  // segment_migration_pull, bonus_value_analysis) ignore PROMO_MARKET and write BOTH -MY and
  // -SG files on every pass — under real concurrency they would corrupt each other's output.
  // Cross-stage concurrency is instead expressed per-group (nested array), where safety is proven.
  for (const mk of MARKETS) {
    stage(`market ${mk}`);
    for (const s of (MANIFEST.perMarket || [])) {
      if (!Array.isArray(s)) {
        const st = normalizeStage(s);
        // A stage with a `markets` list only runs for those markets (e.g. MY-only
        // attribution/cashback stages that are gated off for SG by design).
        if (st.markets && !st.markets.includes(mk)) {
          process.stdout.write(`SKIP (${mk} not in stage markets): ${path.basename(st.script)}\n`);
          continue;
        }
      }
      await maybeRun(s, { ...base, PROMO_MARKET: mk });
    }
  }
  stage('shared');
  for (const s of (MANIFEST.shared || [])) await maybeRun(s, base);

  const builtPath = path.join(sc.target, MANIFEST.reportOut || 'explorer-payload.json');
  stage('publish');
  if (DRY) {
    process.stdout.write(`  (dry-run) copy ${builtPath} -> ${OUT}\n`);
  } else {
    if (!existsSync(builtPath)) throw new Error(`report not produced: ${builtPath}`);
    mkdirSync(path.dirname(OUT), { recursive: true });
    copyFileSync(builtPath, OUT);
    process.stdout.write(`OUT:${OUT}\n`);
  }
  stage('done');
}

main().catch((e) => { process.stderr.write(String((e && e.message) || e) + '\n'); process.exit(1); });
