/**
 * Sync BO-direct promo data to a weekly report sheet's "Promo Code Log" tab.
 * The Apps Script dashboard reads these sheets — appending here = updating
 * the dashboard count (after the 10-minute cache refresh).
 *
 * Defaults to dry-run. Use --commit to actually append rows.
 *
 * Usage:
 *   node bin/writeback-weekly-report.mjs                 # current week (W19), dry-run
 *   node bin/writeback-weekly-report.mjs --week W18      # specific week
 *   node bin/writeback-weekly-report.mjs --commit        # actually write
 *   node bin/writeback-weekly-report.mjs --include-test  # don't filter TEST_*
 */
import { getAllPromotions } from '../src/api-client.js';
import { QP2_BRAND_TO_IDS } from '../src/api-mapper-qp2.js';
import { getSheetsClient } from '../src/sheets-client.js';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const weekArg     = flags.week ? String(flags.week).toUpperCase() : 'W19';
const dryRun      = flags.commit !== true;
const includeTest = flags['include-test'] === true;

// ── Weekly report sheets (same map as read-weekly-reports.mjs) ────────────
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

// BO promo_type → human label (the weekly log uses text)
// 1=Deposit, 2=Cashback, 3=Free Credit, 4=Free Spin, 5=Free Spin (legacy)
const TYPE_LABEL = { 1: 'Deposit Bonus', 2: 'Cashback', 3: 'Free Credit', 4: 'Free Spin', 5: 'Free Spin' };
const CURRENCY_TO_REGION = { MYR: 'MY', SGD: 'SG', IDR: 'ID', THB: 'TH', KHR: 'KH', AUD: 'AU' };

function rowFor(promo, brand) {
  const regions = (promo.currencies_bonus_type || [])
    .map(c => CURRENCY_TO_REGION[c.name] || c.name)
    .filter((v, i, a) => v && a.indexOf(v) === i)
    .join(', ');
  return [
    promo.created_at.slice(0, 10),       // Date
    promo.code,                           // Code
    brand,                                // Brand
    regions,                              // Region (CSV if multi)
    promo.created_by || '',               // Created By
    TYPE_LABEL[promo.promo_type] || `Type ${promo.promo_type}`, // Type
    'Active',                             // Status
  ];
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── 1. Read existing rows in Promo Code Log ──────────────────────────────
const { sheets } = await getSheetsClient();

console.log(`Target: ${weekArg} (${week.from} → ${week.to})`);
console.log(`Sheet:  https://docs.google.com/spreadsheets/d/${week.id}/edit`);
console.log(`Mode:   ${dryRun ? 'DRY-RUN (no writes)' : 'COMMIT (will append rows)'}\n`);

let existingCodes = new Set();
let tabName = 'Promo Code Log';

try {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: week.id,
    fields: 'sheets.properties',
  });
  const tabs = meta.data.sheets.map(s => s.properties.title);
  // Match flexibly: prefer "Promo Code Log", fall back to "Promo Code"
  tabName = tabs.find(t => /promo code log/i.test(t))
         || tabs.find(t => /promo code/i.test(t))
         || 'Promo Code Log';

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: week.id,
    range: `'${tabName}'!A1:J2000`,
  });
  for (const r of (resp.data.values || []).slice(1)) {
    if (r && r[1]) existingCodes.add(String(r[1]).trim().toUpperCase());
  }
  console.log(`Existing rows in "${tabName}": ${existingCodes.size} codes\n`);
} catch (err) {
  console.error('Could not read existing sheet:', err.message);
  process.exit(1);
}

// ── 2. Query BO for promos in this week ──────────────────────────────────
const newRows = [];
let totalScanned = 0, testSkipped = 0, alreadyInSheet = 0;

// QPRO brands
for (let i = 1; i <= 17; i++) {
  const brand = `QPRO${i}`;
  process.stdout.write(`  ${brand.padEnd(8)} `);
  try {
    const { rows } = await getAllPromotions(`qpro${i}`, {
      perPage: 500, status: 1, sortBy: 'id', sortOrder: 'desc',
    });
    let added = 0;
    for (const p of rows) {
      if (!p.created_at) continue;
      const t = new Date(p.created_at).getTime();
      if (t < fromMs || t > toMs) continue;
      totalScanned++;
      if (!includeTest && /^TEST_/i.test(p.code)) { testSkipped++; continue; }
      if (existingCodes.has(p.code.toUpperCase())) { alreadyInSheet++; continue; }
      newRows.push(rowFor(p, brand));
      existingCodes.add(p.code.toUpperCase()); // avoid dup within same run
      added++;
    }
    process.stdout.write(`→ +${added}\n`);
  } catch (err) {
    process.stdout.write(`→ ERROR: ${err.message.substring(0, 60)}\n`);
  }
  await sleep(350);
}

// QP2 — de-dup across 4 merchants
process.stdout.write(`  QP2      `);
try {
  const seen = new Map();
  for (const [brand, ids] of Object.entries(QP2_BRAND_TO_IDS)) {
    const { rows } = await getAllPromotions('ibc22', {
      perPage: 500, status: 1, merchantId: ids.merchantId, sortBy: 'id', sortOrder: 'desc',
    });
    for (const p of rows) {
      if (!seen.has(p.code)) seen.set(p.code, { ...p, brand: 'QP2' });
    }
    await sleep(350);
  }
  let added = 0;
  for (const [code, p] of seen) {
    if (!p.created_at) continue;
    const t = new Date(p.created_at).getTime();
    if (t < fromMs || t > toMs) continue;
    totalScanned++;
    if (!includeTest && /^TEST_/i.test(code)) { testSkipped++; continue; }
    if (existingCodes.has(code.toUpperCase())) { alreadyInSheet++; continue; }
    newRows.push(rowFor(p, p.brand));
    existingCodes.add(code.toUpperCase());
    added++;
  }
  process.stdout.write(`→ +${added}\n`);
} catch (err) {
  process.stdout.write(`→ ERROR: ${err.message.substring(0, 60)}\n`);
}

// ── 3. Summary + preview ──────────────────────────────────────────────────
console.log(`\nSummary:`);
console.log(`  BO promos in week range : ${totalScanned}`);
console.log(`  TEST_ skipped           : ${testSkipped}`);
console.log(`  Already in sheet        : ${alreadyInSheet}`);
console.log(`  To append               : ${newRows.length}`);

if (newRows.length === 0) {
  console.log('\nNothing to append. Dashboard is in sync with BO.');
  process.exit(0);
}

console.log(`\nPreview (first 5 rows):`);
console.log(`  Date       | Code                          | Brand    | Region     | Created By  | Type            | Status`);
for (const r of newRows.slice(0, 5)) {
  console.log(`  ${r[0]} | ${String(r[1]).padEnd(29)} | ${String(r[2]).padEnd(8)} | ${String(r[3]).padEnd(10)} | ${String(r[4]).padEnd(11)} | ${String(r[5]).padEnd(15)} | ${r[6]}`);
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
console.log(`\nThe dashboard will reflect this within ~10 min (cache TTL).`);
console.log(`To force-refresh now, open Apps Script editor → Run → serverRefreshData.`);
