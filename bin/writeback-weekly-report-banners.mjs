/**
 * Sync BO-direct banner data to a weekly report sheet's "Banner Log" tab.
 * Parallel to writeback-weekly-report.mjs but for banners (GET /api/bo/banner).
 *
 * The Banner Log has no date column — each row = 1 banner, and the dashboard
 * counts rows per spreadsheet. So we query banners created in the week's
 * window and append any missing from the sheet.
 *
 * Defaults to dry-run. Use --commit to actually write.
 *
 * Usage:
 *   node bin/writeback-weekly-report-banners.mjs --week=W19            # dry-run
 *   node bin/writeback-weekly-report-banners.mjs --week=W19 --commit   # write
 */
import { authedFetch } from '../src/api-client.js';
import { QP2_BRAND_TO_IDS } from '../src/api-mapper-qp2.js';
import { getSheetsClient } from '../src/sheets-client.js';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const weekArg = flags.week ? String(flags.week).toUpperCase() : 'W19';
const dryRun  = flags.commit !== true;

const WEEKS = {
  W01: { id: '1heB6YZ_y9xPVzn6o1dRxWEq-2QE7kCr66yJfrlDbRJU', from: '2026-01-02', to: '2026-01-09' },
  W02: { id: '1mEucWPTgGs0xxx0cf8cc1FQDxUUKotvqDw9NAkEourg', from: '2026-01-12', to: '2026-01-16' },
  W03: { id: '1A2GK8bIywSsXpltSznh0Cn1vGOrhof7OT7WOUQAzh24', from: '2026-01-19', to: '2026-01-23' },
  W04: { id: '1nbqwgfOw0dcA1ozDSDGayGfo5Fb2M2r6ym7SqFsCTC4', from: '2026-01-26', to: '2026-01-30' },
  W05: { id: '15CCSfHZpNlCMJ7U9eTvP6axTGadtyV_QyiLfcotzPsA', from: '2026-02-02', to: '2026-02-06' },
  W06: { id: '1NHqkVuJ0qM_01JX9orkicpqJ4nkLYFJyR2MmZuMB3a8', from: '2026-02-09', to: '2026-02-13' },
  W07: { id: '1nkaGo6WWhI2MJu2_d0E5QHRZ8hqxFHmwxFrkbjwJmNg', from: '2026-02-16', to: '2026-02-20' },
  W08: { id: '1IBAAJ46_kVWaUvWsnTntX5Yb9HWqkrY7VCIIiuTYLvw', from: '2026-02-23', to: '2026-02-27' },
  W09: { id: '1KX2BgJ1cG4kUn_5et1-dO-nZobBanyClJeDoXgM4Rt4', from: '2026-03-02', to: '2026-03-06' },
  W10: { id: '1w7c9yOJvjwGYOA85kpy2hj4yVcV4MymVBlrmp-wEzNo', from: '2026-03-09', to: '2026-03-13' },
  W11: { id: '14vI1cIQ_me1AxjHl6Uj-C_lZrYiC12kRmb3jLlTDpl0', from: '2026-03-16', to: '2026-03-20' },
  W12: { id: '10qpjewOwFybDXjTxdVfS0UBj4M0RcgNbjrqXP91q7AU', from: '2026-03-23', to: '2026-03-27' },
  W13: { id: '1urVhlKaQx2WU_e_UipM7EQemOKDcxyi2qT3eMPSorGQ', from: '2026-03-30', to: '2026-04-03' },
  W14: { id: '1lmNeS3fd7avNUJ-n2QIWDI2EwctN8r-cmMXOq6mIu-0', from: '2026-04-06', to: '2026-04-10' },
  W15: { id: '1KJmtzp_DC_0CYB_hyDfTfQCsjFBbvIoMtuKXunIX3NU', from: '2026-04-13', to: '2026-04-17' },
  W16: { id: '1kXIWMlx0ISs8mzGxaPDSbSp9ElbxsMukgKFXG8L1Oo4', from: '2026-04-20', to: '2026-04-24' },
  W17: { id: '1pSg21Py11ysI8sMXtA0c7kE-1mXFsESbcUSDQLrywz0', from: '2026-04-27', to: '2026-05-01' },
  W18: { id: '1mRuxCO-u-O7l3dLrLYFmbCtavfSJ0JS6sE0EsXtT7Ng', from: '2026-05-04', to: '2026-05-08' },
  W19: { id: '1x9KsG9yAlhKTP_-fWW_euvTs3Ry8bNyWqn2h_uLRUM8', from: '2026-05-11', to: '2026-05-18' },
};

const week = WEEKS[weekArg];
if (!week) {
  console.error(`Unknown week: ${weekArg}. Valid: ${Object.keys(WEEKS).join(', ')}`);
  process.exit(1);
}

const fromMs = new Date(week.from + 'T00:00:00Z').getTime();
const toMs   = new Date(week.to   + 'T23:59:59Z').getTime();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Fetch banners with pagination
async function getAllBanners(siteId, { merchantId } = {}) {
  const all = [];
  let page = 1, lastPage = 1;
  do {
    const params = new URLSearchParams({
      perPage: '200', page: String(page), status: '1',
      sort_by: 'id', sort_order: 'desc',
    });
    if (merchantId != null) params.set('merchant_id', String(merchantId));
    const res = await authedFetch(siteId, `/api/bo/banner?${params}`);
    all.push(...(res.data?.rows || []));
    lastPage = res.data?.paginations?.last_page || 1;
    page++;
  } while (page <= lastPage);
  return all;
}

// images[].locale_name → "MY_EN", "SG_ZH", etc. → set of region codes
function bannerRegions(banner) {
  const set = new Set();
  for (const img of banner.images || []) {
    const m = String(img.locale_name || '').match(/^([A-Z]{2})_/);
    if (m) set.add(m[1]);
  }
  return [...set].join(', ');
}

function rowFor(banner, brand) {
  return [
    banner.label || banner.link || `Banner #${banner.id}`, // Banner Title
    brand,                          // Brand
    bannerRegions(banner),          // Region
    banner.platform_type || '',     // Type
    'Active',                       // Status
    '',                             // Requestor
    banner.created_by || '',        // Uploaded by
    '',                             // Notes
  ];
}

// ── 1. Read existing rows in Banner Log ──────────────────────────────────
const { sheets } = await getSheetsClient();

console.log(`Target: ${weekArg} (${week.from} → ${week.to})`);
console.log(`Sheet:  https://docs.google.com/spreadsheets/d/${week.id}/edit`);
console.log(`Mode:   ${dryRun ? 'DRY-RUN (no writes)' : 'COMMIT (will append rows)'}\n`);

const meta = await sheets.spreadsheets.get({
  spreadsheetId: week.id,
  fields: 'sheets.properties',
});
const tabs = meta.data.sheets.map(s => s.properties.title);
const tabName = tabs.find(t => /banner log/i.test(t))
             || tabs.find(t => /^banner$/i.test(t))
             || 'Banner Log';

const resp = await sheets.spreadsheets.values.get({
  spreadsheetId: week.id,
  range: `'${tabName}'!A1:H2000`,
});
const existing = new Set();
for (const r of (resp.data.values || []).slice(1)) {
  if (r && r[0]) existing.add(`${String(r[0]).trim().toUpperCase()}|${String(r[1] || '').trim().toUpperCase()}`);
}
console.log(`Existing rows in "${tabName}": ${existing.size}\n`);

// ── 2. Query BO for banners in this week ─────────────────────────────────
const newRows = [];
let totalScanned = 0, alreadyInSheet = 0;

// QPRO — per-brand BO
for (let i = 1; i <= 17; i++) {
  const brand = `QPRO${i}`;
  process.stdout.write(`  ${brand.padEnd(8)} `);
  try {
    const banners = await getAllBanners(`qpro${i}`);
    let added = 0;
    for (const b of banners) {
      if (!b.created_at) continue;
      const t = new Date(b.created_at).getTime();
      if (t < fromMs || t > toMs) continue;
      totalScanned++;
      const key = `${(b.label || '').trim().toUpperCase()}|${brand.toUpperCase()}`;
      if (existing.has(key)) { alreadyInSheet++; continue; }
      newRows.push(rowFor(b, brand));
      existing.add(key);
      added++;
    }
    process.stdout.write(`→ +${added} (${banners.length} total banners on BO)\n`);
  } catch (err) {
    process.stdout.write(`→ ERROR: ${err.message.substring(0, 60)}\n`);
  }
  await sleep(350);
}

// QP2 — banners are scoped per-merchant via merchant_id param
for (const [brand, ids] of Object.entries(QP2_BRAND_TO_IDS)) {
  process.stdout.write(`  ${brand.padEnd(8)} `);
  try {
    const banners = await getAllBanners('ibc22', { merchantId: ids.merchantId });
    let added = 0;
    for (const b of banners) {
      if (!b.created_at) continue;
      const t = new Date(b.created_at).getTime();
      if (t < fromMs || t > toMs) continue;
      totalScanned++;
      const key = `${(b.label || '').trim().toUpperCase()}|${brand.toUpperCase()}`;
      if (existing.has(key)) { alreadyInSheet++; continue; }
      newRows.push(rowFor(b, brand));
      existing.add(key);
      added++;
    }
    process.stdout.write(`→ +${added} (${banners.length} total)\n`);
  } catch (err) {
    process.stdout.write(`→ ERROR: ${err.message.substring(0, 60)}\n`);
  }
  await sleep(350);
}

// ── 3. Summary + preview ──────────────────────────────────────────────────
console.log(`\nSummary:`);
console.log(`  BO banners in week range : ${totalScanned}`);
console.log(`  Already in sheet         : ${alreadyInSheet}`);
console.log(`  To append                : ${newRows.length}`);

if (newRows.length === 0) {
  console.log('\nNothing to append. Dashboard is in sync with BO.');
  process.exit(0);
}

console.log(`\nPreview (first 5 rows):`);
console.log(`  Banner Title                              | Brand    | Region  | Type        | Uploaded by`);
for (const r of newRows.slice(0, 5)) {
  console.log(`  ${String(r[0]).padEnd(41)} | ${String(r[1]).padEnd(8)} | ${String(r[2]).padEnd(7)} | ${String(r[3]).padEnd(11)} | ${r[6]}`);
}
if (newRows.length > 5) console.log(`  … ${newRows.length - 5} more`);

if (dryRun) {
  console.log(`\nDry-run. Re-run with --commit to append these ${newRows.length} rows to "${tabName}".`);
  process.exit(0);
}

// ── 4. Append rows ────────────────────────────────────────────────────────
const appendResp = await sheets.spreadsheets.values.append({
  spreadsheetId: week.id,
  range: `'${tabName}'!A1`,
  valueInputOption: 'USER_ENTERED',
  insertDataOption: 'INSERT_ROWS',
  requestBody: { values: newRows },
});
console.log(`\n✓ Appended ${newRows.length} rows to "${tabName}".`);
console.log(`  Updated range: ${appendResp.data.updates?.updatedRange}`);
console.log(`\nDashboard will reflect this within ~10 min (cache TTL).`);
