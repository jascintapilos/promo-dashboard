#!/usr/bin/env node
// Fix "Sportsbook only" → "Sports only" in column M for P105-P109

import { getSheetsClient, getSpreadsheetId, listTabs } from '../src/sheets-client.js';

const client = await getSheetsClient();
const { sheets } = client;
const sid = getSpreadsheetId();
const tabs = await listTabs(client);
const tab = tabs.find((t) => /june\s*2026/i.test(t.name))?.name;
if (!tab) throw new Error('June 2026 tab not found');

const fixes = [
  { row: 106, val: 'FIFA WC Kickstart - Sports Free Bet (Gold)\nFree Credit RM100\nTO: 5x\nCategory: Sports only\nClaim Window: 3 days' },
  { row: 107, val: 'FIFA WC Kickstart - Sports Free Bet (Platinum)\nFree Credit RM160\nTO: 5x\nCategory: Sports only\nClaim Window: 3 days' },
  { row: 108, val: 'FIFA WC Kickstart - Sports Free Bet (Diamond)\nFree Credit RM250\nTO: 5x\nCategory: Sports only\nClaim Window: 3 days' },
  { row: 109, val: 'FIFA WC Kickstart - 30% Deposit Bonus\nGold: Max Bonus RM1,000\nMin Dep: RM300\nTO: 12x\nCategory: Sports only\nClaim Window: 3 days' },
  { row: 110, val: 'FIFA WC Kickstart - 30% Deposit Bonus\nPlat & Diamond: Max Bonus RM2,000\nMin Dep: RM300\nTO: 12x\nCategory: Sports only\nClaim Window: 3 days' },
];

for (const f of fixes) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: sid,
    range: `${tab}!M${f.row}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[f.val]] },
  });
  console.log(`Updated M${f.row}`);
}
console.log('Done.');
