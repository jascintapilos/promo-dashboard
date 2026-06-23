#!/usr/bin/env node
// Corrects Fri 05/06 entries in June 2026:
// - Splits "Weekly catch up (2h)" into WY 1:1 (0.5h) + team catch up (0.5h)
// - Bumps Slack (1.5→2h) and OKR (1.5→2h) to reflect actual activity depth
// - Adds Tracker row at R14 (previously R13)
// Total stays 8h.
//   PROMO_SHEET_ID=<id> node bin/hours-fix-june-fri.mjs

import { getSheetsClient, getSpreadsheetId } from '../src/sheets-client.js';

const TAB = 'June 2026';
const FIRST_DATA_ROW = 7;

const c = await getSheetsClient();
const ssId = getSpreadsheetId();

const row = (date, task, hours, rowNum) => [
  date, task, '', hours,
  `=SUM($D$${FIRST_DATA_ROW}:D${rowNum})`,
  `=8-E${rowNum}`,
  `=(E${rowNum}/8)*100`,
  '',
];

const writes = [
  { range: `'${TAB}'!A7:H7`,  values: [row('05/06/2026',
      'Catch up with Wai Yip (Zoom) — merger context, team updates',
      0.5, 7)] },
  { range: `'${TAB}'!A8:H8`,  values: [row('',
      'Weekly catch up (WY, Khaswini, Elyssa, Menhua, Jeeveneshwary, Gaby, Bangun — Zoom)',
      0.5, 8)] },
  { range: `'${TAB}'!A9:H9`,  values: [row('',
      'VM Slot for Catch Ups (Shyam Sunthar, Mimi, WY — Zoom)',
      1, 9)] },
  { range: `'${TAB}'!A10:H10`, values: [row('',
      'AM Workflow Meeting (Kevin Teh, WY — Zoom)',
      1, 10)] },
  { range: `'${TAB}'!A11:H11`, values: [row('',
      'Slack coordination & team management — WY DM (escalation channel advisory, QC response monitoring), #promotions-team Sales/Promo merger HR announcement + Bangun front-end QC follow-up, DM with Wen (family leave approval), DM with Ju (payslip inquiry), weekly meeting time confirmation',
      2, 11)] },
  { range: `'${TAB}'!A12:H12`, values: [row('',
      'Career development — OKR & personal goal plan drafting (Claude-assisted; phased plan toward Promo/CRM Team Lead, prepared for WY review)',
      2, 12)] },
  { range: `'${TAB}'!A13:H13`, values: [row('',
      'Claude Automation — ongoing P### saves continuation (sessions carried over from Week 4)',
      0.5, 13)] },
  { range: `'${TAB}'!A14:H14`, values: [row('',
      'Claude Automation — Work hours tracker Week 5 update (01-05 Jun) via connected apps',
      0.5, 14)] },
];

console.log('Rewriting Fri 05/06 entries (R7–R14)…');
const resp = await c.sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: ssId,
  requestBody: { valueInputOption: 'USER_ENTERED', data: writes },
});
console.log(`✓ ${resp.data.totalUpdatedCells} cells updated.`);
