// Live-sheet ingest. Reads the current-month tab of the Promo Code Request
// Details Template directly via the Sheets API (no XLSX download) and
// produces fixture records in the same shape as src/ingest-xlsx.js.
//
// Per Jascinta 2026-05-16: "Future workflow must go through the live sheet
// first." The XLSX path (refresh-sheet.mjs → captures/sheet-extracted/ →
// ingest-xlsx.js) is still wired for offline / backfill but isn't the
// primary intake any more.
//
// Public API:
//   ingestCurrentMonthFromSheet({ today, onlyQcCompleted, tabNameOverride })
//     → { tab, records, colMap, sheetRowCount }
//
// Records are interchangeable with ingest-xlsx.js output — same fields,
// same `source_line` semantics (sheet row number is the same on both
// paths), same `handle` shape (`P###-rN`).

import {
  getSheetsClient,
  getSpreadsheetId,
  resolveCurrentMonthTab,
  readHeader,
  detectColumnMapFromHeader,
  a1Range,
} from './sheets-client.js';
import { rowToRecord } from './ingest-xlsx.js';
import { deriveNames } from './promo-namer.js';

// How many rows past the last data row to read on a single GET. Bounded so
// we don't pull an enormous range from sheets-with-lots-of-empty-rows.
const DEFAULT_MAX_ROWS = 1000;

export async function ingestCurrentMonthFromSheet({
  today,
  onlyQcCompleted = false,
  tabNameOverride,
  maxRows = DEFAULT_MAX_ROWS,
} = {}) {
  const client = await getSheetsClient();
  const tab = tabNameOverride || await resolveCurrentMonthTab(client, today || new Date());
  const header = await readHeader(client, tab);
  const colMap = detectColumnMapFromHeader(header);

  // Range goes up to column AZ to cover any added columns past the header
  // length we detected. Sheets API tolerates over-shoot ranges.
  const range = a1Range(tab, `A2:AZ${maxRows}`);
  const res = await client.sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  const dataRows = res.data.values || [];

  // Fill merged cells down. Sheets API returns the value only in the
  // top-left cell of a merge; the rest come back empty. The operator
  // routinely uses vertical merges to share fields like Brand / Region /
  // Campaign / Name-Details across a campaign block of N rows (e.g.
  // P106-P117 share Brand+Region+Campaign; P106-P107 also share M+N).
  // Without this fill-down, child rows look empty even though they
  // inherit the parent's values. Fix: probe merges once and patch
  // dataRows in place. Data rows start at sheet row 2 (header = 1),
  // so dataRows[i] corresponds to sheet row i+2.
  await fillMergedCellsDown(client, tab, dataRows);

  const records = [];
  const namerStats = { override: 0, derived: 0, incomplete: 0, unsupported: 0, already_named: 0 };
  for (let i = 0; i < dataRows.length; i++) {
    const sheetRowNum = i + 2;  // header is row 1; data starts at 2
    const cells = dataRows[i];
    if (!cells || cells.length === 0) continue;
    const rec = rowToRecord(cells, colMap, sheetRowNum);
    if (!rec) continue;
    // Remember which tab this record came from — writeback must target the
    // SAME tab, not "whatever month it is today". Without this, fixing a
    // request from a past month (e.g. re-canarying a June request in July)
    // silently writes into the current month's tab at the same row number,
    // corrupting an unrelated row. See project_sheet_writeback_tab_bug.md.
    rec.source_tab = tab;
    if (onlyQcCompleted && !/qc.*complete/i.test(rec.status)) continue;
    // Auto-name: if the operator left promo_code blank, derive from
    // bonus_type + parsed.* + instructions. Don't clobber existing values.
    if (!rec.promo_code) {
      const named = deriveNames(rec);
      if (named.source === 'derived' || named.source === 'override') {
        rec.promo_code = named.promo_code;
        // Only fill names if they're also empty — operator-typed names win.
        if (!rec.promotion_name_en && named.promotion_name_en) rec.promotion_name_en = named.promotion_name_en;
        if (!rec.promotion_name_zh_id && named.promotion_name_zh_id) rec.promotion_name_zh_id = named.promotion_name_zh_id;
        rec.auto_named = { source: named.source };
        namerStats[named.source]++;
      } else {
        rec.auto_named = { source: named.source, missing: named.missing };
        namerStats[named.source]++;
      }
    } else {
      namerStats.already_named++;
      // Code is operator-set but names may still be empty (column M blank).
      // Fill them via deriveNames so popup label / PromotionName are never "".
      if (!rec.promotion_name_en || !rec.promotion_name_zh_id) {
        const named = deriveNames(rec);
        if (named.source === 'derived' || named.source === 'override') {
          if (!rec.promotion_name_en && named.promotion_name_en) rec.promotion_name_en = named.promotion_name_en;
          if (!rec.promotion_name_zh_id && named.promotion_name_zh_id) rec.promotion_name_zh_id = named.promotion_name_zh_id;
        }
      }
    }
    records.push(rec);
  }

  // Post-pass: disambiguate auto-named duplicates within the batch. Two
  // auto-named records that share the same promo_code AND at least one
  // brand will collide in BO. When their parsed.min_deposit values differ,
  // append `_MIN<amount>` to each so each row gets a unique code. Names
  // stay base (per feedback_min_deposit_not_in_name.md — MIN belongs to
  // code only). Operator-typed and override codes are left alone.
  const dedupStats = disambiguateDuplicateCodes(records);
  if (dedupStats.patched > 0) namerStats.deduped = dedupStats.patched;

  return { tab, records, colMap, sheetRowCount: dataRows.length, namerStats };
}

// Fetches merge metadata for `tabName` and, for each vertical (or
// rectangular) merge, copies the top-left cell's value into every other
// cell covered by the merge. Mutates `dataRows` in place.
//
// Sheets API returns merges with 0-indexed half-open ranges:
//   { startRowIndex, endRowIndex, startColumnIndex, endColumnIndex }
// `dataRows[i]` corresponds to sheet row i+2 (sheet row 1 = header, not
// in dataRows). So a merge's `startRowIndex` of 6 → sheet row 7 →
// dataRows index 5.
async function fillMergedCellsDown(client, tabName, dataRows) {
  const res = await client.sheets.spreadsheets.get({
    spreadsheetId: getSpreadsheetId(),
    fields: 'sheets.properties(sheetId,title),sheets.merges',
  });
  const sheet = (res.data.sheets || []).find((s) => s.properties.title === tabName);
  if (!sheet) return;
  const merges = sheet.merges || [];
  if (merges.length === 0) return;
  for (const m of merges) {
    // dataRows is 0-indexed off sheet row 2; only fill the rows within
    // the data range. Skip header-row merges.
    const dataStartIdx = Math.max(0, m.startRowIndex - 1);  // -1 because dataRows[0] is sheet row 2
    const dataEndIdx = m.endRowIndex - 1;  // exclusive
    if (dataStartIdx >= dataRows.length) continue;
    const parentRow = dataRows[dataStartIdx];
    if (!parentRow) continue;
    const col = m.startColumnIndex;
    const parentVal = parentRow[col];
    if (parentVal == null || parentVal === '') continue;
    // Fill every other row in the merge (skip the parent itself).
    for (let i = dataStartIdx + 1; i < dataEndIdx && i < dataRows.length; i++) {
      if (!dataRows[i]) dataRows[i] = [];
      // Pad the row if it's shorter than the column index.
      while (dataRows[i].length <= col) dataRows[i].push('');
      // Only overwrite if the cell is empty — defensive, though the API
      // never populates merge children, so this is paranoia.
      if (dataRows[i][col] == null || dataRows[i][col] === '') {
        dataRows[i][col] = parentVal;
      }
    }
    // Horizontal extent of the merge — also rare but possible. The
    // same rule applies: copy parentVal into every column in the merge
    // for rows in the merge range. Already handled by the loop above
    // for the single column = startColumnIndex; extend if the merge
    // spans multiple columns.
    for (let c = col + 1; c < m.endColumnIndex; c++) {
      for (let i = dataStartIdx; i < dataEndIdx && i < dataRows.length; i++) {
        if (!dataRows[i]) dataRows[i] = [];
        while (dataRows[i].length <= c) dataRows[i].push('');
        if (dataRows[i][c] == null || dataRows[i][c] === '') {
          dataRows[i][c] = parentVal;
        }
      }
    }
  }
}

// Walks auto-named records, groups by (promo_code, brand) pairs, and for
// any group with 2+ records and distinct min_deposit values, appends
// `_MIN<min_deposit>` to each record's promo_code. Returns { patched }.
function disambiguateDuplicateCodes(records) {
  const byCode = new Map();
  for (const r of records) {
    if (!r.auto_named) continue;  // skip operator-typed codes
    if (r.auto_named.source !== 'derived') continue;  // override stays as-is
    const code = r.promo_code;
    const brands = Array.isArray(r.brands) ? r.brands : [];
    if (!code || brands.length === 0) continue;
    const min = r.parsed?.min_deposit;
    if (min == null || min <= 0) continue;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push({ rec: r, brands: new Set(brands), min });
  }
  let patched = 0;
  for (const [code, entries] of byCode) {
    if (entries.length < 2) continue;
    // Build collision graph: any two entries that share a brand collide.
    const collisions = new Set();
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i], b = entries[j];
        const shared = [...a.brands].some((br) => b.brands.has(br));
        if (shared && a.min !== b.min) {
          collisions.add(i);
          collisions.add(j);
        }
      }
    }
    if (collisions.size === 0) continue;
    for (const idx of collisions) {
      const e = entries[idx];
      e.rec.promo_code = `${code}_MIN${e.min}`;
      patched++;
    }
  }
  return { patched };
}
