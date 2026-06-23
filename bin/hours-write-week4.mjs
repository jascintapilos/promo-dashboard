#!/usr/bin/env node
// Writes Week 4 (25-29 May 2026) to the May tracker.
// Only 2 working days: Tue 26/05 + Thu 28/05 (Mon=AL, Wed=PH, Fri=AL)
// Budget: 16h (2 days × 8h) → F = =16-E, G = =(E/16)*100
//   PROMO_SHEET_ID=<id> node bin/hours-write-week4.mjs

import { getSheetsClient, getSpreadsheetId } from '../src/sheets-client.js';

const TAB = 'May 2026';
const SHEET_ID = 222110442;

// First row that carries actual hours — used as SUM anchor
const FIRST_DATA_ROW = 128;  // Tue 26/05 first entry

const c = await getSheetsClient();
const ssId = getSpreadsheetId();

// ── helpers ────────────────────────────────────────────────────────────────
const dataRow = (date, task, hours, rowNum) => [
  date,
  task,
  '',
  hours,
  `=SUM($D$${FIRST_DATA_ROW}:D${rowNum})`,
  `=16-E${rowNum}`,
  `=(E${rowNum}/16)*100`,
];

// Leave/PH rows — no running totals, just a marker
const leaveRow = (date, label) => [date, label, '', '', '', '', ''];

// ── data ───────────────────────────────────────────────────────────────────
// [rowNum, row-data-array]
const rows = [
  // Mon 25/05 — Annual Leave
  [127, leaveRow('25/05/2026', 'AL')],

  // Tue 26/05 — working day (8h)
  [128, dataRow('26/05/2026',
    'Sales / Promo Alignment (WY, Shyam Sunthar, Kevin Teh — Zoom)',
    1, 128)],
  [129, dataRow('',
    'ID Weekly Meeting (Zoom, recurring)',
    1, 129)],
  [130, dataRow('',
    'Slack coordination — #ba-promo P106-P121 QC task delegation (Elyssa/Wen/Bangun/Alysa/Gaby), banner request guidance (Claudia/Wen/Gaby), VM Blasting CRM mass assignment (QPRO2-3/5), #promotions-team bot request-template coaching for Elyssa',
    2, 130)],
  [131, dataRow('',
    'Claude Automation — P106-P121 batch saves (16 requests: World Cup Churned Player campaign, WS1/QP2A × MY+SG; full ingest → fixture → canary loop)',
    4, 131)],

  // Wed 27/05 — Public Holiday
  [132, leaveRow('27/05/2026', 'PH')],

  // Thu 28/05 — working day (8h)
  [133, dataRow('28/05/2026',
    'Catch up - Wen (WY, Booninn — Zoom) — probation performance review discussion',
    1, 133)],
  [134, dataRow('',
    'Slack coordination & personnel management — WY DM (probation assessment documentation + Wen performance follow-up write-up), #ba-promo Elyssa MC coverage + task rerouting to Wen, DM with Gaby (system password reset + access onboarding)',
    2.5, 134)],
  [135, dataRow('',
    'Biweekly Tech (Aiodin) Planning Meeting (Zoom)',
    1, 135)],
  [136, dataRow('',
    'Claude Automation — Blacklist Template canary fix (correct field insertion order before save, QPRO + QP2 all bonus types) + P106-P121 continued saves',
    3, 136)],
  [137, dataRow('',
    'Claude Automation — Work hours tracker Week 4 update (25-28 May) via connected apps',
    0.5, 137)],

  // Fri 29/05 — Annual Leave
  [138, leaveRow('29/05/2026', 'AL')],
];

// ── write ──────────────────────────────────────────────────────────────────
const data = rows.map(([rowNum, rowData]) => ({
  range: `'${TAB}'!A${rowNum}:G${rowNum}`,
  values: [rowData],
}));

console.log(`Writing ${data.length} rows for Week 4 (R127–R138)…`);
const resp = await c.sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: ssId,
  requestBody: {
    valueInputOption: 'USER_ENTERED',
    data,
  },
});
console.log(`✓ ${resp.data.totalUpdatedCells} cells updated across ${resp.data.totalUpdatedRanges} ranges.`);
console.log(`Week 4 budget: 16h (2 working days). Tue=8h, Thu=8h → 100%.`);
