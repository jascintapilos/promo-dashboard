#!/usr/bin/env node
// Hourly Promo Codes refresh (VDI): read the CEE / Sales / CRM code sheets, check
// every code against BO (READ-ONLY active-list calls via fetchAllLiveCodes — no
// PUT, no activate, no deactivate), then
//   1. upload the result to POST /api/promo-codes/snapshot, signed with the
//      dedicated Promo Codes key (%USERPROFILE%\.qc-relay\promo-codes-secret,
//      created by the key owner at /admin/promo-codes-key) — this is what the
//      dashboard shows. It never uses the QC relay key.
//   2. write a readable copy to the "Promo Codes" tab of the Ops sheet.
// See docs/plans/promo-codes-tab.md and docs/plans/promo-codes-feed-key.md.
//
//   node bin/push-promo-codes.mjs             read sheets + BO, upload + write the Ops sheet tab
//   node bin/push-promo-codes.mjs --dry-run   read sheets + BO, print counts, write tmp/promo-codes-dry-run.json only
//   env: QC_HUB_URL (default https://qc-dashboard.zoom66.xyz), PROMO_CODES_FEED_SECRET (instead of the key file)
//
// WS1/WS2 sessions expire: when WS1 MY or WS2 fails, bin/refresh-igmp-sessions.mjs
// (promo_testbot) is run ONCE for just that site and the BO check retried. WS1 SG
// never triggers a login (its testbot login keeps failing; retries risk a lockout).
// A failed run is recorded on the dashboard and in the sheet; the last good list stays.
// Exit 0 on success, 1 on failure — message only, never the key.

import { gzipSync } from 'node:zlib';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sign } from '../src/qc-dashboard/relay-auth.js';
import { readUploaderFeedSecret } from '../src/qc-dashboard/promo-codes-feed-secret.js';
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';
import { fetchAllLiveCodes } from '../src/live-codes.js';
import { QPRO_BRANDS, QP2_MERCHANTS, IGMP_SITES } from '../src/brand-ids.js';
import { PROMO_CODE_SOURCES, PARSERS, applyBoStatus } from '../src/qc-dashboard/promo-codes-parse.js';
import { writeGoodRun, writeFailedRun } from '../src/qc-dashboard/promo-codes-sheet.js';

const HUB = (process.env.QC_HUB_URL || 'https://qc-dashboard.zoom66.xyz').replace(/\/+$/, '');
const WORKER_ID = `promo-codes-push-${process.pid}`;
const REL_PATH = '/api/promo-codes/snapshot';
const MAX_PUSH_BYTES = 8 * 1024 * 1024; // server cap for this route

// BO key → site the job may log back into, only when that site failed. WS1 SG is
// deliberately excluded; add it back here once its testbot login is fixed.
const REFRESHABLE_IGMP = new Map([['WS1_MY', 'ws1-v3-my'], ['WS2', 'ws2']]);

async function readSources(sheets) {
  const rows = [];
  const sources = {};
  for (const { source, spreadsheetId, tabs } of PROMO_CODE_SOURCES) {
    // Real tab titles, matched ignoring case / surrounding spaces ("Index (All Teams) ").
    const titles = (await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' })).data.sheets.map((s) => s.properties.title);
    const actual = (t) => titles.find((x) => x.trim().toLowerCase() === t.trim().toLowerCase());
    const missing = tabs.filter((t) => !actual(t));
    if (missing.length) throw new Error(`${source} sheet is missing tab(s): ${missing.join(', ')}`);
    const r = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: tabs.map((t) => `'${actual(t)}'!A:Z`) });
    const valuesByTab = Object.fromEntries(tabs.map((t, i) => [t, r.data.valueRanges?.[i]?.values || []]));
    const parsed = PARSERS[source](valuesByTab);
    if (!parsed.length) throw new Error(`${source} sheet returned no codes`);
    sources[source] = parsed.length;
    rows.push(...parsed);
  }
  return { rows, sources };
}

// IGMP site errors are labelled "WS1_MY/MY"; the BO key is the part before "/".
const keyOf = (e) => String(e.brand).split('/')[0];

async function listLiveCodes({ refreshIgmp }) {
  let result = await fetchAllLiveCodes();
  const dead = result.siteErrors.map(keyOf).filter((k) => REFRESHABLE_IGMP.has(k));
  if (refreshIgmp && dead.length) {
    console.log(`  WS1/WS2 session problem (${dead.join(', ')}) — refreshing just those sites once and retrying`);
    const r = spawnSync(process.execPath, ['bin/refresh-igmp-sessions.mjs'], {
      stdio: 'ignore', timeout: 4 * 60_000,
      env: { ...process.env, IGMP_REFRESH_SITES: dead.map((k) => REFRESHABLE_IGMP.get(k)).join(',') },
    });
    if (r.status !== 0) console.log(`  session refresh exited ${r.status ?? 'timeout'} — affected brands will show "Not checked"`);
    result = await fetchAllLiveCodes();
  }
  return result;
}

async function checkBo(rows, opts) {
  const { codes, siteErrors } = await listLiveCodes(opts);
  const failed = new Set(siteErrors.map(keyOf));
  const allKeys = [...QPRO_BRANDS.map((b) => b.brand), ...QP2_MERCHANTS.map((b) => b.brand), ...IGMP_SITES.map((s) => s.brand)];
  const checkedBrands = allKeys.filter((k) => !failed.has(k));
  const allBrandKeys = [...QPRO_BRANDS.map((b) => b.brand), ...QP2_MERCHANTS.map((b) => b.brand)];
  return {
    rows: applyBoStatus(rows, { liveCodes: codes, checkedBrands, igmpSites: IGMP_SITES, allBrandKeys }),
    siteErrors: siteErrors.map((e) => ({ brand: keyOf(e), message: e.message })),
    liveCount: codes.length,
  };
}

async function postSigned(payload, secret) {
  const gz = gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
  if (gz.length > MAX_PUSH_BYTES) throw new Error(`payload too large (${(gz.length / 1048576).toFixed(1)}MB gzip)`);
  const timestamp = Date.now();
  const nonce = crypto.randomBytes(16).toString('hex');
  const headers = {
    'content-type': 'application/gzip',
    'x-relay-timestamp': String(timestamp),
    'x-relay-nonce': nonce,
    'x-relay-signature': sign({ secret, method: 'POST', path: REL_PATH, timestamp, nonce, bodyBuffer: gz }),
    'x-relay-worker': WORKER_ID.slice(0, 64),
  };
  const resp = await fetch(`${HUB}${REL_PATH}`, { method: 'POST', headers, body: gz });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`dashboard rejected the upload (${resp.status}): ${text.slice(0, 200)}`);
  return { bytes: gz.length };
}

function summarise(rows, sources, siteErrors, liveCount) {
  const live = rows.filter((r) => Object.values(r.bo).includes('active')).length;
  const mm = rows.filter((r) => r.mismatch.length).length;
  console.log(`  sheets: CEE ${sources.CEE} · Sales ${sources.Sales} · CRM ${sources.CRM} → ${rows.length} rows`);
  console.log(`  BO: ${liveCount} active codes listed · ${live} rows active on ≥1 brand · ${mm} mismatches`);
  if (siteErrors.length) console.log(`  not checked this run: ${siteErrors.map((e) => e.brand).join(', ')}`);
}

export async function pushPromoCodes({ dryRun = false, refreshIgmp = !dryRun } = {}) {
  const pulledAt = new Date().toISOString();
  const key = dryRun ? null : readUploaderFeedSecret();
  // No key yet still updates the sheet copy; the dashboard upload is skipped with a clear message.
  if (key && !key.present) console.log(`  ! Promo Codes upload key unavailable — ${key.reason}`);
  const { sheets } = await getSheetsClient();
  const opsSheetId = dryRun ? null : getOpsSheetId();
  try {
    const { rows: sheetRows, sources } = await readSources(sheets);
    const { rows, siteErrors, liveCount } = await checkBo(sheetRows, { refreshIgmp });
    const boCheckedAt = new Date().toISOString();
    summarise(rows, sources, siteErrors, liveCount);
    const payload = { ok: true, pulledAt, boCheckedAt, rows, sources, siteErrors, detail: '' };
    if (dryRun) {
      mkdirSync('tmp', { recursive: true });
      writeFileSync('tmp/promo-codes-dry-run.json', JSON.stringify(payload, null, 2));
      console.log('  dry run — nothing uploaded or written; wrote tmp/promo-codes-dry-run.json');
      return { ok: true };
    }
    try { await writeGoodRun(sheets, opsSheetId, payload); console.log(`  ✓ wrote ${rows.length} rows to the Ops sheet "Promo Codes" tab`); }
    catch (e) { console.error(`  ✖ could not write the Ops sheet copy: ${e.message}`); }
    if (!key.present) return { ok: false, error: 'no upload key' };
    const r = await postSigned(payload, key.secret);
    console.log(`  ✓ uploaded ${rows.length} rows to the dashboard (${(r.bytes / 1024).toFixed(0)} KB gzip)`);
    return { ok: true };
  } catch (e) {
    console.error(`  ✖ promo codes refresh failed: ${e.message}`);
    if (!dryRun) {
      const detail = e.message.slice(0, 500);
      try { await writeFailedRun(sheets, opsSheetId, { pulledAt, detail }); } catch {}
      if (key?.present) {
        try { await postSigned({ ok: false, pulledAt, detail }, key.secret); }
        catch (e2) { console.error(`  ✖ could not record the failure on the dashboard: ${e2.message}`); }
      }
    }
    return { ok: false, error: e.message };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // process.exitCode, not process.exit(): exiting with fetch sockets still open
  // trips a libuv assert on Windows (exit 127).
  try {
    const r = await pushPromoCodes({ dryRun: process.argv.includes('--dry-run') });
    process.exitCode = r.ok ? 0 : 1;
  } catch (e) {
    console.error(`  ✖ ${e.message}`);
    process.exitCode = 1;
  }
}
