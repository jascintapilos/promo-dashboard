#!/usr/bin/env node
// Weekly QA log fill-in — runs every Monday 12pm via Task Scheduler.
// 1. Finds all Open Fail rows with empty Preventive Action in Weekly QA Log
// 2. Drafts plain-language Preventive Action per error pattern
// 3. Writes Preventive Action + Status=Closed back to the sheet
// 4. Appends Learning Log entries (consolidated by root cause)

import { getGoogleAuth, loadGoogleapis } from '../src/google-auth.js';

const QA_SHEET_ID = '1RXlyIy9hD1LbWnM32k1DGrT9CWJwWvlCBlJzOfE_Q9Q';
const LOG_TAB    = 'Weekly QA Log';
const LL_TAB     = 'Learning Log';

// ── Preventive action templates (plain language) ────────────────────────────

function draftPreventive(errorText) {
  const e = (errorText || '').toLowerCase();

  if (/dialog|dialogue/.test(e) && /provider/.test(e)) {
    return 'Ensure the required game providers are included in the game provider selection and verify that the dialog popup is linked before marking the promo as complete. Add both checks to the sign-off process.';
  }
  if (/dialog|dialogue/.test(e)) {
    return 'Verify that the dialog popup is linked before marking the promo as complete. Add this as a required check in the sign-off process for welcome and free credit promos.';
  }
  if (/bti|sbo2/.test(e)) {
    return 'Ensure BTI, SBO2, and WINFINITY are included in the game provider selection for this promo type. Review all promo types to confirm required providers are not being missed.';
  }
  if (/spribe2|winfinity/.test(e)) {
    return 'Ensure SPRIBE2 and WINFINITY are included in the game provider selection when setting up this promo type. Add this to the QC checklist as a required verification step before sign-off.';
  }
  if (/new game provider|provider not selected|providers not selected/.test(e)) {
    return 'Ensure newly added game providers are included in the game provider selection when setting up promos. Check for provider list updates and include them when configuring promos.';
  }
  // Generic fallback
  return `Review and address the following before sign-off: ${(errorText || '').trim()}`;
}

function learningPoint(errorText) {
  const e = (errorText || '').toLowerCase();
  if (/dialog|dialogue/.test(e) && /provider/.test(e)) {
    return 'When setting up promos, always verify both the game provider list and dialog popup attachment before marking as complete.';
  }
  if (/dialog|dialogue/.test(e)) {
    return 'Dialog popups must be linked before a promo is marked as complete. Always check this as the final step for welcome and free credit promos.';
  }
  if (/provider/.test(e)) {
    return 'Game provider lists need to be reviewed with every promo setup. New or non-default providers (e.g. SPRIBE2, WINFINITY, BTI, SBO2) must be explicitly included.';
  }
  return `Recurring issue identified: ${(errorText || '').trim().substring(0, 100)}`;
}

function sopUpdate(errorText) {
  const e = (errorText || '').toLowerCase();
  if (/dialog|dialogue/.test(e)) return 'Add dialog popup check to Free Credit / Free Spin sign-off checklist';
  if (/provider/.test(e)) return 'Add game provider verification to QC sign-off checklist';
  return 'Review and update QC checklist to prevent recurrence';
}

// ── Main ────────────────────────────────────────────────────────────────────

const { client } = await getGoogleAuth();
const { google } = await loadGoogleapis();
const sheets = google.sheets({ version: 'v4', auth: client });

// Read entire log
const res = await sheets.spreadsheets.values.get({
  spreadsheetId: QA_SHEET_ID,
  range: `'${LOG_TAB}'!A:O`,
  valueRenderOption: 'FORMATTED_VALUE',
});
const rows = res.data.values || [];

const COL = { logId:0, date:1, week:2, member:3, brand:4, taskCat:5, item:6, sample:7, result:8, error:9, rootCause:10, severity:11, preventive:12, dateClsd:13, status:14 };

// Find open fails with empty preventive action
const targets = rows
  .map((r, i) => ({ r, sheetRow: i + 1 }))
  .filter(({ r }) =>
    (r[COL.result] || '').trim().toLowerCase() === 'fail' &&
    !(r[COL.preventive] || '').trim()
  );

if (targets.length === 0) {
  console.log('✓ No open fails with empty Preventive Action — log is clean.');
  process.exit(0);
}

console.log(`Found ${targets.length} tickets needing Preventive Action:`);
targets.forEach(({ r }) => console.log(' ', r[COL.logId], '|', r[COL.week], '|', r[COL.brand], '|', (r[COL.error]||'').substring(0,60)));

// Build batch write
const today = new Date().toLocaleDateString('en-GB', { year:'numeric', month:'2-digit', day:'2-digit' }).split('/').reverse().join('-');
const batchData = [];

for (const { r, sheetRow } of targets) {
  const text = draftPreventive(r[COL.error]);
  batchData.push({ range: `'${LOG_TAB}'!M${sheetRow}`, values: [[text]] });
  batchData.push({ range: `'${LOG_TAB}'!O${sheetRow}`, values: [['Closed']] });
}

const updateRes = await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: QA_SHEET_ID,
  requestBody: { valueInputOption: 'USER_ENTERED', data: batchData },
});
console.log(`✓ Updated ${updateRes.data.totalUpdatedCells} cells across ${targets.length} tickets`);

// Consolidate Learning Log entries by root cause bucket
const buckets = {};
for (const { r } of targets) {
  const key = learningPoint(r[COL.error]);
  if (!buckets[key]) buckets[key] = { ids: [], error: r[COL.error], sop: sopUpdate(r[COL.error]) };
  buckets[key].ids.push(r[COL.logId]);
}

const llRows = Object.entries(buckets).map(([lp, { ids, sop }]) => [
  today, 'Promo Setup', lp, 'Jascinta', ids.join(', '), sop
]);

await sheets.spreadsheets.values.append({
  spreadsheetId: QA_SHEET_ID,
  range: `'${LL_TAB}'!A:F`,
  valueInputOption: 'USER_ENTERED',
  insertDataOption: 'INSERT_ROWS',
  requestBody: { values: llRows },
});
console.log(`✓ Appended ${llRows.length} Learning Log entries`);

// Print summary for Task Scheduler log
const byWeek = {};
for (const { r } of targets) {
  const w = r[COL.week] || 'Unknown';
  byWeek[w] = (byWeek[w] || 0) + 1;
}
console.log('Summary:', Object.entries(byWeek).map(([w, n]) => `${w}: ${n} ticket${n>1?'s':''} closed`).join(', '));
