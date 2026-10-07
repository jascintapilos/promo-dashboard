#!/usr/bin/env node
// Promo report refresh — PARALLEL DAG scheduler (Phase 3 engine).
//
// Drop-in alternative to promo-refresh-build.mjs. Instead of running the ~54 stages
// strictly in manifest order, it schedules them as a dependency DAG: a stage starts as
// soon as every stage that produces a file it reads has finished, so independent stages
// (the acq/ret/vip/attribution/deposit families) run CONCURRENTLY. Same stages, same
// scripts, same env — only the scheduling changes. Output must reconcile byte-for-byte
// with the sequential driver (that is the correctness gate).
//
// The DAG (bin/promo-refresh-dag.json) is derived from a ground-truth audit-hook I/O trace
// (scratchpad/dag_from_io.py): deps[S] = the nearest-earlier manifest producer of each file
// S reads. Manifest order is a proven linearization, so the edge set is acyclic and sound.
//
// Flags: --dry-run  print the wave plan + per-node deps, run nothing.
//        --seq      fall back to strict manifest order (parity check vs the old driver).
// Env:   PROMO_PARALLEL_CAP (default 6) max concurrent stages.
//        PROMO_REFRESH_MARKETS (default manifest.markets) comma list.
//        PROMO_REFRESH_OUT publish target (default scratchpad/report.refresh.json).

import { readFileSync, existsSync, mkdirSync, copyFileSync, lstatSync, openSync, writeSync, closeSync, statSync, unlinkSync } from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const OUTER = process.cwd();
const DRY = process.argv.includes('--dry-run');
const SEQ = process.argv.includes('--seq');
const OUT = process.env.PROMO_REFRESH_OUT || path.join(OUTER, 'scratchpad', 'report.refresh.json');
const CAP = Number(process.env.PROMO_PARALLEL_CAP) || 6;
// Store-backed producers: when PROMO_USE_STORES=1 (or --stores), these heavy stages run their
// local DuckDB-over-Parquet twin (bin/preagg/produce_*.py) instead of the warehouse original.
// The twins write the SAME output files and read the SAME inputs, so the DAG schedule is unchanged.
const USE_STORES = process.env.PROMO_USE_STORES === '1' || process.argv.includes('--stores');
const STORE_VARIANT = {
  'bin/bonus_roi_horizon.py': 'bin/preagg/produce_bonus_roi_horizon.py',
  'bin/deposit_afterclaim_split_pull.py': 'bin/preagg/produce_deposit_afterclaim_split.py',
  'bin/deposit_alloc_bycode_pull.py': 'bin/preagg/produce_deposit_alloc_bycode.py',
  'bin/deposit_truth_pull.py': 'bin/preagg/produce_deposit_truth.py',
  'bin/deposit_timedecay_pull.py': 'bin/preagg/produce_deposit_timedecay.py',
  'bin/deposit_behaviour_bycode_pull.py': 'bin/preagg/produce_deposit_behaviour_bycode.py',
  // cashback_incrementality: store-backed twin exists + reconciles byte-exact, but it is NET-NEGATIVE
  // in the concurrent build on this 8-core VDI — a 7th heavy DuckDB stage either oversubscribes the CPU
  // (cap 6 -> 85s) or, thread-limited, slows the deposit producers (-> 60s). Kept on the warehouse
  // (14.7s, I/O-bound, parallelizes cleanly). Producer retained for reference / a higher-core host.
};
const SCRATCH = 'C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad';
const MANIFEST = JSON.parse(readFileSync(path.join(OUTER, 'bin', 'promo-refresh-stages.json'), 'utf8'));
const DAG = JSON.parse(readFileSync(path.join(OUTER, 'bin', 'promo-refresh-dag.json'), 'utf8'));
const PY = MANIFEST.python || 'python';

function log(s) { process.stdout.write(s + '\n'); }
function isJunction(p) { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } }
function ensureScratch() {
  if (existsSync(SCRATCH)) return { mode: isJunction(SCRATCH) ? 'junction' : 'real', target: SCRATCH };
  const stable = process.env.PROMO_SCRATCH || path.join(os.homedir(), '.promo-scratch');
  mkdirSync(stable, { recursive: true });
  mkdirSync(path.dirname(SCRATCH), { recursive: true });
  if (process.platform === 'win32') execSync(`mklink /J "${SCRATCH.replace(/\//g, '\\')}" "${stable.replace(/\//g, '\\')}"`, { shell: 'cmd.exe', stdio: 'ignore' });
  else execSync(`ln -s "${stable}" "${SCRATCH}"`);
  return { mode: 'junction(created)', target: stable };
}

// ---- manifest stage metadata (engine / optional / markets filter), keyed by script path ----
function flatten(seq) {
  const out = [];
  for (const s of seq) {
    if (Array.isArray(s)) out.push(...flatten(s));
    else if (typeof s === 'string') out.push({ script: s, engine: 'python', optional: false, markets: null });
    else out.push({ engine: 'python', optional: false, markets: null, ...s });
  }
  return out;
}
const PERMARKET = flatten(MANIFEST.perMarket || []);
const SHARED = flatten(MANIFEST.shared || []);
const META = new Map([...PERMARKET, ...SHARED].map((s) => [s.script, s]));
const PM_SET = new Set(PERMARKET.map((s) => s.script));
const SH_SET = new Set(SHARED.map((s) => s.script));

const MARKETS = process.env.PROMO_REFRESH_MARKETS
  ? process.env.PROMO_REFRESH_MARKETS.split(',').map((s) => s.trim()).filter(Boolean)
  : (MANIFEST.markets || ['MY']);

function allowed(script, mk) {
  const m = META.get(script);
  return !m || !m.markets || m.markets.includes(mk);
}

// perMarket stages that IGNORE PROMO_MARKET and write BOTH -MY and -SG files on every pass
// (manifest _sg_caveats). Running MY's and SG's instance CONCURRENTLY makes two processes write the
// same file at once -> corrupt/partial JSON that a reader then fails to parse. So run each ONCE
// (a single node, one market's env is enough since it produces both files) instead of per-market.
const RUN_ONCE = new Set([
  'bin/who_targeted_pull.py', 'bin/segment_map_pull.py', 'bin/segment_migration_pull.py', 'bin/bonus_value_analysis.py',
]);

// ---- build the node graph ----
// node id: perMarket -> "<script>@<mk>", shared/run-once -> "<script>@shared"
const nodes = new Map();   // id -> { script, mk|null, engine, optional, deps:Set<id>, dependents:[], indeg }
function addNode(script, mk) {
  const id = mk ? `${script}@${mk}` : `${script}@shared`;
  if (nodes.has(id)) return id;
  const m = META.get(script) || { engine: 'python', optional: false };
  nodes.set(id, { id, script, mk: mk || null, engine: m.engine || 'python', optional: !!m.optional, deps: new Set(), dependents: [], indeg: 0 });
  return id;
}
for (const mk of MARKETS) for (const s of PERMARKET) {
  if (!allowed(s.script, mk)) continue;
  if (RUN_ONCE.has(s.script)) addNode(s.script, null);   // single shared node (writes both markets)
  else addNode(s.script, mk);
}
for (const s of SHARED) addNode(s.script, null);

function depNodeIds(script, mk) {
  // Resolve each DAG dependency (a script path) to concrete node id(s) in this run.
  const ids = [];
  for (const d of (DAG.deps[script] || [])) {
    if (RUN_ONCE.has(d)) {
      ids.push(`${d}@shared`);                                           // run-once -> its single node
    } else if (PM_SET.has(d)) {
      if (mk) { if (allowed(d, mk)) ids.push(`${d}@${mk}`); }            // perMarket->perMarket: same market
      else { for (const m of MARKETS) if (allowed(d, m)) ids.push(`${d}@${m}`); } // shared<-perMarket: every market
    } else if (SH_SET.has(d)) {
      ids.push(`${d}@shared`);
    }
  }
  return ids.filter((id) => nodes.has(id));
}
for (const n of nodes.values()) {
  for (const did of depNodeIds(n.script, n.mk)) {
    if (did === n.id) continue;
    if (!n.deps.has(did)) { n.deps.add(did); nodes.get(did).dependents.push(n.id); }
  }
}
for (const n of nodes.values()) n.indeg = n.deps.size;

// Priority: stages that transitively FEED the report (assemble_explorer_payload) are the
// critical path; pure side-deliverables (e.g. build_verify_xlsx — a leaf nothing depends on)
// run at lower priority so they never steal a concurrency slot from a report-critical stage.
const CRITICAL = new Set();
{
  const seed = [...nodes.values()].filter((n) => n.script.endsWith('assemble_explorer_payload.py'));
  const stack = seed.map((n) => n.id);
  while (stack.length) { const id = stack.pop(); if (CRITICAL.has(id)) continue; CRITICAL.add(id); for (const d of nodes.get(id).deps) stack.push(d); }
}
for (const n of nodes.values()) n.prio = CRITICAL.has(n.id) ? 0 : 1;   // 0 = report-critical first

// --report-only / PROMO_REPORT_ONLY=1: build ONLY the stages the report (assemble) needs, and
// publish the instant assemble finishes. The non-critical stages (ROI-over-time, attribution,
// moneyback, keeps, ggr, the verification xlsx) are side-deliverables / next-build inputs that
// this build's explorer-payload.json does not read — proven by the ground-truth I/O trace and by
// the parallel-vs-sequential reconcile — so skipping them yields a byte-identical report, faster.
// (The nightly full build runs everything; the custom "Generate" uses this fast path.)
const REPORT_ONLY = process.env.PROMO_REPORT_ONLY === '1' || process.argv.includes('--report-only');
if (REPORT_ONLY) {
  for (const id of [...nodes.keys()]) if (!CRITICAL.has(id)) nodes.delete(id);
  for (const n of nodes.values()) { n.deps = new Set([...n.deps].filter((d) => nodes.has(d))); n.dependents = n.dependents.filter((d) => nodes.has(d)); n.indeg = n.deps.size; }
}

// ---- dry-run: print waves ----
if (DRY) {
  log(`PARALLEL PLAN — ${nodes.size} nodes, markets ${MARKETS.join(',')}, cap ${CAP}`);
  const placed = new Set(); let rem = [...nodes.values()]; let w = 0;
  while (rem.length) {
    const ready = rem.filter((n) => [...n.deps].every((d) => placed.has(d)));
    if (!ready.length) { log(`  !! stuck: ${rem.map((n) => n.id).slice(0, 6)}`); break; }
    log(`WAVE ${w++} (${ready.length}): ${ready.map((n) => path.basename(n.script) + (n.mk ? ':' + n.mk : '')).join(', ')}`);
    ready.forEach((n) => placed.add(n.id)); rem = rem.filter((n) => !placed.has(n.id));
  }
  process.exit(0);
}

// ---- scheduler ----
const sc = ensureScratch();
log(`PORTABILITY: scratchpad ${sc.mode} -> ${sc.target}`);
const base = { ...process.env, PROMO_SCRATCH: sc.target, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
if (USE_STORES) {
  base.PROMO_PREAGG = process.env.PROMO_PREAGG || path.join(sc.target, 'preagg');
  // The ROI producer is compute-bound locally (not warehouse-bound), so more threads are free.
  base.ROI_CONCURRENCY = process.env.ROI_CONCURRENCY || '8';
}
log(`MARKETS: ${MARKETS.join(', ')} | nodes ${nodes.size} | cap ${CAP}${SEQ ? ' | SEQ-fallback' : ''}${USE_STORES ? ' | STORES (' + Object.keys(STORE_VARIANT).length + ' local)' : ''}`);

let running = 0, done = 0, firstErr = null;
const ready = [...nodes.values()].filter((n) => n.indeg === 0);
// SEQ fallback: emulate strict manifest order by forcing cap 1 and manifest-sorted ready pops.
const ORDER = [...PERMARKET, ...SHARED].map((s) => s.script);
const oix = (n) => ORDER.indexOf(n.script) * 10 + (n.mk ? MARKETS.indexOf(n.mk) : 9);

function runNode(n) {
  running++;
  const cmd = n.engine === 'node' ? 'node' : PY;
  // run-once (both-market) nodes get the first market's env; they write both files regardless.
  const env = n.mk ? { ...base, PROMO_MARKET: n.mk } : (RUN_ONCE.has(n.script) ? { ...base, PROMO_MARKET: MARKETS[0] } : base);
  const script = (USE_STORES && STORE_VARIANT[n.script]) || n.script;   // swap in the local twin
  log(`STAGE:${path.basename(n.script)}${n.mk ? ' [' + n.mk + ']' : ''}${script !== n.script ? ' (stores)' : ''}`);
  const ch = spawn(cmd, [script], { cwd: OUTER, env, stdio: ['ignore', 'inherit', 'inherit'] });
  const finish = (ok, why) => {
    running--; done++;
    if (!ok) {
      if (n.optional) log(`WARN: optional stage failed (${why}), continuing: ${n.script}`);
      else if (!firstErr) { firstErr = new Error(`stage failed (${why}): ${n.script}`); }
    }
    if (ok || n.optional) for (const dep of n.dependents) { const dn = nodes.get(dep); if (--dn.indeg === 0) ready.push(dn); }
    pump();
  };
  ch.on('error', (e) => finish(false, 'spawn ' + e.message));
  ch.on('close', (code) => finish(code === 0, 'exit ' + code));
}

function pump() {
  if (firstErr && running === 0) return settle();
  if (!firstErr) {
    if (SEQ) ready.sort((a, b) => oix(b) - oix(a)); // pop lowest manifest index first
    else ready.sort((a, b) => a.prio - b.prio);     // report-critical stages before side-deliverables
    while (running < (SEQ ? 1 : CAP) && ready.length) {
      const n = SEQ ? ready.pop() : ready.shift();
      runNode(n);
    }
  }
  if (running === 0 && (firstErr || ready.length === 0)) settle();
}

let settled = false;
function settle() {
  if (settled) return; settled = true;
  if (firstErr) { process.stderr.write(String(firstErr.message) + '\n'); process.exit(1); }
  if (done < nodes.size) { process.stderr.write(`DEADLOCK: ${done}/${nodes.size} ran (cyclic/missing dep)\n`); process.exit(1); }
  // publish
  const builtPath = path.join(sc.target, MANIFEST.reportOut || 'explorer-payload.json');
  log('STAGE:publish');
  if (!existsSync(builtPath)) { process.stderr.write(`report not produced: ${builtPath}\n`); process.exit(1); }
  mkdirSync(path.dirname(OUT), { recursive: true });
  copyFileSync(builtPath, OUT);
  log(`OUT:${OUT}`);
  log('STAGE:done');
  process.exit(0);
}

// ---- single build lock ------------------------------------------------------------------------
// Every build (custom Generate, nightly prebuild, manual run) shares ONE scratchpad, so two running
// at once corrupt each other's files. This serialises them: a build waits its turn, then runs alone.
// A lock older than LOCK_STALE_MS is a crashed build — stolen so a dead lock can never wedge the system.
const LOCK = path.join(process.env.PROMO_LOCK_DIR || path.join(os.homedir(), '.qc-relay'), 'promo-build.lock');
const LOCK_STALE_MS = 25 * 60 * 1000;
let haveLock = false;
async function acquireLock() {
  mkdirSync(path.dirname(LOCK), { recursive: true });
  const giveUp = Date.now() + LOCK_STALE_MS + 120000;
  let waited = false;
  for (;;) {
    try {
      const fd = openSync(LOCK, 'wx');   // exclusive create — fails if another build holds it
      writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`); closeSync(fd); haveLock = true;
      if (waited) log('build lock acquired (waited for another build)');
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let age; try { age = Date.now() - statSync(LOCK).mtimeMs; } catch { continue; }   // lock vanished → retry
      if (age > LOCK_STALE_MS || Date.now() > giveUp) { try { unlinkSync(LOCK); } catch {} continue; }  // stale → steal
      if (!waited) { log('another build is running — waiting for the build lock…'); waited = true; }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
function releaseLock() { if (haveLock) { try { unlinkSync(LOCK); } catch {} haveLock = false; } }
process.on('exit', releaseLock);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { releaseLock(); process.exit(1); });

acquireLock().then(() => pump());
