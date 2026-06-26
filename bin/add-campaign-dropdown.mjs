#!/usr/bin/env node
// Adds "Campaign Name/Objective" column with dropdown validation to the
// current-month tab of the Promo Code Request Details Template.
//
// What it does:
//   1. Reads the live header row to find the existing campaign column
//      (matched by /^campaign/i — same alias the ingest uses).
//   2. If found: renames the header cell to "Campaign Name/Objective"
//      and applies dropdown validation to all data rows in that column.
//   3. If not found: appends the column after "Region" (or at the end)
//      and applies the same header + validation.
//
// Usage:
//   node bin/add-campaign-dropdown.mjs            # dry-run (default)
//   node bin/add-campaign-dropdown.mjs --commit   # write to sheet
//   node bin/add-campaign-dropdown.mjs --tab="Jun 2026" --commit

import { parseArgs } from './_args.js';
import {
  getSheetsClient,
  resolveCurrentMonthTab,
  listTabs,
  readHeader,
  detectColumnMapFromHeader,
  getSpreadsheetId,
  colIndexToLetter,
  a1Range,
} from '../src/sheets-client.js';

const { flags } = parseArgs(process.argv.slice(2));
const commit  = flags.commit === true;
const tabOverride = flags.tab;

const COLUMN_HEADER = 'Campaign Name/Objective';

const DROPDOWN_OPTIONS = [
  'ACQ (WELCOME BONUS)',
  'Retention- AdHoc (CHURN PLAYERS)',
  'CRM - Retention (ACTIVE PLAYERS)',
  'CRM- Churn (CHURN PLAYERS)',
  'CRM- Monthly Camps (AD HOC CAMPAIGNS)',
  'VIP Grooming (VIP PROGRESSION BONUS)',
  'VIP AdHoc (AD HOC CAMPAIGNS)',
  'VIP Churn (CHURN PLAYERS)',
  'VIP Retention (ACTIVE PLAYERS)',
];

// ── Main ──────────────────────────────────────────────────────────────────

const client = await getSheetsClient();
const tabName = tabOverride || await resolveCurrentMonthTab(client);
console.log(`Tab: ${tabName}${commit ? '' : '  [DRY-RUN — pass --commit to write]'}`);

// Get the numeric sheetId (needed for batchUpdate validation requests)
const tabs = await listTabs(client);
const tabMeta = tabs.find((t) => t.name === tabName);
if (!tabMeta) throw new Error(`Tab "${tabName}" not found in spreadsheet`);
const numericSheetId = tabMeta.sheetId;

// Read header row
const header = await readHeader(client, tabName);
const colMap = detectColumnMapFromHeader(header);

console.log(`\nCurrent header (${header.length} columns):`);
header.forEach((h, i) => console.log(`  ${colIndexToLetter(i).padEnd(3)} [${i}]  ${h}`));

// ── Find or decide column position ────────────────────────────────────────

let targetColIdx = colMap.campaign ?? null;
let needsHeaderWrite = false;

if (targetColIdx != null) {
  const existing = header[targetColIdx];
  console.log(`\nFound existing campaign column at ${colIndexToLetter(targetColIdx)} (index ${targetColIdx}): "${existing}"`);
  if (existing !== COLUMN_HEADER) {
    console.log(`  → Will rename to "${COLUMN_HEADER}"`);
    needsHeaderWrite = true;
  } else {
    console.log(`  → Header already correct, will only refresh validation`);
  }
} else {
  // Insert after "Region" if present, otherwise after "Brand", otherwise at end
  const anchor = colMap.region ?? colMap.brand ?? null;
  targetColIdx = anchor != null ? anchor + 1 : header.length;
  console.log(`\nNo campaign column found — will add at column ${colIndexToLetter(targetColIdx)} (index ${targetColIdx})`);
  needsHeaderWrite = true;
}

console.log(`\nDropdown options (${DROPDOWN_OPTIONS.length}):`);
DROPDOWN_OPTIONS.forEach((o) => console.log(`  • ${o}`));

if (!commit) {
  console.log('\n[DRY-RUN] No changes written. Pass --commit to apply.');
  process.exit(0);
}

// ── 1. Write header cell ───────────────────────────────────────────────────

const { sheets } = client;
const spreadsheetId = getSpreadsheetId();
const colLetter = colIndexToLetter(targetColIdx);

if (needsHeaderWrite) {
  const headerRange = a1Range(tabName, `${colLetter}1`);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: headerRange,
    valueInputOption: 'RAW',
    requestBody: { values: [[COLUMN_HEADER]] },
  });
  console.log(`\n✓ Header written: ${colLetter}1 = "${COLUMN_HEADER}"`);
} else {
  console.log(`\n  Header already "${COLUMN_HEADER}" — skipping header write`);
}

// ── 2. Apply dropdown validation ──────────────────────────────────────────

const validationRequest = {
  setDataValidation: {
    range: {
      sheetId: numericSheetId,
      startRowIndex: 1,       // row 2 onward (0-based, row 1 = header)
      endRowIndex: 1000,      // covers up to row 1000
      startColumnIndex: targetColIdx,
      endColumnIndex: targetColIdx + 1,
    },
    rule: {
      condition: {
        type: 'ONE_OF_LIST',
        values: DROPDOWN_OPTIONS.map((v) => ({ userEnteredValue: v })),
      },
      strict: false,          // allow values not in the list (flexibility)
      showCustomUi: true,     // show the dropdown arrow in the cell
    },
  },
};

await sheets.spreadsheets.batchUpdate({
  spreadsheetId,
  requestBody: { requests: [validationRequest] },
});

console.log(`✓ Dropdown validation applied to ${colLetter}2:${colLetter}1000`);
console.log(`\nDone. Open the sheet and click any cell in column ${colLetter} to see the dropdown.`);
