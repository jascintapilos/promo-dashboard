#!/usr/bin/env node
// Writes WEEK 3 marker + 18-21 May entries to the Work Hours tracker.
//   PROMO_SHEET_ID=<id> node bin/hours-write-week3.mjs

import { getSheetsClient, getSpreadsheetId } from '../src/sheets-client.js';

const TAB = 'May 2026';
const MARKER_ROW = 95;         // "WEEK 3"
const FIRST_DATA_ROW = 96;     // first 18/05 entry

// [date, task, bo, hours]
const rows = [
  ['18/05/2026', 'Slack coordination — promo_testbot rollout announcement (#promotions-team), P050+ QC status follow-ups, automation testing handover for QP2A/QPRO15-17, Wen calendar cancellation', '', 2],
  ['',           'Claude Automation — Banner upload-promo.js completion (B16 verified end-to-end on QPRO16)', '', 2],
  ['',           'Claude Automation — P071/P072 promo saves + 7 mapper fixes (deposit_status=4, Layer-1 by code, QPRO PUT no promotion_currency, infer refer from name pattern, inbox refer to existing template)', '', 3],
  ['',           'Weekly Report Dashboard update for WY review (#promotions-team)', '', 0.5],
  ['19/05/2026', 'Discussion (self-scheduled, 10:30 AM)', '', 0.5],
  ['',           'ID Weekly Meeting (Zoom, recurring)', '', 0.5],
  ['',           'Slack coordination — banner E688 update with Luso (#ba-design), Claude file-lock troubleshooting with Wen/WY, IGMP MY password reset with Alysa', '', 1],
  ['',           'Claude Automation — QP2C Miro customer journey board + REST API builder (18 cohort codes, 4 layouts V1-V4)', '', 1.5],
  ['',           'Claude Automation — B16/B17 fetchDocHtml fixes + Microgaming RTG banner completion (QPRO16+QPRO17)', '', 1.5],
  ['',           'Claude Automation — QP2A EVEMGRTGA + QPRO15 T&C hyperlink fixes (B15 complete, three fetchDocHtml copies synced)', '', 1],
  ['',           'Claude Automation — Deactivate 231 test promos (0 errors) + rebate add-provider script (bin/add-provider-to-rebate.mjs, PP2 dry-run across 17 brands)', '', 1],
  ['',           'Claude Automation — EVEMRTG content fixes across QP2A + QPRO15/16/17 (4 fix scripts, T&C hyperlink rules formalized)', '', 1],
  ['',           'Claude Automation — WS1/WS2 UICarousel probe (MB8 PH=158 confirmed, RWS77 MY=1, form schema documented)', '', 0.5],
  ['20/05/2026', 'Slack coordination — #ba-promo task delegation rounds (P075-P084, P085-P090, P091-P096 = 22 promos across 4 team members), Group DM on WS1 sportsbook bonus, #vm-am-promotions-projects P077/P078 verification with Kevin Teh', '', 2],
  ['',           'Promo Ops weekly dashboard development for WY review', '', 1],
  ['',           'Claude Automation — WS1 UICarousel Files field investigation (B01 attempted, drawer discarded, paperclip flow identified)', '', 1],
  ['',           'Claude Automation — browser-bridge IGMP saves P085-P090 × MY+SG (12 saves via Claude-in-Chrome + local CORS plan server)', '', 2],
  ['',           'Claude Automation — P075-P096 VIP Reload full loop on QPRO4 + QP2C (32 promos saved through 7 fix rounds, 13 helper scripts, 7 new feedback rules)', '', 3],
  ['21/05/2026', 'Discussion with Sales (self-scheduled, 11:40 AM)', '', 0.5],
  ['',           'Biweekly Tech (PureIS) Planning Meeting (Zoom)', '', 1],
  ['',           'Slack coordination — #ba-promo QC follow-ups, banner position fixes, Wen DM on manual reporting, Sales remark coordination', '', 1],
  ['',           'Claude Automation — Work hours tracker update for Week 3 (18-21 May) via connected apps', '', 0.5],
];

const c = await getSheetsClient();

// 1) Write the WEEK 3 marker
{
  const range = `'${TAB}'!A${MARKER_ROW}`;
  await c.sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['WEEK 3']] },
  });
  console.log(`✓ WEEK 3 marker written to ${range}`);
}

// 2) Write the data rows with formulas
const values = rows.map((r, i) => {
  const rowNum = FIRST_DATA_ROW + i;
  return [
    r[0],
    r[1],
    r[2],
    r[3],
    `=SUM($D$${FIRST_DATA_ROW}:D${rowNum})`,
    `=40-E${rowNum}`,
  ];
});

const lastRow = FIRST_DATA_ROW + rows.length - 1;
const dataRange = `'${TAB}'!A${FIRST_DATA_ROW}:F${lastRow}`;
console.log(`Writing ${rows.length} rows to ${dataRange}…`);
const resp = await c.sheets.spreadsheets.values.update({
  spreadsheetId: getSpreadsheetId(),
  range: dataRange,
  valueInputOption: 'USER_ENTERED',
  requestBody: { values },
});
console.log(`✓ ${resp.data.updatedCells} cells updated across rows ${FIRST_DATA_ROW}–${lastRow}.`);
