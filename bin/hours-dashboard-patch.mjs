#!/usr/bin/env node
// Patch the May 2026 tracker to surface the multi-day Weekly Report Dashboard
// / Promo Ops dashboard automation work that was previously under-counted.
//
//   Mon 18/05: R99 expanded from 0.5h to 3h (ADD — day total grows to 10h)
//   Tue 19/05: INSERT new dashboard row at R109; redistribute R103, R104 to keep 8.5h total
//   Wed 20/05: bump R111 (Promo Ops) from 1h to 3h; redistribute R110, R113, R114 to keep 9h
//   Thu 21/05: INSERT new dashboard row before tracker-update row; total grows naturally
//
//   PROMO_SHEET_ID=<id> node bin/hours-dashboard-patch.mjs

import { getSheetsClient, getSpreadsheetId } from '../src/sheets-client.js';

const TAB = 'May 2026';
const SHEET_ID = 222110442; // gid for May 2026

const c = await getSheetsClient();
const ssId = getSpreadsheetId();

// ───────────────────────────────────────────────────────────────────────
// Step 1: Insert 2 blank rows (bottom-up so the upper insert isn't shifted)
//
// Op A: insert before row 117 (1-based) → Sheets API uses 0-based startIndex=116
//       Result: old R117 (Thu tracker update) shifts to R118
// Op B: insert before row 109 (1-based) → startIndex=108
//       Result: old R109+ shifts down by 1
//       After both: R109 empty (Tue dashboard slot), R118 empty (Thu dashboard slot),
//                   R119 = old Thu tracker update
// ───────────────────────────────────────────────────────────────────────

console.log('Inserting 2 blank rows (Tue dashboard slot + Thu dashboard slot)…');
await c.sheets.spreadsheets.batchUpdate({
  spreadsheetId: ssId,
  requestBody: {
    requests: [
      // BOTTOM insert first (so the TOP insert math stays simple)
      {
        insertDimension: {
          range: {
            sheetId: SHEET_ID,
            dimension: 'ROWS',
            startIndex: 116, // before row 117 → row 117 becomes empty
            endIndex: 117,
          },
          inheritFromBefore: true, // copy formatting from row above (incl. col-G % formula)
        },
      },
      // TOP insert second (only affects rows < its position, which is already accounted for)
      {
        insertDimension: {
          range: {
            sheetId: SHEET_ID,
            dimension: 'ROWS',
            startIndex: 108, // before row 109 → row 109 becomes empty
            endIndex: 109,
          },
          inheritFromBefore: true,
        },
      },
    ],
  },
});
console.log('✓ Inserts done.');

// ───────────────────────────────────────────────────────────────────────
// Step 2: Write all the new/edited cells in one batch.
// Row numbers below are the FINAL row numbers AFTER both inserts.
// ───────────────────────────────────────────────────────────────────────

const writes = [
  // ─── Mon 18/05: bump R99 dashboard from 0.5h → 3h ──────────────────────
  {
    range: `'${TAB}'!B99:D99`,
    values: [[
      'Claude Automation — Weekly Report Dashboard initial build (combine weekly reports from Drive folder into total + weekly comparison, Apps Script web-app deploy, shared with WY at 5:14 PM)',
      '',
      3,
    ]],
  },

  // ─── Tue 19/05: trim R103, R104; write new R109 dashboard row ─────────
  { range: `'${TAB}'!D103`, values: [[1]] },
  { range: `'${TAB}'!D104`, values: [[1]] },
  {
    range: `'${TAB}'!A109:F109`,
    values: [[
      '',
      'Claude Automation — Weekly Report Dashboard refinement (between QP2C / EVEMGRTGA / EVEMRTG milestones)',
      '',
      1,
      '=SUM($D$96:D109)',
      '=40-E109',
    ]],
  },

  // ─── Wed 20/05 (NOW at rows 110-114 after Tue insert) ─────────────────
  // Bump R111 (Promo Ops dashboard) 1h → 3h; trim R110, R113, R114
  { range: `'${TAB}'!D110`, values: [[1.5]] },  // Slack coord 2 → 1.5
  {
    range: `'${TAB}'!B111:D111`,
    values: [[
      'Claude Automation — Promo Ops weekly dashboard expanded build (shared "Promo Ops" link with WY, still developing per Slack at 17:30)',
      '',
      3,
    ]],
  },
  { range: `'${TAB}'!D113`, values: [[1.5]] },  // browser-bridge IGMP 2 → 1.5
  { range: `'${TAB}'!D114`, values: [[2]] },    // VIP Reload 3 → 2

  // ─── Thu 21/05: write new R118 dashboard row ──────────────────────────
  {
    range: `'${TAB}'!A118:F118`,
    values: [[
      '',
      'Claude Automation — Promo Ops dashboard continued development (in-progress when Wen DM said "keep manual for now, will automate once core tasks done")',
      '',
      1.5,
      '=SUM($D$96:D118)',
      '=40-E118',
    ]],
  },

  // (R119 is the existing Thu tracker update row, shifted from R117. Its
  //  formulas in E/F should have auto-adjusted; no rewrite needed.)
];

console.log(`Writing ${writes.length} cell ranges…`);
const resp = await c.sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: ssId,
  requestBody: {
    valueInputOption: 'USER_ENTERED',
    data: writes,
  },
});
console.log(`✓ ${resp.data.totalUpdatedCells} cells updated across ${resp.data.totalUpdatedRanges} ranges.`);
