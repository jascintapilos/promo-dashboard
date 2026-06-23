#!/usr/bin/env node
// Add FT_ prefix to promo codes for P105-P109 (column W, rows 106-110)

import {
  getSheetsClient,
  getSpreadsheetId,
  listTabs,
} from '../src/sheets-client.js';

const client = await getSheetsClient();
const { sheets } = client;
const sid = getSpreadsheetId();

const tabs = await listTabs(client);
const tab = tabs.find((t) => /june\s*2026/i.test(t.name))?.name;
if (!tab) throw new Error('June 2026 tab not found');

const fixes = [
  { row: 106, code: 'FT_WC26_FB_100_GLD' },
  { row: 107, code: 'FT_WC26_FB_160_PLT' },
  { row: 108, code: 'FT_WC26_FB_250_DMD' },
  { row: 109, code: 'FT_WC26_DEP_30PCT_1K_GLD' },
  { row: 110, code: 'FT_WC26_DEP_30PCT_2K_PLTDMD' },
];

for (const f of fixes) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: sid,
    range: `${tab}!W${f.row}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[f.code]] },
  });
  console.log(`W${f.row} → ${f.code}`);
}
console.log('Done.');
