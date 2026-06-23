#!/usr/bin/env node
// Fix column M for P105-P107: use parser-compatible "Free Credit RMxxx" format

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
  { row: 106, amount: 'RM100', tier: 'Gold' },
  { row: 107, amount: 'RM160', tier: 'Platinum' },
  { row: 108, amount: 'RM250', tier: 'Diamond' },
];

for (const f of fixes) {
  const cell = `${tab}!M${f.row}`;
  const val = `FIFA WC Kickstart - Sports Free Bet (${f.tier})\nFree Credit ${f.amount}\nTO: 5x\nCategory: Sportsbook only\nClaim Window: 1 day`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: sid,
    range: cell,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[val]] },
  });
  console.log(`Updated M${f.row} (${f.tier}) → Free Credit ${f.amount}`);
}
console.log('Done.');
