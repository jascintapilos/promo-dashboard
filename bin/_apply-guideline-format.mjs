#!/usr/bin/env node
// Mirror May 2026 visual styling onto the Guideline tab: frozen row/col,
// column widths, header bold + center, and data-row peach bg + center.
//
//   --apply   actually commit. Default is dry-run.
//
import {
  getSheetsClient,
  getSpreadsheetId,
} from '../src/sheets-client.js';

const APPLY = process.argv.includes('--apply');

const GUIDELINE_ID = 1519890897;
const MAY_2026_ID = 890804133;

// Column widths in pixels — from May 2026 probe.
const COL_WIDTHS = [207, 284, 155, 104, 98, 82, 100, 139, 198, 179, 183, 215, 353, 183, 169, 117, 169, 169, 134, 191, 191, 202, 339, 256, 228];

const HEADER_FORMAT = {
  backgroundColor: { red: 1, green: 1, blue: 1 },
  horizontalAlignment: 'CENTER',
  verticalAlignment: 'MIDDLE',
  wrapStrategy: 'WRAP',
  textFormat: {
    fontFamily: 'Arial',
    fontSize: 10,
    bold: true,
  },
};

const DATA_FORMAT = {
  backgroundColor: { red: 1, green: 0.9490196, blue: 0.8 },
  horizontalAlignment: 'CENTER',
  verticalAlignment: 'MIDDLE',
  wrapStrategy: 'WRAP',
  textFormat: {
    fontFamily: 'Arial',
    fontSize: 10,
  },
};

const requests = [];

// 1) Freeze row 1 and column A.
requests.push({
  updateSheetProperties: {
    properties: {
      sheetId: GUIDELINE_ID,
      gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 },
    },
    fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount',
  },
});

// 2) Set column widths A..Y to match May 2026.
COL_WIDTHS.forEach((px, idx) => {
  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId: GUIDELINE_ID,
        dimension: 'COLUMNS',
        startIndex: idx,
        endIndex: idx + 1,
      },
      properties: { pixelSize: px },
      fields: 'pixelSize',
    },
  });
});

// 3) Header row format — A1:Y1.
requests.push({
  repeatCell: {
    range: {
      sheetId: GUIDELINE_ID,
      startRowIndex: 0,
      endRowIndex: 1,
      startColumnIndex: 0,
      endColumnIndex: 25,
    },
    cell: { userEnteredFormat: HEADER_FORMAT },
    fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)',
  },
});

// 4) Data rows format — A2:Y9.
requests.push({
  repeatCell: {
    range: {
      sheetId: GUIDELINE_ID,
      startRowIndex: 1,
      endRowIndex: 9,
      startColumnIndex: 0,
      endColumnIndex: 25,
    },
    cell: { userEnteredFormat: DATA_FORMAT },
    fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)',
  },
});

console.log(`Planned: ${requests.length} batchUpdate requests`);
console.log(`  • freeze R1 + col A`);
console.log(`  • set 25 column widths`);
console.log(`  • format A1:Y1 (header)`);
console.log(`  • format A2:Y9 (data, peach bg + center)`);
console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

if (!APPLY) {
  console.log('\nDry run only — re-run with --apply to commit.');
  process.exit(0);
}

const client = await getSheetsClient();
const ssid = getSpreadsheetId();

const res = await client.sheets.spreadsheets.batchUpdate({
  spreadsheetId: ssid,
  requestBody: { requests },
});

console.log(`\n✓ batchUpdate completed: ${res.data.replies?.length || 0} replies`);
