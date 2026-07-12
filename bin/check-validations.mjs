// Read data validation rules for July 2026 tab to see dropdown options.
import { getSheetsClient, getSpreadsheetId, listTabs } from '../src/sheets-client.js';

const client = await getSheetsClient();
const tabs = await listTabs(client);
const tab = tabs.find(t => /july\s*2026/i.test(t.name));

const res = await client.sheets.spreadsheets.get({
  spreadsheetId: getSpreadsheetId(),
  ranges: [`'${tab.name}'!A2:AB2`],
  includeGridData: true,
  fields: 'sheets(data(rowData(values(dataValidation,userEnteredValue))))',
});

const rows = res.data.sheets?.[0]?.data?.[0]?.rowData || [];
rows.forEach((row) => {
  (row.values || []).forEach((cell, colIdx) => {
    const dv = cell.dataValidation;
    if (!dv) return;
    const col = String.fromCharCode(65 + colIdx); // A-Z
    const type = dv.condition?.type;
    const vals = (dv.condition?.values || []).map(v => v.userEnteredValue || v.relativeDate || '').join(' | ');
    console.log(`Col ${col} (${colIdx}): type=${type} → ${vals || '(range/formula)'}`);
  });
});
