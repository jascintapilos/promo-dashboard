#!/usr/bin/env node
/**
 * Creates/replaces the "Adhoc Tasks" tab in the Weekly Report sheet
 * with all YTD (Jan–Jun 2026) adhoc tasks sourced from #ba-promo Slack.
 *
 * Excluded: Promo Code Creation (P###), Banner Upload (B-ID).
 * Task Types (5): Brand Setup & Config, T&C Update, Housekeeping,
 *   SOP / Documentation, Campaign & Coordination.
 *
 * One row per person per task instance.
 */
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';

const OPS_ID = getOpsSheetId();
const TAB = 'Adhoc Tasks';

// [Date, Task Type, Task, Assignee]
const DATA = [
  // ── One-off tasks ────────────────────────────────────────────────────────
  ['2026-01-02','Housekeeping','Update files link in Directory','Michelle'],
  ['2026-01-05','Brand Setup & Config','Hot Tags Game Update (WS1 — Playtech)','Alysa'],
  ['2026-01-26','Campaign & Coordination','Create CNY Popup Dialog (QPRO1/QP2B)','Alysa'],
  ['2026-01-29','T&C Update','Double Date Campaign T&C Amendment','Alysa'],
  ['2026-01-29','T&C Update','Double Date Campaign T&C Amendment','Michelle'],
  ['2026-02-03','Brand Setup & Config','Enable QQPoker (All QPROs/QPLY)','Elyssa'],
  ['2026-02-11','Housekeeping','Deactivate Content Category (QPROs/QPLY)','Elyssa'],
  ['2026-02-11','Housekeeping','Deactivate Content Category (QPROs/QPLY)','Alysa'],
  ['2026-02-11','Housekeeping','Deactivate Content Category (QPROs/QPLY)','Michelle'],
  ['2026-02-11','Housekeeping','Add game descriptions','Alysa'],
  ['2026-02-11','Housekeeping','Add game descriptions','Elyssa'],
  ['2026-02-11','T&C Update','Rename promos — Remove 918KISS','Alysa'],
  ['2026-02-11','T&C Update','Rename promos — Remove 918KISS','Elyssa'],
  ['2026-03-04','Housekeeping','Banner Housekeeping — all brands','Jascinta'],
  ['2026-03-04','Housekeeping','Banner Housekeeping — all brands','Elyssa'],
  ['2026-03-04','Housekeeping','Banner Housekeeping — all brands','Alysa'],
  ['2026-03-04','Housekeeping','Banner Housekeeping — all brands','Michelle'],
  ['2026-03-04','Housekeeping','Banner Housekeeping — all brands','Wen'],
  ['2026-03-05','SOP / Documentation','Task Workflow Diagram','Wen'],
  ['2026-03-05','SOP / Documentation','Task Workflow Diagram','Elyssa'],
  ['2026-03-05','SOP / Documentation','Smartico Documentation','Alysa'],
  ['2026-03-09','Brand Setup & Config','Blacklist Template — IWC / Live22 / YL Gaming','Michelle'],
  ['2026-03-09','Brand Setup & Config','Blacklist Template — IWC / Live22 / YL Gaming','Elyssa'],
  ['2026-03-09','Brand Setup & Config','Update Bonus Conditions — FS codes (tick checkbox)','Alysa'],
  ['2026-03-09','Brand Setup & Config','Update Bonus Conditions — FS codes (tick checkbox)','Michelle'],
  ['2026-03-12','Brand Setup & Config','Update Bonus Conditions — Uncheck Restrict Other Game','Wen'],
  ['2026-03-12','Brand Setup & Config','Update Bonus Conditions — Uncheck Restrict Other Game','Michelle'],
  ['2026-03-12','Brand Setup & Config','Update Bonus Conditions — Uncheck Restrict Other Game','Alysa'],
  ['2026-03-17','SOP / Documentation','Amend WS1 Bonus Code Assignment SOP','Wen'],
  ['2026-03-18','Campaign & Coordination','Campaign Amendment — SPADE66 coordinate','Alysa'],
  ['2026-03-18','Brand Setup & Config','Setup Blacklist Template QP2','Alysa'],
  ['2026-03-18','Brand Setup & Config','Setup Blacklist Template QP2','Elyssa'],
  ['2026-03-18','Brand Setup & Config','Setup Blacklist Template QP2','Michelle'],
  ['2026-03-18','Brand Setup & Config','Setup Blacklist Template QP2','Wen'],
  ['2026-03-24','Brand Setup & Config','Update Dialog Format (QPRO1/QP2B)','Michelle'],
  ['2026-04-01','Campaign & Coordination','Maintenance Announcement + Game Maintenance (WS1/WS2)','Elyssa'],
  ['2026-04-01','Campaign & Coordination','Maintenance Announcement + Game Maintenance (WS1/WS2)','Alysa'],
  ['2026-04-01','Brand Setup & Config','Enable In-House Campaign Banners — QPROs','Alysa'],
  ['2026-04-01','Brand Setup & Config','Enable In-House Campaign Banners — QPROs','Wen'],
  ['2026-04-01','Brand Setup & Config','Enable In-House Campaign Banners — QPROs','Elyssa'],
  ['2026-04-01','Brand Setup & Config','Enable In-House Campaign Banners — QPROs','Michelle'],
  ['2026-04-08','T&C Update','Insert Hyperlink to General T&C (all brands)','Alysa'],
  ['2026-04-08','T&C Update','Insert Hyperlink to General T&C (all brands)','Elyssa'],
  ['2026-04-08','T&C Update','Insert Hyperlink to General T&C (all brands)','Wen'],
  ['2026-04-13','T&C Update','Remove 918KAYA from all T&C (WS1/WS2)','Team'],
  ['2026-04-15','T&C Update','Inbox template title + T&C clause amendment','Wen'],
  ['2026-04-29','T&C Update','Update Footer T&C — all brands','Jascinta'],
  ['2026-04-29','T&C Update','Update Footer T&C — all brands','Elyssa'],
  ['2026-04-29','T&C Update','Update Footer T&C — all brands','Alysa'],
  ['2026-04-29','T&C Update','Update Footer T&C — all brands','Wen'],
  ['2026-05-11','T&C Update','T&C Update — public promos (WS1/QPROs)','Gaby'],
  ['2026-05-29','T&C Update','Inbox Message P106-P109 amendment','Alysa'],
  ['2026-05-29','T&C Update','Inbox Message P106-P109 amendment','Elyssa'],
  ['2026-05-29','T&C Update','Inbox Message P106-P109 amendment','Wen'],
  ['2026-05-29','T&C Update','Inbox Message P106-P109 amendment','Jascinta'],
  ['2026-06-03','Brand Setup & Config','BTI Rebate Settings & Blacklist Config','Alysa'],
  ['2026-06-03','Brand Setup & Config','BTI Rebate Settings & Blacklist Config','Gaby'],
  ['2026-06-03','Brand Setup & Config','BTI Rebate Settings & Blacklist Config','Bangun'],
  ['2026-06-03','Brand Setup & Config','BTI Rebate Settings & Blacklist Config','Wen'],
  ['2026-06-04','Brand Setup & Config','Add member group (welcome/reload promos)','Gaby'],
  ['2026-06-04','Brand Setup & Config','Add member group (welcome/reload promos)','Bangun'],
  ['2026-06-16','Brand Setup & Config','Create Sports & Slots Blacklist Template','Wen'],
  ['2026-06-16','Brand Setup & Config','Create Sports & Slots Blacklist Template','Gaby'],
  ['2026-06-16','Brand Setup & Config','Create Sports & Slots Blacklist Template','Bangun'],
];

const HEADER = ['Date', 'Task Type', 'Task', 'Assignee'];
const rows = [HEADER, ...DATA];

const { sheets } = await getSheetsClient();

// Ensure tab exists
const meta = await sheets.spreadsheets.get({
  spreadsheetId: OPS_ID,
  fields: 'sheets.properties.title',
});
const exists = meta.data.sheets.some(s => s.properties.title === TAB);
if (!exists) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: OPS_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
  });
  console.log(`Created '${TAB}' tab`);
}

// Clear and rewrite
await sheets.spreadsheets.values.clear({ spreadsheetId: OPS_ID, range: `'${TAB}'!A:D` });
await sheets.spreadsheets.values.update({
  spreadsheetId: OPS_ID,
  range: `'${TAB}'!A1`,
  valueInputOption: 'RAW',
  requestBody: { values: rows },
});

console.log(`✅ Adhoc Tasks written — ${DATA.length} rows (${rows.length - 1} data rows + header)`);

// Summary by assignee
const counts = {};
for (const [, , , assignee] of DATA) {
  counts[assignee] = (counts[assignee] || 0) + 1;
}
console.log('\nTask count by assignee:');
for (const [name, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name.padEnd(12)} ${n}`);
}
