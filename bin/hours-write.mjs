#!/usr/bin/env node
// One-shot writer for the Work Hours Utilization tracker — Week 2 (May 2026).
//   PROMO_SHEET_ID=<id> node bin/hours-write.mjs

import { getSheetsClient, getSpreadsheetId, a1Range } from '../src/sheets-client.js';

const TAB = 'May 2026';

// Row shape: [date, task, bo, hours]
// We then auto-add SUM/SUB formulas for E/F. G already exists in-sheet.
const FIRST_ROW = 68;
const rows = [
  ['11/05/2026', 'Weekly BA Standup (Zoom)', '', 0.5],
  ['',           'Promo Briefing — Gabrielle Tiffany (Google Meet)', '', 1],
  ['',           'Job Briefing Session – Bangun PriamBodo (Recruitment + WY, Zoom)', '', 1],
  ['',           'Tommy Claude Discussion (WY, Tommy Yeap, Menhua — Zoom)', '', 1],
  ['',           'Slack coordination — inbox/popup setup with Wen & Claudia, BA-Promo channel link DM with WY, Gaby follow-ups', '', 1],
  ['12/05/2026', 'ID Weekly Meeting (Zoom, recurring)', '', 0.5],
  ['',           'Onboarding new joiner Diandra — Directory + Onboarding Deck shared, Team Contact Details setup, task delegation in #promotions-team', '', 1],
  ['',           'Slack coordination — promo team triage, Gaby + Diandra task check-ins', '', 0.5],
  ['',           'Claude Automation — Promo Code system V1 scaffold + Dashboard prototype + initial canary skeleton (sessions 12:15 PM through evening)', '', 5],
  ['13/05/2026', 'Promo Cost Report Handover Training (Elyssa, Booninn — Zoom)', '', 1],
  ['',           'Training — Promo Code Creation (Bangun, Diandra — Zoom)', '', 1],
  ['',           'Discussion (self-scheduled, 2 PM)', '', 1],
  ['',           'Slack coordination — banner/game training arrangements (Alysa, Wen), promo code reference guide updates (Gaby), folder updates ×3', '', 0.5],
  ['',           'Claude Automation — QPRO11 canary live test: selector hardening, QPRO Deposit + FC end-to-end saves, FS unblocked (TEST_FS_V23), first QP2A Deposit live save', '', 4],
  ['14/05/2026', 'Biweekly Tech (Aiodin) Planning Meeting (Zoom)', '', 1],
  ['',           'Monthly Promotions Meeting (Zoom)', '', 1],
  ['',           'AI Discussion (WY, Tommy Yeap, Menhua — Zoom)', '', 1],
  ['',           'Slack coordination — QPROs IT Update documentation, Bonus Code Conditions doc review with Wen, PH coverage redistribution (Alysa/Elyssa), testbot credentials request for QPRO2-17', '', 1],
  ['',           'Claude Automation — QP2A Member Group click fix; 6.6 Message Template unblocked (Duplicate + pressSequentially); QP2A FC+FS live saves; Playwright CLI migration', '', 4],
  ['15/05/2026', 'Banner Request Training (Gaby, Bangun, Menhua — Zoom)', '', 1],
  ['',           'Weekly Catch Up (WY, Booninn, Elyssa, Menhua, Gaby, Bangun — Zoom)', '', 2],
  ['',           'Translation skill packaging + distribution (Alysa rollout, setup instructions in #promotions-team)', '', 1],
  ['',           'Slack coordination — Group DM with Joel/WY/Ryan on Miro review, Claude troubleshooting DMs with WY', '', 0.5],
  ['',           'Claude Automation — Per-RN operator-instructions parser; multi-brand orchestrator (sequential + parallel); QP2 dialog-popup link solved; canary-api-qp2.js API-direct runner', '', 3],
  ['16/05/2026', 'Claude Automation — API-direct multi-brand canary + XLSX live ingest (auto-tab + auto-header) + Sheets API OAuth + promo auto-namer + full live-sheet pipeline + 21-brand verification', '', 4],
  ['',           'Claude Automation — P068 FS canary unblocked end-to-end (5 blockers peeled: FS provider id, game-code endpoint, currency filter, share-code, popup-per-merchant)', '', 2.5],
  ['17/05/2026', 'Claude Automation — Work hours tracker auto-update via connected apps (Sheets / Calendar / Slack / Drive)', '', 1],
];

const values = rows.map((r, i) => {
  const rowNum = FIRST_ROW + i;
  return [
    r[0],                                  // A: date
    r[1],                                  // B: task
    r[2],                                  // C: BO
    r[3],                                  // D: hours
    `=SUM($D$${FIRST_ROW}:D${rowNum})`,    // E: cumulative
    `=40-E${rowNum}`,                      // F: remaining
  ];
});

const c = await getSheetsClient();
const lastRow = FIRST_ROW + rows.length - 1;
const range = `'${TAB}'!A${FIRST_ROW}:F${lastRow}`;
console.log(`Writing ${rows.length} rows to ${range} on ${getSpreadsheetId()}…`);

const resp = await c.sheets.spreadsheets.values.update({
  spreadsheetId: getSpreadsheetId(),
  range,
  valueInputOption: 'USER_ENTERED',
  requestBody: { values },
});
console.log(`✓ ${resp.data.updatedCells} cells updated across rows ${FIRST_ROW}–${lastRow}.`);
