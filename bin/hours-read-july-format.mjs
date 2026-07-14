import { getSheetsClient, getSpreadsheetId } from '../src/sheets-client.js';

const c = await getSheetsClient();
const spreadsheetId = getSpreadsheetId();

const res = await c.sheets.spreadsheets.get({
  spreadsheetId,
  ranges: ["'July 2026'!A1:H7"],
  includeGridData: true,
});

const rows = res.data.sheets[0].data[0].rowData;
rows.forEach((row, ri) => {
  console.log(`\n=== Row ${ri + 1} ===`);
  (row.values || []).forEach((cell, ci) => {
    const f = cell.effectiveFormat || {};
    const bg = f.backgroundColor;
    const fg = f.textFormat?.foregroundColor;
    const bold = f.textFormat?.bold;
    const fontSize = f.textFormat?.fontSize;
    const wrap = f.wrapStrategy;
    console.log(`  Col ${ci}: bg=${JSON.stringify(bg)} fg=${JSON.stringify(fg)} bold=${bold} size=${fontSize} wrap=${wrap}`);
  });
});
