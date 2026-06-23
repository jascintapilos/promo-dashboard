#!/usr/bin/env node
// Writes Week 5 (01-05 Jun 2026) to the May 2026 tracker.
// Only 1 working day: Fri 05/06 (Mon-Tue=PH, Wed-Thu=AL)
// Budget: 8h (1 day × 8h) → F = =8-E, G = =(E/8)*100
//   PROMO_SHEET_ID=<id> node bin/hours-write-week5.mjs

import { getSheetsClient, getSpreadsheetId } from '../src/sheets-client.js';

const TAB = 'May 2026';
const FIRST_DATA_ROW = 144;  // Fri 05/06 first entry — SUM anchor for Week 5

const c = await getSheetsClient();
const ssId = getSpreadsheetId();

const dataRow = (date, task, hours, rowNum) => [
  date, task, '', hours,
  `=SUM($D$${FIRST_DATA_ROW}:D${rowNum})`,
  `=8-E${rowNum}`,
  `=(E${rowNum}/8)*100`,
];
const leaveRow = (date, label) => [date, label, '', '', '', '', ''];

// [rowNum, rowData]
const rows = [
  // WEEK 5 marker
  [139, ['WEEK 5']],

  // Mon 01/06 — Public Holiday
  [140, leaveRow('01/06/2026', 'PH')],

  // Tue 02/06 — Public Holiday
  [141, leaveRow('02/06/2026', 'PH')],

  // Wed 03/06 — Annual Leave
  [142, leaveRow('03/06/2026', 'AL')],

  // Thu 04/06 — Annual Leave
  [143, leaveRow('04/06/2026', 'AL')],

  // Fri 05/06 — working day (8h)
  [144, dataRow('05/06/2026',
    'Weekly catch up (WY, Khaswini, Elyssa, Menhua, Jeeveneshwary, Gaby, Bangun — Zoom)',
    2, 144)],
  [145, dataRow('',
    'VM Slot for Catch Ups (Shyam Sunthar, Mimi, WY — Zoom)',
    1, 145)],
  [146, dataRow('',
    'AM Workflow Meeting (Kevin Teh, WY — Zoom)',
    1, 146)],
  [147, dataRow('',
    'Slack coordination & team management — WY DM (escalation channel advisory, QC response monitoring), #promotions-team Sales/Promo merger HR announcement + Bangun front-end QC follow-up, DM with Wen (family leave approval), DM with Ju (payslip inquiry), weekly meeting time confirmation',
    1.5, 147)],
  [148, dataRow('',
    'Career development — OKR & personal goal plan drafting (Claude-assisted; phased plan toward Promo/CRM Team Lead, prepared for WY review)',
    1.5, 148)],
  [149, dataRow('',
    'Claude Automation — ongoing P### saves continuation (sessions carried over from Week 4)',
    0.5, 149)],
  [150, dataRow('',
    'Claude Automation — Work hours tracker Week 5 update (01-05 Jun) via connected apps',
    0.5, 150)],
];

const data = rows.map(([rowNum, rowData]) => ({
  range: `'${TAB}'!A${rowNum}:G${rowNum}`,
  values: [rowData],
}));

console.log(`Writing ${data.length} rows for Week 5 (R139–R150)…`);
const resp = await c.sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: ssId,
  requestBody: { valueInputOption: 'USER_ENTERED', data },
});
console.log(`✓ ${resp.data.totalUpdatedCells} cells updated across ${resp.data.totalUpdatedRanges} ranges.`);
console.log(`Week 5 budget: 8h (1 working day). Fri=8h → 100%.`);
