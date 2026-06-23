/**
 * Backfill "Uploaded By" in the live Banner Log sheet by pulling created_by
 * from every QPRO + QP2 BO and matching on Banner Title + Brand family.
 *
 * DRY RUN by default — pass --write to commit.
 *
 * Usage:
 *   node bin/backfill-banner-uploaded-by.mjs
 *   node bin/backfill-banner-uploaded-by.mjs --write
 */
import { getAllBanners } from '../src/api-client.js';
import { QP2_BRAND_TO_IDS } from '../src/api-mapper-qp2.js';
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';
import { parseArgs } from './_args.js';

const { flags } = parseArgs(process.argv.slice(2));
const WRITE = flags.write === true;
const SLEEP_MS = 350;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SHEET_ID   = getOpsSheetId();
const BANNER_TAB = 'Banner Log';

const QPRO_BRANDS = Array.from({ length: 17 }, (_, i) => ({ brand: `QPRO${i + 1}`, siteId: `qpro${i + 1}` }));
const QP2_MERCHANTS = Object.entries(QP2_BRAND_TO_IDS).map(([brand, ids]) => ({ brand, siteId: 'ibc22', merchantId: ids.merchantId }));

// ── Build BO lookup: label → { created_by } ──────────────────────────────────
// Key: normalised label (lowercase trimmed). QP2 shares banners across merchants.
console.log(`\nBuilding BO banner lookup (all QPRO + QP2)…`);
const boLookup = new Map(); // label_lc → created_by

for (const { brand, siteId } of QPRO_BRANDS) {
  process.stdout.write(`  ${brand.padEnd(8)} `);
  try {
    const { rows, total } = await getAllBanners(siteId);
    for (const r of rows) {
      const key = (r.label || '').trim().toLowerCase();
      if (key && !boLookup.has(key)) boLookup.set(key, r.created_by || '');
    }
    process.stdout.write(`${total} banners\n`);
  } catch (e) {
    process.stdout.write(`ERROR ${e.message.slice(0, 60)}\n`);
  }
  await sleep(SLEEP_MS);
}

// QP2 — just first merchant is enough for created_by
process.stdout.write(`  QP2       `);
try {
  const firstMerchant = QP2_MERCHANTS[0];
  const { rows, total } = await getAllBanners(firstMerchant.siteId, { extra: { merchant_id: String(firstMerchant.merchantId) } });
  for (const r of rows) {
    const key = (r.label || '').trim().toLowerCase();
    if (key && !boLookup.has(key)) boLookup.set(key, r.created_by || '');
  }
  process.stdout.write(`${total} banners\n`);
} catch (e) {
  process.stdout.write(`ERROR ${e.message.slice(0, 60)}\n`);
}

console.log(`\nBO lookup built: ${boLookup.size} unique banner labels`);

// ── Read Banner Log ──────────────────────────────────────────────────────────
const { sheets } = await getSheetsClient();
const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${BANNER_TAB}'!A:Z` });
const all = res.data.values || [];
const hdr = all[0] || [];

const cTitle  = hdr.findIndex(h => /banner.?title/i.test(h));
const cUpBy   = hdr.findIndex(h => /uploaded.?by/i.test(h));

if (cTitle < 0 || cUpBy < 0) {
  console.error(`Cannot find required columns. Headers: ${hdr.join(', ')}`);
  process.exit(1);
}

// Column letter helper (0-based → A, B, …, Z, AA, …)
function colLetter(n) {
  let s = '';
  n++;
  while (n > 0) { s = String.fromCharCode(64 + (n % 26 || 26)) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
const upByCol = colLetter(cUpBy);

// ── Find empty rows and match ─────────────────────────────────────────────────
const updates = []; // { row1index, value }
let matched = 0, unmatched = 0;

for (let i = 1; i < all.length; i++) {
  const row = all[i];
  const currentUpBy = (row[cUpBy] || '').trim();
  if (currentUpBy) continue; // already filled

  const title = (row[cTitle] || '').trim().toLowerCase();
  const found = boLookup.get(title);
  if (found) {
    updates.push({ sheetRow: i + 1, value: found }); // 1-indexed
    matched++;
  } else {
    unmatched++;
  }
}

console.log(`\nEmpty "Uploaded By" rows: ${matched + unmatched}`);
console.log(`  Matched in BO:   ${matched}`);
console.log(`  No BO match:     ${unmatched}`);

if (updates.length === 0) {
  console.log('\nNothing to update.');
  process.exit(0);
}

// Preview first 10
console.log('\nSample updates:');
for (const u of updates.slice(0, 10)) {
  const rowData = all[u.sheetRow - 1];
  const title = (rowData[cTitle] || '').slice(0, 40);
  console.log(`  Row ${String(u.sheetRow).padStart(4)}: "${title}" → ${u.value}`);
}
if (updates.length > 10) console.log(`  … +${updates.length - 10} more`);

if (!WRITE) {
  console.log(`\n(DRY RUN — ${updates.length} cells would be updated. Re-run with --write to commit.)`);
  process.exit(0);
}

// ── Batch update ──────────────────────────────────────────────────────────────
// Chunk into batches of 500 to avoid request size limits
const BATCH = 500;
let written = 0;
for (let i = 0; i < updates.length; i += BATCH) {
  const chunk = updates.slice(i, i + BATCH);
  const data = chunk.map(u => ({
    range: `'${BANNER_TAB}'!${upByCol}${u.sheetRow}`,
    values: [[u.value]],
  }));
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { valueInputOption: 'RAW', data },
  });
  written += chunk.length;
  console.log(`  Written ${written}/${updates.length}…`);
}

console.log(`\n✅ Filled "Uploaded By" for ${written} rows in '${BANNER_TAB}'.`);
