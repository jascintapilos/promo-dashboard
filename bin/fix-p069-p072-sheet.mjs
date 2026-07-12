import { getSheetsClient, getSpreadsheetId, listTabs } from '../src/sheets-client.js';
const client = await getSheetsClient();
const sid = getSpreadsheetId();
const tabs = await listTabs(client);
const tab = tabs.find(t => /july\s*2026/i.test(t.name));
if (!tab) throw new Error('July 2026 tab not found');

await client.sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: sid,
  requestBody: {
    valueInputOption: 'USER_ENTERED',
    data: [
      { range: `'${tab.name}'!Q70:Q73`, values: [[7],[7],[7],[7]] },
      { range: `'${tab.name}'!S70:S73`, values: [['Recurring'],['Recurring'],['Recurring'],['Recurring']] },
    ],
  },
});
console.log(`Updated '${tab.name}' rows 70-73: col Q=7 (rewards_validity), col S=Recurring`);
