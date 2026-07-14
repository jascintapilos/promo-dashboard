import { getSheetsClient, getSpreadsheetId } from '../src/sheets-client.js';

const c = await getSheetsClient();
const spreadsheetId = getSpreadsheetId();

const res = await c.sheets.spreadsheets.get({
  spreadsheetId,
  ranges: ["'June 2026'!A1:H7"],
  includeGridData: true,
});

const rows = res.data.sheets[0].data[0].rowData;
rows.forEach((row, ri) => {
  console.log(`\n=== Row ${ri + 1} ===`);
  (row.values || []).forEach((cell, ci) => {
    const f = cell.effectiveFormat || {};
    const bg = f.backgroundColor;
    const fgColor = f.textFormat?.foregroundColor;
    const fgColorStyle = f.textFormat?.foregroundColorStyle;
    const bold = f.textFormat?.bold;
    const fontSize = f.textFormat?.fontSize;
    const wrap = f.wrapStrategy;
    console.log(`  Col ${ci}: bg=${JSON.stringify(bg)} fg=${JSON.stringify(fgColor)} fgStyle=${JSON.stringify(fgColorStyle)} bold=${bold} size=${fontSize} wrap=${wrap}`);
  });
});
