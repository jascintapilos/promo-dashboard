// Batch sheet write-back for P124-P163.
// Writes col W (promo_code), X (promotion_name_en), Y (promotion_name_zh_id)
// for the 39 saved rows. For P132 (duplicate of P124 — not saved), writes
// a note in col W instead.
//
// One single batchUpdate API call → all 40 rows × 3 cols at once.
//
// Run: node bin/_writeback-p124-163.mjs [--commit]

import fs from 'node:fs';
import {
  getSheetsClient, resolveCurrentMonthTab, readHeader,
  detectColumnMapFromHeader, colIndexToLetter, getSpreadsheetId, a1Range,
} from '../src/sheets-client.js';

const commit = process.argv.includes('--commit');
const dir = 'captures/requests';
const files = fs.readdirSync(dir).filter(f => /^P1(2[4-9]|[3-5][0-9]|6[0-3])-/.test(f)).sort();

const P132_NOTE = 'Duplicate of P124 — not saved (identical Replicate source FT_REL_TLEO_LC_45PCT_228MX from QP2D)';

const client = await getSheetsClient();
const tabName = await resolveCurrentMonthTab(client);
const header = await readHeader(client, tabName);
const colMap = detectColumnMapFromHeader(header);
console.log(`Tab: ${tabName}`);
console.log(`Account: ${client.email}`);
console.log(`Mode: ${commit ? 'LIVE (--commit)' : 'DRY-RUN'}`);

const targetFields = ['promo_code', 'promotion_name_en', 'promotion_name_zh_id'];
for (const f of targetFields) {
  if (colMap[f] == null) {
    console.error(`✗ Sheet header missing column for "${f}". Known columns:`, Object.keys(colMap));
    process.exit(3);
  }
  console.log(`  ${f} → col ${colIndexToLetter(colMap[f])}`);
}

// Build the batch
const data = [];
const plan = [];
for (const f of files) {
  const r = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
  const row = r.source_line;
  let writeSet;
  if (r.request_id === 'P132') {
    writeSet = { promo_code: P132_NOTE, promotion_name_en: '', promotion_name_zh_id: '' };
  } else {
    writeSet = {
      promo_code: r.promo_code,
      promotion_name_en: r.promotion_name_en,
      promotion_name_zh_id: r.promotion_name_zh_id,
    };
  }
  for (const [field, value] of Object.entries(writeSet)) {
    const colIdx = colMap[field];
    if (colIdx == null) continue;
    const colLetter = colIndexToLetter(colIdx);
    data.push({ range: a1Range(tabName, `${colLetter}${row}`), values: [[value ?? '']] });
    plan.push({ rn: r.request_id, row, col: colLetter, value: value ?? '' });
  }
}

console.log(`\nBatch: ${data.length} cells across ${files.length} rows`);
console.log('Preview (first 6):');
plan.slice(0, 6).forEach(p => console.log(`  ${p.rn} ${tabName}!${p.col}${p.row} = "${String(p.value).slice(0, 60)}"`));

if (!commit) {
  console.log('\nDRY-RUN — pass --commit to send.');
  process.exit(0);
}

const t0 = Date.now();
const res = await client.sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: getSpreadsheetId(),
  requestBody: { valueInputOption: 'USER_ENTERED', data },
});
const dur = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n✓ batchUpdate completed in ${dur}s`);
console.log(`  totalUpdatedCells: ${res.data.totalUpdatedCells}`);
console.log(`  totalUpdatedRows:  ${res.data.totalUpdatedRows}`);
