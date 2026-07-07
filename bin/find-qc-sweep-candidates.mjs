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
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { parseArgs } from './_args.js';
import { getAllPromotions } from '../src/api-client.js';
import { QP2_BRAND_TO_IDS } from '../src/api-mapper-qp2.js';
import { igmpPost } from '../src/igmp-client.js';
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';

const { flags } = parseArgs(process.argv.slice(2));
const mode = flags.mode;
if (!['post-creation', 'weekly'].includes(mode)) {
  console.error('usage: find-qc-sweep-candidates.mjs --mode=post-creation|weekly [--minutes=90] [--stale-after=7]');
  process.exit(2);
}

const QPRO_BRANDS = Array.from({ length: 17 }, (_, i) => ({ brand: `QPRO${i + 1}`, siteId: `qpro${i + 1}` }));
const QP2_MERCHANTS = Object.entries(QP2_BRAND_TO_IDS).map(([brand, ids]) => ({ brand, merchantId: ids.merchantId, siteId: 'qp2' }));
// Brand label must match bundleBrand() in bin/canary-api-igmp.js exactly —
// that's what qc-bundle filenames are keyed by (WS1_MY, WS1_SG, ... but WS2
// stays single since it has only one region).
const IGMP_SITES = [
  { siteId: 'ws1-v3-my', brand: 'WS1_MY', region: 'MY' },
  { siteId: 'ws1-v3-sg', brand: 'WS1_SG', region: 'SG' },
  { siteId: 'ws1-v3-id', brand: 'WS1_ID', region: 'ID' },
  { siteId: 'ws1-v3-th', brand: 'WS1_TH', region: 'TH' },
  { siteId: 'ws1-v3-kh', brand: 'WS1_KH', region: 'KH' },
  { siteId: 'ws2', brand: 'WS2', region: 'MY' },
];

// ── Index local qc-bundles once: brand::promo_code -> {handle, savedAt} ──
function buildBundleIndex() {
  const index = new Map();
  const files = [];
  const dir = 'captures/qc-bundles';
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.json')) files.push(f);
    }
  }
  for (const f of files) {
    let bundle;
    try { bundle = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')); } catch { continue; }
    if (!bundle?.promo_code || !bundle?.brand) continue;
    const mtimeMs = statSync(`${dir}/${f}`).mtimeMs;
    const savedAtMs = bundle.saved_at ? Date.parse(bundle.saved_at) : mtimeMs;
    const key = `${bundle.brand}::${bundle.promo_code}`;
    const handle = f.slice(0, -(`__${bundle.brand}.json`.length));
    // Multiple bundles can exist for edits — keep the most recently saved one.
    const prior = index.get(key);
    if (!prior || savedAtMs > prior.savedAtMs) {
      index.set(key, { handle, savedAtMs, file: f });
    }
  }
  return index;
}

// ── Read QC Results Log once: brand::promo_code -> last Sentinel check info ──
async function readQcResultsLog() {
  const { sheets } = await getSheetsClient();
  const OPS_ID = getOpsSheetId();
  const TAB = 'QC Results Log';
  const meta = await sheets.spreadsheets.get({ spreadsheetId: OPS_ID, fields: 'sheets.properties.title' });
  if (!meta.data.sheets.some((s) => s.properties.title === TAB)) return new Map();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: OPS_ID, range: `'${TAB}'!A2:N100000` });
  const rows = res.data.values || [];
  const index = new Map();
  for (const r of rows) {
    const [timestamp, promoCode, brand, , , , , , sentinelVerdict, checkTrigger] = r;
    if (!promoCode || !brand) continue;
    index.set(`${brand}::${promoCode}`, {
      lastCheckedAt: timestamp ? Date.parse(timestamp) : null,
      sentinelVerdict: sentinelVerdict || null,
      checkTrigger: checkTrigger || null,
    });
  }
  return index;
}

// ── Fetch all currently-live codes per brand, across all 3 platform families ──
async function fetchAllLiveCodes() {
  const out = [];

  // category/game_provider/message_templates/valid_to/status are all present
  // on this list response already — carried through so check-structural-health.mjs
  // never needs a second (per-code detail) fetch for the QPRO/QP2 checks.
  const qproQp2Fields = (r) => ({
    name: r.name, category: r.category, gameProvider: r.game_provider,
    messageTemplateCount: (r.message_templates || []).length,
    dialogPopupCount: (r.dialog_popup_list || []).length,
    validTo: r.valid_to, status: r.status,
  });

  await Promise.all(QPRO_BRANDS.map(async ({ brand, siteId }) => {
    try {
      const { rows } = await getAllPromotions(siteId, { perPage: 500, status: 1 });
      for (const r of rows) out.push({ platform: 'qpro', brand, code: r.code, region: null, siteId, promotionId: r.id, ...qproQp2Fields(r) });
    } catch (e) { console.error(`  ⚠ ${brand}: ${e.message.split('\n')[0]}`); }
  }));

  await Promise.all(QP2_MERCHANTS.map(async ({ brand, merchantId, siteId }) => {
    try {
      const { rows } = await getAllPromotions(siteId, { perPage: 500, status: 1, merchantId });
      for (const r of rows) out.push({ platform: 'qp2', brand, code: r.code, region: null, siteId, merchantId, promotionId: r.id, ...qproQp2Fields(r) });
    } catch (e) { console.error(`  ⚠ ${brand}: ${e.message.split('\n')[0]}`); }
  }));

  for (const { siteId, brand, region } of IGMP_SITES) {
    try {
      let pg = 1;
      while (true) {
        const d = await igmpPost(siteId, `/PM/GetPromotionsList?pageNum=${pg}&rowPerPage=200`, { Status: 1 });
        const raw = d?.data;
        const list = Array.isArray(raw) ? raw : (raw?.data || raw?.List || raw?.list || []);
        if (!Array.isArray(list) || !list.length) break;
        for (const p of list) {
          if (p.IsActive) out.push({ platform: 'igmp', brand, code: p.PromotionCode, region, siteId, promotionId: p.PromotionId, promotionType: p.PromotionType, endDate: p.PromotionEndDate });
        }
        if (list.length < 200) break;
        pg++;
      }
    } catch (e) { console.error(`  ⚠ ${brand}/${region}: ${e.message.split('\n')[0]}`); }
  }

  return out;
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
  const [liveCodes, bundleIndex, qcLog] = await Promise.all([
    fetchAllLiveCodes(),
    Promise.resolve(buildBundleIndex()),
    readQcResultsLog(),
  ]);
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
