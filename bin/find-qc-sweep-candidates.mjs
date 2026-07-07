#!/usr/bin/env node
/**
 * Enumerate promo codes that need an automatic Sentinel check — the
 * "watchman" half of Phase 1 (see docs/promo-monitoring-system-proposal.md).
 * Two independent sweeps, run by two separate scheduled tasks:
 *
 *   --mode=post-creation   Codes saved via the canary in the last N minutes
 *                          (default 90) that haven't had a Sentinel check yet.
 *                          Cheap: reads local qc-bundle files, no BO calls.
 *
 *   --mode=weekly          Every currently-live code across every brand,
 *                          split into:
 *                            - hasBundle   → eligible for a full Sentinel
 *                              audit (source vs live_state) — same method
 *                              /deep-qc already uses.
 *                            - noBundle    → backlog/manually-created code,
 *                              no captured original request to compare
 *                              against. Eligible only for a lighter
 *                              structural health check.
 *                          A code counts as "already checked recently" if
 *                          its last Sentinel check (any trigger) in the
 *                          QC Results Log is within --stale-after days
 *                          (default 7).
 *
 * Output is JSON to stdout — this script only decides WHAT to check, not
 * HOW. The caller (a scheduled Claude Code session) reads the list, spawns
 * Sentinel per hasBundle candidate / runs the structural checker per
 * noBundle candidate, then calls bin/log-qc-result.mjs per result.
 *
 * Usage:
 *   node bin/find-qc-sweep-candidates.mjs --mode=post-creation [--minutes=90]
 *   node bin/find-qc-sweep-candidates.mjs --mode=weekly [--stale-after=7]
 */
import { parseArgs } from './_args.js';
import { fetchAllLiveCodes, buildBundleIndex, readQcResultsLog } from '../src/live-codes.js';

const { flags } = parseArgs(process.argv.slice(2));
const mode = flags.mode;
if (!['post-creation', 'weekly'].includes(mode)) {
  console.error('usage: find-qc-sweep-candidates.mjs --mode=post-creation|weekly [--minutes=90] [--stale-after=7]');
  process.exit(2);
}

// ── mode: post-creation ──────────────────────────────────────────────────
if (mode === 'post-creation') {
  const minutes = Number(flags.minutes || 90);
  const cutoff = Date.now() - minutes * 60 * 1000;
  const bundleIndex = buildBundleIndex();
  const qcLog = await readQcResultsLog();

  const candidates = [];
  for (const [key, { handle, savedAtMs, file }] of bundleIndex) {
    if (savedAtMs < cutoff) continue;
    const [brand, code] = key.split('::');
    const logged = qcLog.get(key);
    const alreadyChecked = logged?.checkTrigger === 'post-creation' || logged?.checkTrigger === 'manual';
    if (alreadyChecked) continue;
    candidates.push({ brand, code, handle, bundleFile: file, savedAt: new Date(savedAtMs).toISOString(), hasBundle: true });
  }
  console.log(JSON.stringify({ mode, minutes, candidateCount: candidates.length, candidates }, null, 2));
  process.exit(0);
}

// ── mode: weekly ──────────────────────────────────────────────────────────
if (mode === 'weekly') {
  const staleAfterDays = Number(flags['stale-after'] || 7);
  const staleCutoff = Date.now() - staleAfterDays * 24 * 60 * 60 * 1000;

  console.error('Fetching live codes across all brands…');
  const [{ codes: liveCodes, siteErrors }, bundleIndex, qcLog] = await Promise.all([
    fetchAllLiveCodes(),
    Promise.resolve(buildBundleIndex()),
    readQcResultsLog(),
  ]);
  for (const se of siteErrors) console.error(`  ⚠ ${se.brand}: ${se.message}`);
  console.error(`  ${liveCodes.length} live codes found.`);

  const hasBundle = [];
  const noBundle = [];
  for (const liveCode of liveCodes) {
    const { brand, code } = liveCode;
    const key = `${brand}::${code}`;
    const logged = qcLog.get(key);
    const isFresh = logged?.lastCheckedAt && logged.lastCheckedAt > staleCutoff;
    if (isFresh) continue; // checked recently enough — skip this sweep

    const bundleHit = bundleIndex.get(key);
    const lastCheckedAt = logged?.lastCheckedAt || 0; // never-checked sorts first
    if (bundleHit) {
      hasBundle.push({ ...liveCode, handle: bundleHit.handle, bundleFile: bundleHit.file, lastCheckedAt });
    } else {
      noBundle.push({ ...liveCode, lastCheckedAt });
    }
  }

  // Cap + rotate: the noBundle backlog (thousands of codes, no LLM-worthy
  // "answer key" to check against) gets a fixed-size batch per run, oldest
  // (or never-)checked first. Once a code is checked, its Timestamp in QC
  // Results Log moves to "now" and it naturally rotates to the back of the
  // queue next run — no separate position/cursor file needed.
  const noBundleCap = Number(flags['no-bundle-cap'] || 1000);
  const noBundleTotal = noBundle.length;
  noBundle.sort((a, b) => a.lastCheckedAt - b.lastCheckedAt);
  const noBundleBatch = noBundle.slice(0, noBundleCap).map(({ lastCheckedAt, ...rest }) => rest);
  const hasBundleOut = hasBundle.map(({ lastCheckedAt, ...rest }) => rest);

  console.log(JSON.stringify({
    mode, staleAfterDays,
    liveCodeCount: liveCodes.length,
    hasBundleCount: hasBundleOut.length,
    noBundleTotal,
    noBundleCap,
    noBundleBatchCount: noBundleBatch.length,
    noBundleFullRotationRuns: Math.ceil(noBundleTotal / noBundleCap),
    hasBundle: hasBundleOut,
    noBundle: noBundleBatch,
  }, null, 2));
  process.exit(0);
}
