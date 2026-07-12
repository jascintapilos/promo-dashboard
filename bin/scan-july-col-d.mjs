import { getSheetsClient, getSpreadsheetId, listTabs } from '../src/sheets-client.js';
const client = await getSheetsClient();
const tabs = await listTabs(client);
const tab = tabs.find(t => /july\s*2026/i.test(t.name));
const res = await client.sheets.spreadsheets.values.get({
  spreadsheetId: getSpreadsheetId(),
  range: `'${tab.name}'!D2:D210`,
  valueRenderOption: 'UNFORMATTED_VALUE',
});
const vals = res.data.values || [];
const hits = [];
for (let i = 0; i < vals.length; i++) {
  const v = vals[i]?.[0];
  if (v && /^P\d+$/i.test(String(v))) hits.push({ row: 2+i, p: v });
}
console.log(`Total P### entries: ${hits.length}`);
hits.slice(-15).forEach(h => console.log(`  Row ${h.row}: ${h.p}`));
