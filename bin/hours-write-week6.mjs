#!/usr/bin/env node
// Writes Week 6 (08–12 Jun 2026) to the June 2026 tracker.
// Full week — all 5 days working, budget 40h.
// Overwrites R15 (WEEK 6 marker) through R45 (last Fri entry).
//   PROMO_SHEET_ID=<id> node bin/hours-write-week6.mjs

import { getSheetsClient, getSpreadsheetId } from '../src/sheets-client.js';

const TAB = 'June 2026';
const FIRST_DATA_ROW = 16;   // Mon 08/06 first entry — SUM anchor for Week 6

const c = await getSheetsClient();
const ssId = getSpreadsheetId();

const dataRow = (date, task, hours, rowNum) => [
  date, task, '', hours,
  `=SUM($D$${FIRST_DATA_ROW}:D${rowNum})`,
  `=40-E${rowNum}`,
  `=(E${rowNum}/40)*100`,
  '',
];

const rows = [
  // ── WEEK 6 marker ────────────────────────────────────────────────────────
  [15, ['WEEK 6']],

  // ── Mon 08/06 — 8h ───────────────────────────────────────────────────────
  [16, dataRow('08/06/2026',
    'Weekly BA Standup (Zoom, 10:00–11:00, recurring)',
    1, 16)],
  [17, dataRow('',
    'Membership review (Shyam Sunthar, WY — Zoom, 13:00–14:00)',
    1, 17)],
  [18, dataRow('',
    'Claude Automation — QP2 promo code skill debugging, blacklist template + canary fixes',
    2, 18)],
  [19, dataRow('',
    'Promo x BA Task Alignment — Dedicated Promo PIC slide preparation (slides 7–8), #promotions-team task deadline coordination',
    2, 19)],
  [20, dataRow('',
    'Slack coordination & team management — WY DM (CRM PIC advisory, alignment meeting follow-up), #vm-am-promotions-projects VM blast query (Mimi)',
    2, 20)],

  // ── Tue 09/06 — 8h ───────────────────────────────────────────────────────
  [21, dataRow('09/06/2026',
    'ID Weekly Meeting (Zoom, 11:30am, recurring)',
    1, 21)],
  [22, dataRow('',
    'Promo Team meeting (WY, Booninn, Elyssa, Menhua, Gaby, Bangun — Zoom)',
    1, 22)],
  [23, dataRow('',
    'Sales Weekly Meeting — MY (Zoom, 14:00–15:00)',
    1, 23)],
  [24, dataRow('',
    'Gaby catch up (WY — Zoom, ~4:15pm)',
    0.5, 24)],
  [25, dataRow('',
    'Bangun Catch Up (WY — Zoom)',
    0.5, 25)],
  [26, dataRow('',
    'Slack coordination — #promotions-team CRM-Promo PIC Assignment announcement, Promo Brief Confirmation template; Smartico training arrangement (Alysa→Bangun/Gaby); #ba-promo new brand Directory update (Bangun)',
    1.5, 26)],
  [27, dataRow('',
    'Sales↔Promo Team Empowerment Package — CRM PIC assignment deck compilation (slides 7–8), promo brief confirmation framework, stakeholder deck shared to WY',
    2.5, 27)],

  // ── Wed 10/06 — 8h ───────────────────────────────────────────────────────
  [28, dataRow('10/06/2026',
    'AM weekly sales meeting (Kevin Teh, WY — Zoom, 14:00–15:00)',
    1, 28)],
  [29, dataRow('',
    'Claude Automation — IGMP WS1 promo canary testing (promo_testbot), P### saves continuation',
    3, 29)],
  [30, dataRow('',
    'Slack coordination & team management — WY DM (RDP lockout troubleshooting, WS1 promo_testbot access, post-AM meeting debrief), Gaby DM (campaign planning process guidance), #ba-promo task routing (Alysa/Wen)',
    2, 30)],
  [31, dataRow('',
    'Promo team operations — #promotions-team weekly meeting format redesign announced (forward brief + one flag structure, effective Fri)',
    1, 31)],
  [32, dataRow('',
    'Promo documentation & planning — trade analysis review, forward brief template preparation',
    1, 32)],

  // ── Thu 11/06 — 8h ───────────────────────────────────────────────────────
  [33, dataRow('11/06/2026',
    'MCP iGMP (WY, CK.Ng, Menhua, Uberlegen team — Zoom, 10:00–11:00)',
    1, 33)],
  [34, dataRow('',
    'Biweekly Tech (Aiodin) Planning Meeting (Zoom, 13:00–14:00)',
    1, 34)],
  [35, dataRow('',
    'Sales Weekly Meeting — TH/KH/ID (Zoom, 14:00–15:00)',
    1, 35)],
  [36, dataRow('',
    'Monthly Promotions Meeting (Shyam Sunthar, Adrina Martine, WY — Zoom, 15:00–16:00)',
    1, 36)],
  [37, dataRow('',
    'Claude Automation — P001-P008 Ryan FS promo saves (QPRO4 MY+SG, QP2C SG; Free Spin, Pragmatic Play)',
    2, 37)],
  [38, dataRow('',
    'Slack coordination — #ba-promo Ryan FS promo spec review (game name, max bonus, brands), QC delegation (Alysa P001–P004, Bangun P005–P008), error list follow-up',
    1, 38)],
  [39, dataRow('',
    'Team engagement proposal — Promo Makan & Mingle (Cycle 1 budget) agenda, participant list, budget breakdown (MY + ID) drafted and submitted to WY',
    1, 39)],

  // ── Fri 12/06 — 8h ───────────────────────────────────────────────────────
  [40, dataRow('12/06/2026',
    'Claude Automation — morning promo code saves continuation (QPRO/QP2 P### batch)',
    1.5, 40)],
  [41, dataRow('',
    'Weekly catch up (WY, Booninn, Elyssa, Menhua, Gaby, Bangun — Zoom, 11:30am; new format: forward brief + one flag)',
    1, 41)],
  [42, dataRow('',
    'VM Slot for Catch Ups (Shyam Sunthar, Mimi, WY — Zoom, 13:30–14:30)',
    1, 42)],
  [43, dataRow('',
    'Slack coordination — WY DM (team engagement Makan & Mingle announcement, approval follow-up), weekly wrap-up team management',
    1, 43)],
  [44, dataRow('',
    'Claude Automation — promo code automation, P### saves continuation (afternoon)',
    3, 44)],
  [45, dataRow('',
    'Claude Automation — Work hours tracker Week 6 update (08–12 Jun) via connected apps',
    0.5, 45)],
];

const data = rows.map(([rowNum, rowData]) => ({
  range: `'${TAB}'!A${rowNum}:H${rowNum}`,
  values: [rowData],
}));

console.log(`Writing ${data.length} rows for Week 6 (R15–R45)…`);
const resp = await c.sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: ssId,
  requestBody: { valueInputOption: 'USER_ENTERED', data },
});
console.log(`✓ ${resp.data.totalUpdatedCells} cells updated across ${resp.data.totalUpdatedRanges} ranges.`);
console.log(`Week 6: Mon–Fri full week, 40h. Cumulative by Fri: 40/40 = 100% within-week.`);
