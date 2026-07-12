import { getSheetsClient, getSpreadsheetId, listTabs } from '../src/sheets-client.js';
const client = await getSheetsClient();
const tabs = await listTabs(client);
const tab = tabs.find(t => /july\s*2026/i.test(t.name));
const res = await client.sheets.spreadsheets.values.get({
  spreadsheetId: getSpreadsheetId(),
  range: `'${tab.name}'!A70:AB70`,
  valueRenderOption: 'UNFORMATTED_VALUE',
});
const r = res.data.values?.[0] || [];
r.forEach((v, i) => { if (v !== '' && v != null) console.log(`[${i}] ${v}`); });
