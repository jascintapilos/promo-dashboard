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
function parseDdmmyyyy(s) {
  const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`) : null;
}

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
  const active = all.filter((p) => p.IsActive && !p.IsExpired);
  const byName = new Map();
  for (const p of active) {
    if (!byName.has(p.PromotionName)) byName.set(p.PromotionName, []);
    byName.get(p.PromotionName).push(p);
  }
  const byCode = new Map(all.map((p) => [p.PromotionCode, p]));

  for (const cand of igmpCandidates.filter((c) => c.siteId === siteId)) {
    const p = byCode.get(cand.code);
    const reasons = [];
    if (!p) { findings.push({ ...cand, verdict: 'INCONCLUSIVE', reasons: ['code not found in fresh BO pull — may have been deactivated/renamed since sweep started'] }); continue; }
    const dupes = byName.get(p.PromotionName) || [];
    if (dupes.length > 1) {
      reasons.push(`PromotionName "${p.PromotionName}" shared with ${dupes.length - 1} other active promo(s) on this site — Reward Assignment dropdown can't distinguish them`);
    }
    const end = parseDdmmyyyy(p.PromotionEndDate);
    if (p.IsActive && end && end < TODAY) {
      reasons.push(`Flagged active but PromotionEndDate (${p.PromotionEndDate}) has already passed`);
    }
    findings.push({ ...cand, verdict: reasons.length ? 'FAIL' : 'PASS', reasons });
  }
}

// ── QPRO/QP2: everything needed was already carried on the candidate ────────
for (const cand of qproQp2Candidates) {
  const reasons = [];
  const catSet = cand.category && cand.category !== '-' && cand.category !== '';
  const provSet = cand.gameProvider && cand.gameProvider !== '-' && cand.gameProvider !== '';
  if (catSet !== provSet) {
    reasons.push(`Category (${cand.category || '—'}) and Game Provider (${cand.gameProvider || '—'}) inconsistent — must both be restricted or both left open`);
  }
  if (cand.validTo && cand.status === 1) {
    const validTo = new Date(cand.validTo);
    if (validTo < TODAY) reasons.push(`Flagged active but valid_to (${cand.validTo}) has already passed`);
  }
  const findingVerdict = reasons.length ? 'FAIL' : 'PASS';
  if (!cand.messageTemplateCount) {
    reasons.push('No message template attached');
  }
  findings.push({ ...cand, verdict: reasons.length && findingVerdict === 'PASS' ? 'WARNING' : findingVerdict, reasons });
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
