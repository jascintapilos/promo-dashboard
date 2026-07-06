#!/usr/bin/env node
// Multi-brand orchestrator. Reads a request and spawns ONE API-direct
// canary process per brand listed on the request. Dispatches by platform:
//
//   QPRO1..QPRO17  → bin/canary-api.js     (single-merchant BO, 6-field dialog_popup_list shape)
//   QP2A..QP2D     → bin/canary-api-qp2.js (multi-merchant BO, full-popup-row+promotion_id shape)
//
// Both API-direct paths create promo + MT + dialog popup + names rows and
// link MT + dialog popup via PUT. ~5s per brand vs ~90s for Playwright.
// Switched from Playwright (`bin/canary-write.js`) on 2026-05-15 part 2
// — Playwright's page.route() interception doesn't fire on QP2's PUT,
// so the Playwright path never linked dialog popups on QP2 brands.
//
// Pass `--playwright` to force the legacy Playwright runner (useful as a
// fallback when an API mapper hasn't been authored yet for a bonus type).
//
// Sequential by default; `--parallel` spawns all concurrently.
//
// Usage:
//   node bin/canary-multi-brand.js P078-r1448 --commit
//   node bin/canary-multi-brand.js P078-r1448 --commit --parallel
//   node bin/canary-multi-brand.js P078-r1448 --commit --parallel-qc       (per-child QC parallelism)
//   node bin/canary-multi-brand.js P078-r1448 --commit --parallel --parallel-qc
//   node bin/canary-multi-brand.js P-MULTI-test --commit --playwright      (legacy fallback)
//
// Flags forwarded to children:
//   --parallel-qc   per-child runner fires post-save QC Levels 1/2/3 concurrently
//                   (~3-5s → ~1-2s saved per brand). Output identical to sequential.
//
// Exit code = max of all child exits (non-zero if any brand failed).

import { spawn } from 'node:child_process';
import path from 'node:path';
import { parseArgs } from './_args.js';
import { loadAllRequests, resolveHandle } from '../src/planner.js';
import { BRAND_TO_SITE } from '../src/ingest.js';

const { flags, positional } = parseArgs(process.argv.slice(2));
const userInput = positional[0];
if (!userInput) {
  console.error('usage: canary-multi-brand.js <handle|P###> [--commit] [--parallel] [--playwright]');
  process.exit(2);
}
const commit = flags.commit === true;
const parallel = flags.parallel === true;
const usePlaywright = flags.playwright === true;

const { byHandle, byId } = await loadAllRequests();
// Auto-resolve bare P### → current-month handle (highest source_line).
// See memory/feedback_promo_request_sheet_current_month.md.
const handle = resolveHandle(userInput, { byHandle, byId });
if (!handle) {
  console.error(`request "${userInput}" not found in captures/requests/`);
  console.error('  If this is a new request, run: node bin/ingest-requests.js');
  process.exit(2);
}
if (handle !== userInput) console.log(`(auto-resolved "${userInput}" → "${handle}" — current-month row)`);
const request = byHandle.get(handle);
if (!request) {
  console.error(`handle "${handle}" not found in byHandle map (race condition?)`);
  process.exit(2);
}

let brands = request.brands || [];
if (brands.length === 0) {
  console.error(`request "${handle}" has no brands`);
  process.exit(2);
}

// Brand subset filters (added 2026-06-15 for phased rollout):
//   --brands=QPRO2,QPRO3   whitelist — run ONLY these brands
//   --exclude=QPRO1,WS1    blacklist — run all request brands EXCEPT these
// Case-insensitive, comma-separated. Applied before job expansion.
if (flags.brands) {
  const want = new Set(String(flags.brands).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
  brands = brands.filter((b) => want.has(b.toUpperCase()));
}
if (flags.exclude) {
  const drop = new Set(String(flags.exclude).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
  brands = brands.filter((b) => !drop.has(b.toUpperCase()));
}
if (brands.length === 0) {
  console.error(`request "${handle}" has no brands after --brands/--exclude filter`);
  process.exit(2);
}

// Resolve runner per brand by platform. QPRO → canary-api.js, QP2 →
// canary-api-qp2.js. With --playwright, override everything to the
// legacy canary-write.js runner.
function pickRunner(brand) {
  if (usePlaywright) return 'canary-write.js';
  const platform = (BRAND_TO_SITE[brand]?.platform || '').toLowerCase();
  if (platform === 'qpro') return 'canary-api.js';
  if (platform === 'qp2')  return 'canary-api-qp2.js';
  if (platform === 'bia' || platform === 'igmp') return 'canary-api-igmp.js';
  // Unknown platform → fall back to Playwright canary which has the
  // widest support matrix.
  return 'canary-write.js';
}

const runnerByBrand = Object.fromEntries(brands.map((b) => [b, pickRunner(b)]));

// Day-split fan-out (operator request P106-P109 2026-05-26): when a request
// carries instructions.day_split, the IGMP path produces N codes per brand
// suffixed _D1/_D2/.._Dn while other platforms stay at 1 code per brand.
const daySplit = request.instructions?.day_split || null;

// Region fan-out for IGMP brands (added 2026-05-26): WS1 has per-region BO
// instances (ws1-v3-my, ws1-v3-sg, ws1-v3-id, ws1-v3-th, ws1-v3-kh). When a
// request lists multiple regions, dispatch one child per region per IGMP
// brand. QP2/QPRO brands handle multiple regions inside a single BO via
// per_currency_overrides, so they stay at one child per brand.
const IGMP_REGION_TO_SITE = {
  MY: 'ws1-v3-my', SG: 'ws1-v3-sg', ID: 'ws1-v3-id',
  TH: 'ws1-v3-th', KH: 'ws1-v3-kh',
};
// --regions=MY,SG limits IGMP fan-out to a specific region subset. Useful
// when committing in phases (e.g. MY first, SG later after T&C currency fix).
const regionFilter = flags.regions
  ? new Set(String(flags.regions).split(',').map((s) => s.trim().toUpperCase()))
  : null;
function expandBrand(brand) {
  const platform = (BRAND_TO_SITE[brand]?.platform || '').toLowerCase();
  const isIgmp = platform === 'igmp' || platform === 'bia';
  // For non-IGMP platforms, region is handled inside the BO — only fan day-split.
  if (!isIgmp) {
    if (!daySplit || daySplit.count <= 1 || platform !== daySplit.platform) {
      return [{ brand, site: null, suffix: null }];
    }
    return Array.from({ length: daySplit.count }, (_, i) => ({
      brand, site: null, suffix: `_${daySplit.prefix}${i + 1}`,
    }));
  }
  // IGMP path: region × day_split cross product. WS2 is a single site so
  // regions list still produces one site after dedup.
  let regions = Array.isArray(request.regions) ? request.regions : [];
  if (regionFilter) regions = regions.filter((r) => regionFilter.has(String(r).toUpperCase()));
  const sites = regions
    .map((r) => IGMP_REGION_TO_SITE[String(r).toUpperCase()])
    .filter(Boolean);
  // If the brand is WS2 or no recognized regions, fall back to default site
  // resolution (canary uses BRAND_TO_SITE[brand].siteId).
  const siteList = (brand.toUpperCase() === 'WS2' || sites.length === 0)
    ? [null]
    : [...new Set(sites)];
  const dayCount = (daySplit && daySplit.count > 1 && platform === daySplit.platform)
    ? daySplit.count : 1;
  const suffixes = dayCount > 1
    ? Array.from({ length: dayCount }, (_, i) => `_${daySplit.prefix}${i + 1}`)
    : [null];
  const out = [];
  for (const site of siteList) {
    for (const suffix of suffixes) {
      out.push({ brand, site, suffix });
    }
  }
  return out;
}
const jobs = brands.flatMap(expandBrand);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`MULTI-BRAND CANARY — ${handle}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Brands:   ${brands.map((b) => `${b}→${runnerByBrand[b]}`).join(', ')}`);
const jobLabels = jobs.map((j) => {
  const siteTag = j.site ? `@${j.site}` : '';
  const sufTag = j.suffix || '';
  return `${j.brand}${siteTag}${sufTag}`;
}).join(', ');
console.log(`  Jobs:     ${jobs.length} child process(es) → ${jobLabels}`);
if (daySplit) {
  console.log(`  Split:    day_split=${daySplit.count}${daySplit.prefix} (${daySplit.platform})`);
}
console.log(`  Mode:     ${parallel ? 'PARALLEL' : 'SEQUENTIAL'}`);
console.log(`  Commit:   ${commit ? 'LIVE' : 'DRY-RUN (add --commit for live)'}`);
if (usePlaywright) console.log('  Runner:   PLAYWRIGHT (--playwright override)');
else console.log('  Runner:   API-DIRECT (default)');
console.log('');

function runCanary(job) {
  const { brand, site, suffix } = job;
  return new Promise((resolve) => {
    const runner = runnerByBrand[brand];
    const canaryScript = path.resolve('bin', runner);
    const args = [canaryScript, handle];
    if (commit) args.push('--commit');
    args.push(`--brand=${brand}`);
    if (site) args.push(`--site=${site}`);
    if (suffix) args.push(`--code-suffix=${suffix}`);
    // Forward IGMP-only passthrough flag (suppress FT_ prefix this run).
    if (flags['no-ft-prefix']) args.push('--no-ft-prefix');
    // Forward parallel-qc to per-brand runners (QPRO + QP2 honor it; IGMP ignores).
    if (flags['parallel-qc']) args.push('--parallel-qc');
    const siteTag = site ? `@${site.replace(/^ws1-v3-/, '')}` : '';
    const label = `${brand}${siteTag}${suffix || ''}`;
    const startedAt = Date.now();
    console.log(`▶ [${label}] launching ${runner} — args: ${args.slice(1).join(' ')}`);
    const child = spawn(process.execPath, args, {
      stdio: parallel ? 'pipe' : 'inherit',  // parallel: capture so output doesn't interleave
      shell: false,
    });
    if (parallel) {
      let buffered = '';
      child.stdout?.on('data', (d) => { buffered += d.toString(); });
      child.stderr?.on('data', (d) => { buffered += d.toString(); });
      child.on('exit', (code) => {
        const ms = Date.now() - startedAt;
        console.log(`\n━━━━━━ [${label}] exit=${code} (${(ms/1000).toFixed(1)}s) ━━━━━━`);
        process.stdout.write(buffered);
        resolve({ brand, label, code, ms });
      });
    } else {
      child.on('exit', (code) => {
        const ms = Date.now() - startedAt;
        console.log(`\n━━━━━━ [${label}] exit=${code} (${(ms/1000).toFixed(1)}s) ━━━━━━\n`);
        resolve({ brand, label, code, ms });
      });
    }
  });
}

let results;
if (parallel) {
  results = await Promise.all(jobs.map((j) => runCanary(j)));
} else {
  results = [];
  for (const j of jobs) {
    results.push(await runCanary(j));
  }
}

// Summary table
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('MULTI-BRAND SUMMARY');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const pad = (s, n) => String(s).padEnd(n);
for (const r of results) {
  const status = r.code === 0 ? '✅ OK' : `❌ exit=${r.code}`;
  console.log(`  ${pad(r.label || r.brand, 12)} ${pad(status, 16)} ${(r.ms / 1000).toFixed(1)}s`);
}

const worst = results.reduce((acc, r) => Math.max(acc, r.code || 0), 0);

// ── QP2 dialog relink (self-heal) ──────────────────────────────────────
// On the shared IBC22 BO the incremental per-merchant dialog_popup_list PUTs
// mis-link non-last merchants to stale popups sharing a site_id (see
// bin/relink-qp2-dialogs.mjs header). After all QP2 brands for this promo are
// attached, re-PUT the complete, correct dialog_popup_list in one shot.
const hadQp2 = brands.some((b) => (BRAND_TO_SITE[b]?.platform || '').toLowerCase() === 'qp2');
if (commit && hadQp2 && results.some((r) => r.code === 0)) {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('QP2 DIALOG RELINK');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  await new Promise((resolve) => {
    const child = spawn(process.execPath,
      [path.resolve('bin', 'relink-qp2-dialogs.mjs'), handle, '--commit'],
      { stdio: 'inherit', shell: false });
    child.on('exit', () => resolve());
  });
}

// ── Final step: write the saved promo_code + names back to the sheet ────
// Conditions: live commit, at least one brand saved, fixture has values
// (i.e. operator or auto-namer populated them), source_line known.
const anySucceeded = results.some((r) => r.code === 0);
const valuesByField = {};
if (request.promo_code) {
  // Day-split write-back: when the request has instructions.day_split AND
  // the brand list spans both IGMP and another platform (typically QP2),
  // populate the multi-line "Code 1/2/3 + QP2A Code" template per
  // feedback_sheet_writeback_day_split_codes.md (2026-05-26 operator rule).
  const platforms = new Set(brands.map((b) =>
    (BRAND_TO_SITE[b]?.platform || '').toLowerCase()).filter(Boolean));
  const isMixedDaySplit = daySplit && daySplit.count > 1
    && (platforms.has('igmp') || platforms.has('bia'))
    && platforms.size > 1;
  if (isMixedDaySplit) {
    const base = request.promo_code;
    const igmpBrand = brands.find((b) =>
      ['igmp','bia'].includes((BRAND_TO_SITE[b]?.platform || '').toLowerCase()))
      || 'WS1';
    const otherBrand = brands.find((b) =>
      !['igmp','bia'].includes((BRAND_TO_SITE[b]?.platform || '').toLowerCase()))
      || 'QP2A';
    const lines = [igmpBrand];
    for (let i = 1; i <= daySplit.count; i++) {
      lines.push(`Code ${i}: ${base}_${daySplit.prefix}${i}`);
    }
    lines.push('', otherBrand, `Code: ${base}`);
    valuesByField.promo_code = lines.join('\n');
  } else {
    valuesByField.promo_code = request.promo_code;
  }
}
if (request.promotion_name_en) valuesByField.promotion_name_en = request.promotion_name_en;
if (request.promotion_name_zh_id) valuesByField.promotion_name_zh_id = request.promotion_name_zh_id;
// Mark the row "Created" so operators can see which requests the bot has
// processed. Always paired with the value write-back below, so the status
// flip only happens when at least one brand saved.
if (anySucceeded) valuesByField.status = 'Created';
const hasValues = Object.keys(valuesByField).length > 0;

if (commit && anySucceeded && hasValues && request.source_line) {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('SHEET WRITE-BACK');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  try {
    const { getSheetsClient, resolveCurrentMonthTab, readHeader,
            detectColumnMapFromHeader, writeFields } = await import('../src/sheets-client.js');
    const c = await getSheetsClient();
    // Use the tab the request was actually ingested from — NOT "current
    // month". Retroactively fixing a past-month request (e.g. re-canarying
    // a June request in July) must write back to June, or it silently
    // corrupts a same-numbered row in the current month's tab.
    const tab = request.source_tab || await resolveCurrentMonthTab(c);
    const header = await readHeader(c, tab);
    const colMap = detectColumnMapFromHeader(header);
    const res = await writeFields(c, tab, request.source_line, valuesByField, colMap);
    const cells = res.totalUpdatedCells ?? 0;
    console.log(`✓ ${tab}!row ${request.source_line} — ${cells} cells updated`);
    for (const [f, v] of Object.entries(valuesByField)) {
      console.log(`    ${f.padEnd(24)} = ${JSON.stringify(v)}`);
    }
  } catch (e) {
    console.log(`⚠ Sheet write-back failed (promos were still saved on BO):`);
    console.log(`  ${e.message.split('\n')[0]}`);
    if (/credentials/i.test(e.message)) {
      console.log('  Run: node bin/sheets-oauth.mjs   (one-time setup)');
    }
  }
}

process.exit(worst);
