#!/usr/bin/env node
/**
 * Structural health check for backlog codes with no captured qc-bundle —
 * the "no answer key" half of the QC watchman (see
 * docs/promo-monitoring-system-proposal.md, Phase 1 extension). These codes
 * can't be Sentinel-audited against original intent because no original
 * request was ever captured, so this runs a smaller set of checks that are
 * self-evidently right or wrong from the live BO record alone — no LLM
 * agent, no per-code cost, safe to run over thousands of rows.
 *
 * Checks (deliberately conservative — false alarms erode trust in the
 * automated queue faster than they're worth):
 *
 *   IGMP (WS1/WS2):
 *     - Duplicate reward name among other currently-active promos on the
 *       same site (the exact bug found and fixed on WS2 earlier — Manual
 *       Reward Assignment can't tell two same-named rewards apart).
 *     - Expired but still flagged active (PromotionEndDate < today, IsActive=true).
 *
 *   QPRO/QP2 (fields already present on the list response — zero extra
 *   fetches needed):
 *     - Category set but provider not (or vice versa) — violates the
 *       documented "both or neither" rule.
 *     - Expired but still flagged active (valid_to < today, status=1).
 *     - No message template attached (soft signal — WARNING, not FAIL).
 *
 * Input: JSON from find-qc-sweep-candidates.mjs --mode=weekly, piped via
 * stdin or read from --input=<file>. Only the `noBundle` array is used.
 *
 * Usage:
 *   node bin/find-qc-sweep-candidates.mjs --mode=weekly | node bin/check-structural-health.mjs [--commit]
 *   node bin/check-structural-health.mjs --input=sweep.json [--commit]
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from './_args.js';
import { igmpPost } from '../src/igmp-client.js';
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';
import { upsertRows } from '../src/qc-results-log.js';
import {
  checkCategoryNoProvider, checkExpiredActiveQproQp2, checkMessageTemplatePresence,
  checkIgmpExpiredActive, checkIgmpDuplicateName, verdictFromFindings,
} from '../src/structural-checks.js';

const { flags } = parseArgs(process.argv.slice(2));
const commit = flags.commit === true;

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const raw = flags.input ? readFileSync(flags.input, 'utf8') : await readStdin();
let sweep;
try { sweep = JSON.parse(raw); } catch (e) {
  console.error(`Could not parse input as JSON: ${e.message}`);
  console.error('Pipe output from: node bin/find-qc-sweep-candidates.mjs --mode=weekly');
  process.exit(2);
}
const noBundle = sweep.noBundle || [];
if (!noBundle.length) {
  console.log('No noBundle candidates in input — nothing to check.');
  process.exit(0);
}

const igmpCandidates = noBundle.filter((c) => c.platform === 'igmp');
const qproQp2Candidates = noBundle.filter((c) => c.platform === 'qpro' || c.platform === 'qp2');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`STRUCTURAL HEALTH CHECK — ${noBundle.length} candidates (${igmpCandidates.length} IGMP, ${qproQp2Candidates.length} QPRO/QP2)`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const findings = []; // { code, brand, verdict, reasons: [] }

// ── IGMP: fresh full-site pull for real peer visibility (duplicate names   ──
// ── must be checked against the WHOLE site, not just this week's batch)   ──
const igmpSitesNeeded = [...new Set(igmpCandidates.map((c) => c.siteId))];
const TODAY = new Date();

for (const siteId of igmpSitesNeeded) {
  console.log(`\nFetching full site list for ${siteId} (peer visibility for duplicate-name check)…`);
  const all = [];
  let pg = 1;
  while (true) {
    const d = await igmpPost(siteId, `/PM/GetPromotionsList?pageNum=${pg}&rowPerPage=200`, { Status: 1 });
    const raw2 = d?.data;
    const list = Array.isArray(raw2) ? raw2 : (raw2?.data || raw2?.List || raw2?.list || []);
    if (!Array.isArray(list) || !list.length) break;
    all.push(...list);
    if (list.length < 200) break;
    pg++;
  }
  const active = all.filter((p) => p.IsActive && !p.IsExpired && p.PromotionType === 'Bonus');
  const nameCounts = new Map();
  for (const p of active) nameCounts.set(p.PromotionName, (nameCounts.get(p.PromotionName) || 0) + 1);
  const nameCountBySite = new Map([[siteId, nameCounts]]);
  const byCode = new Map(all.map((p) => [p.PromotionCode, p]));

  for (const cand of igmpCandidates.filter((c) => c.siteId === siteId)) {
    const p = byCode.get(cand.code);
    if (!p) { findings.push({ ...cand, verdict: 'INCONCLUSIVE', reasons: ['code not found in fresh BO pull — may have been deactivated/renamed since sweep started'] }); continue; }
    const checkResults = [
      ...checkIgmpDuplicateName({ siteId, name: p.PromotionName, promotionType: p.PromotionType }, nameCountBySite),
      ...(p.IsActive ? checkIgmpExpiredActive({ endDate: p.PromotionEndDate }, TODAY) : []),
    ];
    findings.push({ ...cand, verdict: verdictFromFindings(checkResults), reasons: checkResults.map((r) => r.message) });
  }
}

// ── QPRO/QP2: everything needed was already carried on the candidate ────────
for (const cand of qproQp2Candidates) {
  const checkResults = [
    ...checkCategoryNoProvider(cand),
    ...checkExpiredActiveQproQp2(cand, TODAY),
    ...checkMessageTemplatePresence(cand),
  ];
  findings.push({ ...cand, verdict: verdictFromFindings(checkResults), reasons: checkResults.map((r) => r.message) });
}

// ── Report ────────────────────────────────────────────────────────────────
const byVerdict = { PASS: 0, WARNING: 0, FAIL: 0, INCONCLUSIVE: 0 };
for (const f of findings) byVerdict[f.verdict]++;
console.log(`\nResults: ${findings.length} checked — PASS ${byVerdict.PASS} · WARNING ${byVerdict.WARNING} · FAIL ${byVerdict.FAIL} · INCONCLUSIVE ${byVerdict.INCONCLUSIVE}\n`);
for (const f of findings.filter((f) => f.verdict !== 'PASS')) {
  console.log(`  [${f.verdict}] ${f.brand} / ${f.code}`);
  for (const r of f.reasons) console.log(`      - ${r}`);
}

// ── Log to QC Results Log (bulk) ─────────────────────────────────────────
const entries = findings.map((f) => ({
  code: f.code,
  brand: f.brand,
  region: f.region || '',
  stage: 'sentinel',
  verdict: f.verdict,
  trigger: 'weekly-sweep',
  depth: 'structural',
  reason: f.reasons.join(' | '),
}));

if (!commit) {
  console.log(`\nDry-run only. Re-run with --commit to write ${entries.length} row(s) to QC Results Log.`);
  process.exit(0);
}

const { sheets } = await getSheetsClient();
const OPS_ID = getOpsSheetId();
const { committed } = await upsertRows(sheets, OPS_ID, entries, { commit: true });
console.log(`\n✓ Committed ${committed.updateCount} update(s), ${committed.appendCount} append(s) to QC Results Log`);
