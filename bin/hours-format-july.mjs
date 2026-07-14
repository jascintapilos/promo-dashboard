import { getSheetsClient, getSpreadsheetId } from '../src/sheets-client.js';

const c = await getSheetsClient();
const spreadsheetId = getSpreadsheetId();

// Get full sheet metadata including grid data for column widths
const meta = await c.sheets.spreadsheets.get({
  spreadsheetId,
  includeGridData: false,
});

const julySheet = meta.data.sheets.find(s => s.properties.title === 'July 2026');
const juneSheet  = meta.data.sheets.find(s => s.properties.title === 'June 2026');
const julyId = julySheet.properties.sheetId;
const juneId  = juneSheet.properties.sheetId;

// Get June column widths via a separate gridData-enabled call (fields param to limit payload)
const juneDetail = await c.sheets.spreadsheets.get({
  spreadsheetId,
  ranges: [`'June 2026'!A1:H1`],
  includeGridData: true,
  fields: 'sheets.columnGroups,sheets.data.columnMetadata,sheets.properties.sheetId',
});
const juneCols = juneDetail.data.sheets?.[0]?.data?.[0]?.columnMetadata ?? [];
console.log('June column widths:', juneCols.map(c => c.pixelSize));

const requests = [
  // 1. Copy header row FORMAT (colour, bold, text style) from June R1 → July R1
  {
    copyPaste: {
      source:      { sheetId: juneId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 8 },
      destination: { sheetId: julyId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 8 },
      pasteType: 'PASTE_FORMAT',
      pasteOrientation: 'NORMAL',
    },
  },
  // 2. Freeze row 1
  {
    updateSheetProperties: {
      properties: { sheetId: julyId, gridProperties: { frozenRowCount: 1 } },
      fields: 'gridProperties.frozenRowCount',
    },
  },
  // 3. Filter on header row
  {
    setBasicFilter: {
      filter: {
        range: { sheetId: julyId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 8 },
      },
    },
  },
];

// 4. Apply column widths from June → July
juneCols.forEach((col, i) => {
  if (col.pixelSize) {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId: julyId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: col.pixelSize },
        fields: 'pixelSize',
      },
    });
  }
});

await c.sheets.spreadsheets.batchUpdate({
  spreadsheetId,
  requestBody: { requests },
});
console.log(`✓ Format, freeze, filter, and ${juneCols.filter(c => c.pixelSize).length} column widths applied to July 2026.`);
