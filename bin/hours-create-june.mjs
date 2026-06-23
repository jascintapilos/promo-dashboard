#!/usr/bin/env node
// Creates the "June 2026" tab and writes Week 5 (01-05 Jun).
// Only 1 working day: Fri 05/06 (Mon-Tue=PH, Wed-Thu=AL)
// Budget: 8h (1 day) → F = =8-E, G = =(E/8)*100
//   PROMO_SHEET_ID=<id> node bin/hours-create-june.mjs

import { getSheetsClient, getSpreadsheetId } from '../src/sheets-client.js';

const TAB = 'June 2026';
const FIRST_DATA_ROW = 7;   // Fri 05/06 first entry (after header + WEEK5 + 4 leave rows)

const c = await getSheetsClient();
const ssId = getSpreadsheetId();

// ── Step 1: Add the new sheet tab ─────────────────────────────────────────
console.log(`Creating tab "${TAB}"…`);
const addResp = await c.sheets.spreadsheets.batchUpdate({
  spreadsheetId: ssId,
  requestBody: {
    requests: [{
      addSheet: {
        properties: {
          title: TAB,
          index: 0,   // insert as first tab (leftmost)
          gridProperties: { rowCount: 1076, columnCount: 26 },
        },
      },
    }],
  },
});
const newSheetId = addResp.data.replies[0].addSheet.properties.sheetId;
console.log(`✓ Tab created (sheetId=${newSheetId}).`);

// ── Step 2: Write header + Week 5 data ────────────────────────────────────
const dataRow = (date, task, hours, rowNum) => [
  date, task, '', hours,
  `=SUM($D$${FIRST_DATA_ROW}:D${rowNum})`,
  `=8-E${rowNum}`,
  `=(E${rowNum}/8)*100`,
  '',   // Remarks column
];
const leaveRow  = (date, label) => [date, label, '', '', '', '', '', ''];
const markerRow = (label)       => [label];

const writes = [
  // R1 — headers (match May 2026 exactly)
  {
    range: `'${TAB}'!A1:H1`,
    values: [[
      'Date',
      'Task/Name',
      'BO',
      'Duration (hrs)',
      'Cumulative Hours',
      'Remaining Hours (40 - Cumulative)',
      '% of Utilisation =(Cumulative Hours/40)*100',
      'Remarks',
    ]],
  },
  // R2 — WEEK 5 marker
  { range: `'${TAB}'!A2`, values: [markerRow('WEEK 5')] },
  // R3-R6 — PH / AL days
  { range: `'${TAB}'!A3:H3`, values: [leaveRow('01/06/2026', 'PH')] },
  { range: `'${TAB}'!A4:H4`, values: [leaveRow('02/06/2026', 'PH')] },
  { range: `'${TAB}'!A5:H5`, values: [leaveRow('03/06/2026', 'AL')] },
  { range: `'${TAB}'!A6:H6`, values: [leaveRow('04/06/2026', 'AL')] },
  // R7-R13 — Fri 05/06 work entries
  { range: `'${TAB}'!A7:H7`,  values: [dataRow('05/06/2026',
      'Weekly catch up (WY, Khaswini, Elyssa, Menhua, Jeeveneshwary, Gaby, Bangun — Zoom)',
      2, 7)] },
  { range: `'${TAB}'!A8:H8`,  values: [dataRow('',
      'VM Slot for Catch Ups (Shyam Sunthar, Mimi, WY — Zoom)',
      1, 8)] },
  { range: `'${TAB}'!A9:H9`,  values: [dataRow('',
      'AM Workflow Meeting (Kevin Teh, WY — Zoom)',
      1, 9)] },
  { range: `'${TAB}'!A10:H10`, values: [dataRow('',
      'Slack coordination & team management — WY DM (escalation channel advisory, QC response monitoring), #promotions-team Sales/Promo merger HR announcement + Bangun front-end QC follow-up, DM with Wen (family leave approval), DM with Ju (payslip inquiry), weekly meeting time confirmation',
      1.5, 10)] },
  { range: `'${TAB}'!A11:H11`, values: [dataRow('',
      'Career development — OKR & personal goal plan drafting (Claude-assisted; phased plan toward Promo/CRM Team Lead, prepared for WY review)',
      1.5, 11)] },
  { range: `'${TAB}'!A12:H12`, values: [dataRow('',
      'Claude Automation — ongoing P### saves continuation (sessions carried over from Week 4)',
      0.5, 12)] },
  { range: `'${TAB}'!A13:H13`, values: [dataRow('',
      'Claude Automation — Work hours tracker Week 5 update (01-05 Jun) via connected apps',
      0.5, 13)] },
];

console.log(`Writing ${writes.length} ranges to "${TAB}"…`);
const resp = await c.sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: ssId,
  requestBody: { valueInputOption: 'USER_ENTERED', data: writes },
});
console.log(`✓ ${resp.data.totalUpdatedCells} cells updated across ${resp.data.totalUpdatedRanges} ranges.`);
console.log(`Week 5 budget: 8h (1 working day). Fri 05/06 = 8h → 100%.`);
