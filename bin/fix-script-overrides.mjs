// Fix fields overwritten by the sheet's Apps Script auto-fill.
// Patches rows 66-73 (P065-P072, all 8 whale probe rows):
//   Q(16) rewards_validity: 7 → 3
//   S(18) recurring: Recurring → One Time
//   T(19) max_per_player: 99999 → 1
//   AA(26) no_deposit: Yes → No  (FS + DEP promos require deposit)
import { getSheetsClient, getSpreadsheetId, listTabs } from '../src/sheets-client.js';
const client = await getSheetsClient();
const sid = getSpreadsheetId();
const tabs = await listTabs(client);
const tab = tabs.find(t => /july\s*2026/i.test(t.name));
const tn = tab.name;

const eight = (v) => Array.from({length: 8}, () => [v]);

await client.sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: sid,
  requestBody: {
    valueInputOption: 'USER_ENTERED',
    data: [
      { range: `'${tn}'!Q66:Q73`, values: eight('3') },
      { range: `'${tn}'!S66:S73`, values: eight('One Time') },
      { range: `'${tn}'!T66:T73`, values: eight('1') },
      { range: `'${tn}'!AA66:AA73`, values: eight('No') },
    ],
  },
});
console.log('Patched Q/S/T/AA for rows 66-73');
