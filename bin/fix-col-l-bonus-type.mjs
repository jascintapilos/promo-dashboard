// Fix column L (bonus_type) for rows 66-73 to match sheet dropdown options.
// Free Spin → Free Spin - Reload (rows 66-69)
// Deposit Bonus → Deposit - Reload (rows 70-73)
// Free Credit rows (74-77) are already correct.
import { getSheetsClient, getSpreadsheetId, listTabs } from '../src/sheets-client.js';
const client = await getSheetsClient();
const sid = getSpreadsheetId();
const tabs = await listTabs(client);
const tab = tabs.find(t => /july\s*2026/i.test(t.name));

const res = await client.sheets.spreadsheets.values.update({
  spreadsheetId: sid,
  range: `'${tab.name}'!L66:L73`,
  valueInputOption: 'USER_ENTERED',
  requestBody: {
    values: [
      ['Free Spin - Reload'],
      ['Free Spin - Reload'],
      ['Free Spin - Reload'],
      ['Free Spin - Reload'],
      ['Deposit - Reload'],
      ['Deposit - Reload'],
      ['Deposit - Reload'],
      ['Deposit - Reload'],
    ],
  },
});
console.log(`Updated ${res.data.updatedRows} rows → ${res.data.updatedRange}`);
