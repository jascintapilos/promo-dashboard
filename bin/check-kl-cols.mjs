// Read columns K and L from existing rows 62-65 (P061-P064) to see correct dropdown values.
import { getSheetsClient, getSpreadsheetId, listTabs } from '../src/sheets-client.js';
const client = await getSheetsClient();
const tabs = await listTabs(client);
const tab = tabs.find(t => /july\s*2026/i.test(t.name));
const res = await client.sheets.spreadsheets.values.get({
  spreadsheetId: getSpreadsheetId(),
  range: `'${tab.name}'!D62:L65`,
  valueRenderOption: 'FORMATTED_VALUE',
});
const rows = res.data.values || [];
rows.forEach((r, i) => {
  // D=0(request_id), E=1, F=2, G=3, H=4, I=5, J=6, K=7, L=8
  console.log(`Row ${62+i}: ${r[0]} | K="${r[7]}" | L="${r[8]}"`);
});
