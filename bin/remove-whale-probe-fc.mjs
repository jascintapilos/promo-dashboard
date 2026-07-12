// Remove the erroneously-added FC rows (P073-P076) from rows 74-77.
import { getSheetsClient, getSpreadsheetId, listTabs } from '../src/sheets-client.js';
const client = await getSheetsClient();
const sid = getSpreadsheetId();
const tabs = await listTabs(client);
const tab = tabs.find(t => /july\s*2026/i.test(t.name));

await client.sheets.spreadsheets.values.clear({
  spreadsheetId: sid,
  range: `'${tab.name}'!A74:AB77`,
});
console.log('Cleared A74:AB77 (removed P073-P076 FC rows)');
