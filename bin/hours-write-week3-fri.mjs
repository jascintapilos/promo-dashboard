#!/usr/bin/env node
// Writes Fri 22/05 entries to complete Week 3 in the May 2026 tracker.
//   PROMO_SHEET_ID=<id> node bin/hours-write-week3-fri.mjs

import { getSheetsClient, getSpreadsheetId } from '../src/sheets-client.js';

const TAB = 'May 2026';
const WEEK3_FIRST_DATA_ROW = 96;  // =SUM anchor for Week 3 (matches hours-write-week3.mjs)
const FIRST_ROW = 120;             // R120 = first Fri 22/05 entry (R119 was Thu tracker update)

// [date, task, bo, hours]
const rows = [
  ['22/05/2026', 'Slack coordination — DM with Ryan (call availability), DM with WY (check-in), #ba-promo P102-P105 QC task delegation to Alysa/Wen + pending codes shared with Ryan, FT/Smartico mass-assignment flow discussion (evening), #promotions-team automation prompts reference post', '', 1],
  ['',           'Weekly Catch Up (WY, Booninn, Elyssa, Menhua, Gaby, Bangun — Zoom)', '', 2],
  ['',           'Claude Automation — P102-P105 WCC Deposit+FC saves (16 saves: WCC_REL_80PCT_20X, WCC_REL_100PCT_20X, WCC_20FC_20X, WCC_30FC_15X × QPRO3/4/5/9; FC popup template fix; message template exclusion-clause fix; 3 new feedback rules)', '', 2.5],
  ['',           'Claude Automation — P106/P107 World Cup Churned Player investigation (WS1/QP2A × MY+SG; merged-cell fill-down fix; FS+Reload paired choice resolved; carry-forward to next session)', '', 1.5],
  ['',           'Claude Automation — Weekly Report Dashboard sync deployed (#promotions-team — shared Sync link with WY for next Monday auto-refresh)', '', 0.5],
  ['',           'Claude Automation — Work hours tracker Week 3 completion (18-22 May) via connected apps', '', 0.5],
];

const c = await getSheetsClient();

const values = rows.map((r, i) => {
  const rowNum = FIRST_ROW + i;
  return [
    r[0],
    r[1],
    r[2],
    r[3],
    `=SUM($D$${WEEK3_FIRST_DATA_ROW}:D${rowNum})`,
    `=40-E${rowNum}`,
  ];
});

const lastRow = FIRST_ROW + rows.length - 1;
const range = `'${TAB}'!A${FIRST_ROW}:F${lastRow}`;
console.log(`Writing ${rows.length} Fri 22/05 rows to ${range}…`);

const resp = await c.sheets.spreadsheets.values.update({
  spreadsheetId: getSpreadsheetId(),
  range,
  valueInputOption: 'USER_ENTERED',
  requestBody: { values },
});
console.log(`✓ ${resp.data.updatedCells} cells updated across rows ${FIRST_ROW}–${lastRow}.`);
console.log(`Week 3 cumulative target: 40.0h (budget met)`);
