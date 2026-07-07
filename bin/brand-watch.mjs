#!/usr/bin/env node
/**
 * Brand Watch — daily 5pm per-brand estate monitor (Wave 1: listing-level).
 * See docs/promo-monitoring-system-proposal.md + advisor review 2026-07-07.
 *
 * Walks every live promo across all brands (QPRO1-17, QP2A-D, WS1 regions,
 * WS2) using ~25 list pulls total and runs, daily estate-wide:
 *
 *   FAIL     category restricted + providers open (QPRO/QP2)
 *            duplicate active Bonus PromotionName (IGMP)
 *            currencies wiped (QPRO/QP2)
 *            foreign brand domain in MT body / literal domain on QP2
 *            (MT bodies ride the list response — zero extra fetches)
 *   WARNING  message template missing · dialog popup missing (QPRO/QP2)
 *
 * Plus a capped IGMP reward-contents rotation (Wave 3): --igmp-detail-cap
 * (default 250) Bonus/FC promos per run, never-checked first, 2 GETs each:
 *   FAIL     QPRO 8-clause "Refresh button" template leak on WS1/WS2
 *   WARNING  reward T&C contents empty (wipe-bug signature, uncalibrated)
 * A promo's FIRST detail check grandfathers its findings (rolling baseline).
 *
 * Baseline + delta model (trust protection — the estate has known legacy
 * findings; day one must not scream):
 *   - First run writes captures/brand-watch-state.json and logs only
 *     baseline FAILs to the QC Results Log (reason prefixed "[baseline]").
 *     Baseline WARNINGs are held in the state file only — they surface later
 *     if they CHANGE, which is the actual signal (e.g. a popup disappearing
 *     is the documented PUT-wipe bug; a popup never having existed is not).
 *   - Later runs log only deltas: NEW findings, CHANGED findings, and
 *     RESOLVED (previously-flagged code now clean → PASS row).
 *   - Unchanged findings and never-flagged clean codes write nothing.
 *
 * Every run ends with a System Status heartbeat row (via
 * bin/record-pull-status.mjs) — including zero-finding runs — so a silently
 * dead watchman is visible within a day. Sites that fail to list are
 * reported as PARTIAL and their previously-flagged entries are NOT marked
 * resolved (no evidence ≠ fixed).
 *
 * Usage:
 *   node bin/brand-watch.mjs             # dry-run (no sheet writes, no state save)
 *   node bin/brand-watch.mjs --commit    # live: log deltas + save state + heartbeat
 *   node bin/brand-watch.mjs --commit --dashboard   # + delta digest to dashboard feed
 *   node bin/brand-watch.mjs --commit --dashboard --slack --slack-channel=C...
 *   node bin/brand-watch.mjs --commit --max-rows=300
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseArgs } from './_args.js';
import { fetchAllLiveCodes } from '../src/live-codes.js';
import { runListingChecks, buildIgmpNameCounts, verdictFromFindings } from '../src/structural-checks.js';
import { checkMtContent, buildDomainToBrand } from '../src/mt-content-checks.js';
import { igmpPost } from '../src/igmp-client.js';
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';
import { upsertRows } from '../src/qc-results-log.js';
import { postToSlack, appendDashboardNotification } from '../src/notify.js';

const { flags } = parseArgs(process.argv.slice(2));
const commit = flags.commit === true;
const maxRows = Number(flags['max-rows'] || 300);
const postDashboard = flags.dashboard === true;
const postSlack = flags.slack === true;
const STATE_FILE = 'captures/brand-watch-state.json';

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`BRAND WATCH — daily listing-level estate pass ${commit ? '(LIVE)' : '(dry-run)'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// ── 1. Enumerate the estate ────────────────────────────────────────────────
console.log('\nFetching live codes across all brands…');
const { codes, siteErrors } = await fetchAllLiveCodes();
for (const se of siteErrors) console.log(`  ⚠ ${se.brand}: ${se.message}`);
console.log(`  ${codes.length} live codes across ${new Set(codes.map((c) => c.brand)).size} brands (${siteErrors.length} site(s) failed)`);
if (!codes.length) {
  console.error('No live codes fetched at all — refusing to run (would mark the whole estate resolved).');
  if (commit) recordStatus('FAILED', 'no live codes fetched — all sites unreachable?');
  process.exit(1);
}

// ── 2. Run checks ──────────────────────────────────────────────────────────
const TODAY = new Date();
const nameCountBySite = buildIgmpNameCounts(codes);
const domainToBrand = buildDomainToBrand();
const current = new Map(); // key -> { cand, verdict, reasons, checks }
const checkCounts = {};
for (const cand of codes) {
  const results = [
    ...runListingChecks(cand, { today: TODAY, nameCountBySite }),
    // MT bodies ride the list response on QPRO/QP2 — content checks are free.
    ...(cand.platform === 'igmp' ? [] : checkMtContent(cand, { domainToBrand })),
  ];
  if (!results.length) continue;
  for (const r of results) checkCounts[r.check] = (checkCounts[r.check] || 0) + 1;
  current.set(`${cand.brand}::${cand.code}`, {
    cand,
    verdict: verdictFromFindings(results),
    reasons: results.map((r) => r.message),
    checks: results.map((r) => r.check),
  });
}

// ── 3. Diff against state (baseline on first run) ──────────────────────────
const prior = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : null;
const isBaselineRun = !prior;
const priorEntries = prior?.entries || {};
const nowIso = new Date().toISOString();

// Brands we could not list this run — hold their prior findings as-is.
const failedBrands = new Set(siteErrors.map((se) => se.brand.split('/')[0]));
const liveKeys = new Set(codes.map((c) => `${c.brand}::${c.code}`));

const newFindings = [];      // first time flagged (or baseline)
const changedFindings = [];  // flagged before, different reasons/verdict now
const backlogFindings = [];  // unchanged but never yet written (deferred by an earlier row cap)
const resolved = [];         // flagged before, code still live, now clean
const detailBaselineQueue = []; // rolling-baseline FAILs from first-time detail checks
const nextEntries = {};

for (const [key, f] of current) {
  const prev = priorEntries[key];
  const signature = `${f.verdict}::${f.reasons.join('|')}`;
  const changed = prev && prev.signature !== signature;
  // Baseline WARNINGs are held in state only — they surface if they CHANGE.
  const held = prev ? (Boolean(prev.held) && !changed) : (isBaselineRun && f.verdict === 'WARNING');
  nextEntries[key] = {
    verdict: f.verdict, reasons: f.reasons, signature, held,
    baseline: prev ? Boolean(prev.baseline) : isBaselineRun,
    logged: changed ? false : Boolean(prev?.logged),
    firstSeen: prev?.firstSeen || nowIso, lastSeen: nowIso,
  };
  if (!prev) newFindings.push({ key, ...f });
  else if (changed) changedFindings.push({ key, ...f, prevSignature: prev.signature });
  else if (!prev.logged && !held) backlogFindings.push({ key, ...f }); // capped out of an earlier run — still owed a row
}

for (const [key, prev] of Object.entries(priorEntries)) {
  if (current.has(key)) continue;
  const brand = key.split('::')[0];
  if (failedBrands.has(brand)) { nextEntries[key] = prev; continue; } // no evidence ≠ fixed
  if (!liveKeys.has(key)) continue; // code no longer live — drop silently, nothing to verify
  if (prev.logged) resolved.push({ key, prev }); // only close out rows that were actually opened
}

// ── 3b. IGMP reward-contents rotation (detail fetches, capped) ──────────────
// The only Wave 3 checks that need per-promo fetches: 2 GETs per promo
// (Bonus/FC detail → RewardId → GetPromotionRewardContents). Rotates
// never-checked-first / oldest-checked-next through the IGMP estate; a
// promo's FIRST detail check grandfathers its findings (rolling baseline)
// so working through the backlog never screams in the digest.
const detailCap = Number(flags['igmp-detail-cap'] ?? 250);
const priorDetail = prior?.detailEntries || {};
const priorDetailChecked = prior?.detailChecked || {};
const nextDetail = {};
const detailChecked = { ...priorDetailChecked };
const detailStats = { checked: 0, firstCheck: 0, errors: 0, grandfathered: 0 };
const checkedToday = new Set();

const igmpBatch = codes
  .filter((c) => c.platform === 'igmp' && (c.promotionType === 'Bonus' || c.promotionType === 'FreeCredit') && !failedBrands.has(c.brand))
  .map((c) => ({ c, key: `${c.brand}::${c.code}`, last: priorDetailChecked[`${c.brand}::${c.code}`] || '' }))
  .sort((a, b) => a.last.localeCompare(b.last)) // never-checked ('') first, then oldest
  .slice(0, detailCap);

if (igmpBatch.length) {
  console.log(`\nIGMP reward-contents rotation: checking ${igmpBatch.length} promo(s) (cap ${detailCap})…`);
  for (const { c: cand, key } of igmpBatch) {
    let findings;
    try { findings = await igmpRewardContentChecks(cand); }
    catch { detailStats.errors++; continue; } // not marked checked — retries next run
    detailChecked[key] = nowIso;
    checkedToday.add(key);
    detailStats.checked++;
    const firstCheck = !priorDetailChecked[key];
    if (firstCheck) detailStats.firstCheck++;
    const prev = priorDetail[key];
    if (findings.length) {
      for (const r of findings) checkCounts[r.check] = (checkCounts[r.check] || 0) + 1;
      const verdict = verdictFromFindings(findings);
      const reasons = findings.map((r) => r.message);
      const signature = `${verdict}::${reasons.join('|')}`;
      const changed = prev && prev.signature !== signature;
      const isRollingBaseline = !prev && firstCheck;
      const held = prev ? (Boolean(prev.held) && !changed) : (isRollingBaseline && verdict === 'WARNING');
      nextDetail[key] = {
        verdict, reasons, signature, held,
        baseline: prev ? Boolean(prev.baseline) : isRollingBaseline,
        logged: changed ? false : Boolean(prev?.logged),
        firstSeen: prev?.firstSeen || nowIso, lastSeen: nowIso,
      };
      const item = { key, verdict, reasons, ns: 'detail', region: cand.region || '' };
      if (isRollingBaseline) { detailStats.grandfathered++; if (!held) detailBaselineQueue.push(item); }
      else if (!prev) newFindings.push(item);
      else if (changed) changedFindings.push(item);
      else if (!prev.logged && !held) backlogFindings.push(item);
    } else if (prev?.logged) {
      resolved.push({ key, prev, ns: 'detail' });
    }
  }
  console.log(`  ${detailStats.checked} checked (${detailStats.firstCheck} first-time, ${detailStats.grandfathered} grandfathered finding(s), ${detailStats.errors} fetch error(s))`);
}
// Carry forward detail findings for promos not re-checked today.
for (const [key, prev] of Object.entries(priorDetail)) {
  if (nextDetail[key] || checkedToday.has(key)) continue;
  if (!liveKeys.has(key)) continue; // promo gone — drop
  nextDetail[key] = prev;
}

// ── 4. Report ──────────────────────────────────────────────────────────────
const counts = { FAIL: 0, WARNING: 0 };
for (const f of current.values()) counts[f.verdict]++;
console.log(`\nFindings across estate: ${current.size} (${counts.FAIL} FAIL, ${counts.WARNING} WARNING)`);
console.log(`  By check: ${Object.entries(checkCounts).map(([k, v]) => `${k}=${v}`).join(' · ') || 'none'}`);

// Full findings report for baseline review / digest tooling — every run.
mkdirSync('captures', { recursive: true });
writeFileSync('captures/brand-watch-report.json', JSON.stringify({
  runAt: nowIso, isBaselineRun, liveCodes: codes.length, siteErrors, checkCounts, detailStats,
  findings: [...current.entries()].map(([key, f]) => ({ key, verdict: f.verdict, checks: f.checks, reasons: f.reasons })),
  detailFindings: [...checkedToday].filter((k) => nextDetail[k]).map((k) => ({ key: k, verdict: nextDetail[k].verdict, reasons: nextDetail[k].reasons })),
}, null, 2));
console.log('  Full findings report → captures/brand-watch-report.json');
console.log(isBaselineRun
  ? '  FIRST RUN — everything above becomes the grandfathered baseline.'
  : `  Delta vs last run: ${newFindings.length} new, ${changedFindings.length} changed, ${resolved.length} resolved${backlogFindings.length ? `, ${backlogFindings.length} still owed from earlier caps` : ''}.`);

const show = (label, list) => {
  if (!list.length) return;
  console.log(`\n${label}:`);
  for (const { key, verdict, reasons } of list.slice(0, 40)) {
    console.log(`  [${verdict}] ${key.replace('::', ' / ')}`);
    for (const r of reasons) console.log(`      - ${r}`);
  }
  if (list.length > 40) console.log(`  … and ${list.length - 40} more`);
};
if (isBaselineRun) {
  show('Baseline FAILs (will be logged with [baseline] marker)', newFindings.filter((f) => f.verdict === 'FAIL'));
  console.log(`\nBaseline WARNINGs held in state only (not logged): ${newFindings.filter((f) => f.verdict === 'WARNING').length}`);
} else {
  show('NEW findings', newFindings);
  show('CHANGED findings', changedFindings);
  if (resolved.length) console.log(`\nRESOLVED: ${resolved.map((r) => r.key.replace('::', ' / ')).join(', ')}`);
}

// ── 5. Build QC Results Log entries ────────────────────────────────────────
const toEntry = ({ key, verdict, reasons, region }, reasonPrefix = '') => {
  const [brand, code] = key.split('::');
  return {
    code, brand, region: region ?? current.get(key)?.cand?.region ?? '', stage: 'sentinel', verdict,
    trigger: 'daily-watch', depth: 'structural',
    reason: reasonPrefix + reasons.join(' | '),
  };
};
const stateFor = (f) => (f.ns === 'detail' ? nextDetail : nextEntries);
const mkQ = (f, prefix = '') => ({ key: f.key, ns: f.ns || 'listing', entry: toEntry(f, prefix) });

// Everything queued carries its state key + namespace so we can mark
// logged=true only for rows that actually get written this run.
let queue;
if (isBaselineRun) {
  queue = [
    ...newFindings.filter((f) => f.verdict === 'FAIL' && f.ns !== 'detail').map((f) => mkQ(f, '[baseline] ')),
    ...detailBaselineQueue.map((f) => mkQ(f, '[baseline] ')),
  ];
} else {
  queue = [
    ...newFindings.map((f) => mkQ(f, stateFor(f)[f.key]?.baseline ? '[baseline] ' : '')),
    ...changedFindings.map((f) => mkQ(f)),
    ...backlogFindings.map((f) => mkQ(f, stateFor(f)[f.key]?.baseline ? '[baseline] ' : '')),
    ...detailBaselineQueue.map((f) => mkQ(f, '[baseline] ')),
    ...resolved.map(({ key, ns }) => {
      const [brand, code] = key.split('::');
      return { key, ns: ns || 'listing', entry: { code, brand, region: '', stage: 'sentinel', verdict: 'PASS', trigger: 'daily-watch', depth: 'structural', reason: `resolved ${nowIso.slice(0, 10)}` } };
    }),
  ];
}

// No silent caps — deferred rows keep logged=false in state and re-queue
// every run until written, FAILs and resolutions first.
queue.sort((a, b) => (a.entry.verdict === 'WARNING' ? 1 : 0) - (b.entry.verdict === 'WARNING' ? 1 : 0));
const dropped = Math.max(0, queue.length - maxRows);
if (dropped) {
  console.log(`\n⚠ Row cap: logging first ${maxRows} of ${queue.length} entries (FAILs/resolutions first) — ${dropped} deferred, they re-queue next run until written.`);
  queue = queue.slice(0, maxRows);
}
const entries = queue.map((q) => q.entry);

// ── 6. Digest (Wave 2) — one summary per run, fired on completion ──────────
// Posted only when there is something to say: the baseline announcement, or
// any post-baseline delta. Quiet days post nothing — the System Status
// heartbeat is the aliveness signal, the digest is the "look at this" signal.
const digestNeeded = isBaselineRun || newFindings.length > 0 || changedFindings.length > 0 || resolved.length > 0;
const anyDeltaFail = [...newFindings, ...changedFindings].some((f) => f.verdict === 'FAIL');

function buildDigest() {
  if (isBaselineRun) {
    return {
      type: 'info',
      title: 'Brand Watch — baseline created',
      lines: [
        `${codes.length} live codes across the estate scanned (${Object.entries(checkCounts).map(([k, v]) => `${k}=${v}`).join(', ') || 'no findings'}).`,
        `${entries.length} baseline FAIL(s) logged to QC Results Log ([baseline] marker); ${newFindings.filter((f) => f.verdict === 'WARNING').length} warning(s) grandfathered in state.`,
        'From tomorrow, only NEW / CHANGED / RESOLVED findings are reported.',
      ],
    };
  }
  const lines = [];
  const detail = (f) => `[${f.verdict}] ${f.key.replace('::', ' / ')} — ${f.reasons.join('; ')}`;
  const ranked = [...newFindings, ...changedFindings].sort((a, b) => (a.verdict === 'FAIL' ? 0 : 1) - (b.verdict === 'FAIL' ? 0 : 1));
  for (const f of ranked.slice(0, 12)) lines.push(`${newFindings.includes(f) ? 'NEW' : 'CHANGED'} ${detail(f)}`);
  if (ranked.length > 12) lines.push(`…and ${ranked.length - 12} more — see QC Results Log (trigger=daily-watch)`);
  if (resolved.length) lines.push(`Resolved: ${resolved.length} previously-flagged promo(s) now clean.`);
  if (detailStats.checked) lines.push(`IGMP rotation: ${detailStats.checked} reward-contents checked (${detailStats.firstCheck} first-time, ${detailStats.grandfathered} grandfathered).`);
  if (siteErrors.length) lines.push(`⚠ Partial run: ${siteErrors.map((se) => se.brand).join(', ')} unreachable — their findings held, not re-checked.`);
  return {
    type: anyDeltaFail ? 'warning' : 'info',
    title: `Brand Watch — ${newFindings.length} new, ${changedFindings.length} changed, ${resolved.length} resolved`,
    lines,
  };
}

// ── 7. Commit ──────────────────────────────────────────────────────────────
const statusLabel = siteErrors.length ? 'PARTIAL' : 'OK';
const detail = `${codes.length} live · ${current.size} open findings (${counts.FAIL} FAIL) · ${isBaselineRun ? `baseline run, ${entries.length} FAIL rows logged` : `${newFindings.length} new, ${changedFindings.length} changed, ${resolved.length} resolved`}${detailStats.checked ? ` · rotation ${detailStats.checked} checked` : ''}${dropped ? ` · ${dropped} rows deferred` : ''}${siteErrors.length ? ` · ${siteErrors.length} site(s) unreachable` : ''}`;

if (!commit) {
  console.log(`\nDry-run only. Would write ${entries.length} QC Results Log row(s), save state, and record heartbeat:`);
  console.log(`  System Status → brand-watch | ${statusLabel} | ${detail}`);
  if (digestNeeded) {
    const d = buildDigest();
    console.log(`  Digest (${d.type}): ${d.title}`);
    for (const l of d.lines) console.log(`    ${l}`);
  } else {
    console.log('  Digest: nothing to report — would not post.');
  }
  process.exit(0);
}

if (entries.length) {
  const { sheets } = await getSheetsClient();
  const OPS_ID = getOpsSheetId();
  const { committed } = await upsertRows(sheets, OPS_ID, entries, { commit: true });
  console.log(`\n✓ QC Results Log: ${committed.updateCount} update(s), ${committed.appendCount} append(s)`);
  for (const { key, ns } of queue) {
    const store = ns === 'detail' ? nextDetail : nextEntries;
    if (store[key]) store[key].logged = true;
  }
} else {
  console.log('\n✓ No deltas — nothing to log (clean day).');
}

mkdirSync('captures', { recursive: true });
writeFileSync(STATE_FILE, JSON.stringify({
  createdAt: prior?.createdAt || nowIso, lastRunAt: nowIso,
  entries: nextEntries,
  detailEntries: nextDetail,
  detailChecked,
}, null, 2));
console.log(`✓ State saved → ${STATE_FILE} (${Object.keys(nextEntries).length} open findings tracked)`);

// Digest posts must not abort the run — the heartbeat still needs to land.
if ((postDashboard || postSlack) && !digestNeeded) {
  console.log('Digest: nothing to report — skipping post (heartbeat still recorded).');
} else if (digestNeeded) {
  const d = buildDigest();
  if (postDashboard) {
    try {
      await appendDashboardNotification({ type: d.type, title: d.title, message: d.lines.join('\n'), source: 'brand-watch' });
      console.log('✓ Digest appended to dashboard Notifications feed');
    } catch (e) { console.error(`⚠ Dashboard digest failed: ${e.message.split('\n')[0]}`); }
  }
  if (postSlack) {
    const channel = flags['slack-channel'] || process.env.SLACK_ALERT_CHANNEL;
    if (!channel) console.error('⚠ --slack requires --slack-channel=C... or SLACK_ALERT_CHANNEL');
    else {
      try {
        await postToSlack(channel, [`*${d.title}*`, ...d.lines.map((l) => `• ${l}`)].join('\n'));
        console.log(`✓ Digest posted to Slack ${channel}`);
      } catch (e) { console.error(`⚠ Slack digest failed: ${e.message.split('\n')[0]}`); }
    }
  }
}

recordStatus(statusLabel, detail);
console.log('Done.');

function recordStatus(status, detailText) {
  try {
    execFileSync(process.execPath, ['bin/record-pull-status.mjs', 'brand-watch', 'Brand Watch (5pm)', status, detailText], { stdio: 'inherit' });
  } catch (e) {
    console.error(`⚠ Could not record System Status heartbeat: ${e.message.split('\n')[0]}`);
  }
}

// Wave 3 detail checks for one IGMP Bonus/FreeCredit promo (2 GETs):
// detail → PromotionRewards[0].RewardId → GetPromotionRewardContents.
async function igmpRewardContentChecks(cand) {
  const isFc = cand.promotionType === 'FreeCredit';
  const det = await igmpPost(cand.siteId, isFc ? '/PM/GetFreeCreditInfo' : '/PM/GetBonusInfo', { PromotionId: cand.promotionId });
  const promo = det?.data?.Promotion || det?.data;
  const rew = promo?.PromotionRewards?.[0];
  const findings = [];
  if (!rew?.RewardId) {
    // Uncalibrated across the estate — WARNING until precision is proven.
    findings.push({ severity: 'WARNING', check: 'reward-missing', message: 'No PromotionRewards[0] on active promo' });
    return findings;
  }
  const ct = await igmpPost(cand.siteId, '/PM/GetPromotionRewardContents', { RewardId: rew.RewardId });
  const rows = Array.isArray(ct?.data) ? ct.data : [];
  const totalLen = rows.reduce((n, r) => n + String(r.Content || '').length, 0);
  if (!rows.length || totalLen < 40) {
    // Matches the UpdatePromotionRewardDetails wipe bug — but legacy promos
    // may legitimately lack contents; WARNING until the rotation proves the
    // base rate (advisor: promote to FAIL only after observed precision).
    findings.push({ severity: 'WARNING', check: 'reward-tnc-wiped', message: `Reward T&C contents empty (${rows.length} locale row(s)) — matches the UpdatePromotionRewardDetails wipe bug, or never populated` });
  }
  const leak = rows.find((r) => /Refresh button|刷新按钮/.test(String(r.Content || '')));
  if (leak) {
    // Proven incident class (feedback_ws1_qpro_template_leak) — hard FAIL.
    findings.push({ severity: 'FAIL', check: 'qpro-template-leak', message: `Reward T&C contains the QPRO/QP2 "Refresh button" clause (locale ${leak.Locale}) — WS1/WS2 must use the 5-clause format` });
  }
  return findings;
}
