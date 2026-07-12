import { getSheetsClient, getSpreadsheetId, listTabs } from '../src/sheets-client.js';
const client = await getSheetsClient();
const sid = getSpreadsheetId();
const tabs = await listTabs(client);
const tab = tabs.find(t => /july\s*2026/i.test(t.name));

await client.sheets.spreadsheets.values.update({
  spreadsheetId: sid,
  range: `'${tab.name}'!Y70:Y73`,
  valueInputOption: 'USER_ENTERED',
  requestBody: { values: [['50% 充值奖励'],['50% 充值奖励'],['50% 充值奖励'],['50% 充值奖励']] },
});
console.log('Written ZH names for P069-P072');
