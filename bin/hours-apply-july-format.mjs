import { getSheetsClient, getSpreadsheetId } from '../src/sheets-client.js';

const c = await getSheetsClient();
const spreadsheetId = getSpreadsheetId();

const meta = await c.sheets.spreadsheets.get({ spreadsheetId });
const julySheet = meta.data.sheets.find(s => s.properties.title === 'July 2026');
const juneSheet  = meta.data.sheets.find(s => s.properties.title === 'June 2026');
const julyId = julySheet.properties.sheetId;

// Colours from June (verified)
const GREEN_BG  = { red: 0.20784314, green: 0.40784314, blue: 0.32941177 };
const WHITE     = { red: 1, green: 1, blue: 1 };
const MINT_BG   = { red: 0.9647059,  green: 0.972549,   blue: 0.9764706  };
const DARK_GREY = { red: 0.2627451,  green: 0.2627451,  blue: 0.2627451  };

// June bands
const juneBands = juneSheet.bandedRanges || [];
console.log('June banded ranges:', JSON.stringify(juneBands, null, 2));

const requests = [];

// 1. Remove any existing banded ranges on July (correct API name: deleteBanding / bandingId)
for (const band of (julySheet.bandedRanges || [])) {
  requests.push({ deleteBanding: { bandedRangeId: band.bandedRangeId } });
}

// 2. Header row (R1): green bg, white fg, size 13, wrap
requests.push({
  repeatCell: {
    range: { sheetId: julyId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 8 },
    cell: {
      userEnteredFormat: {
        backgroundColor: GREEN_BG,
        textFormat: { foregroundColor: WHITE, fontSize: 13, bold: false },
        wrapStrategy: 'WRAP',
      },
    },
    fields: 'userEnteredFormat(backgroundColor,textFormat,wrapStrategy)',
  },
});
// Col 4 (E) in header is CLIP
requests.push({
  repeatCell: {
    range: { sheetId: julyId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 4, endColumnIndex: 5 },
    cell: { userEnteredFormat: { wrapStrategy: 'CLIP' } },
    fields: 'userEnteredFormat.wrapStrategy',
  },
});

// 3. All data rows (R2 onwards): dark grey fg, size 13, wrap
requests.push({
  repeatCell: {
    range: { sheetId: julyId, startRowIndex: 1, endRowIndex: 300, startColumnIndex: 0, endColumnIndex: 8 },
    cell: {
      userEnteredFormat: {
        textFormat: { foregroundColor: DARK_GREY, fontSize: 13, bold: false },
        wrapStrategy: 'WRAP',
      },
    },
    fields: 'userEnteredFormat(textFormat,wrapStrategy)',
  },
});
// Col 4 (E) in data rows: CLIP
requests.push({
  repeatCell: {
    range: { sheetId: julyId, startRowIndex: 1, endRowIndex: 300, startColumnIndex: 4, endColumnIndex: 5 },
    cell: { userEnteredFormat: { wrapStrategy: 'OVERFLOW_CELL' } },
    fields: 'userEnteredFormat.wrapStrategy',
  },
});

// 4. Banded range — exact match to June:
//    startRowIndex=0, headerColor=green, firstBand=white, secondBand=mint
requests.push({
  addBanding: {
    bandedRange: {
      range: { sheetId: julyId, startRowIndex: 0, endRowIndex: 300, startColumnIndex: 0, endColumnIndex: 8 },
      rowProperties: {
        headerColor:     GREEN_BG,  // R1 header = green
        firstBandColor:  WHITE,     // even data rows = white
        secondBandColor: MINT_BG,   // odd data rows = mint
      },
    },
  },
});

// 5. WEEK marker rows (R2 + R34): white fg on default (dark) bg — matches June R2
// The WEEK rows in June have bg={} (sheet default = dark) and white text
// We apply a black bg explicitly so text is visible
const weekMarkerRows = [1, 33]; // 0-indexed: R2=1, R34=33
for (const rowIdx of weekMarkerRows) {
  requests.push({
    repeatCell: {
      range: { sheetId: julyId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: 0, endColumnIndex: 8 },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0, green: 0, blue: 0 },  // black — same visual as June R2
          textFormat: { foregroundColor: WHITE, fontSize: 13, bold: false },
          wrapStrategy: 'WRAP',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,wrapStrategy)',
    },
  });
}

await c.sheets.spreadsheets.batchUpdate({
  spreadsheetId,
  requestBody: { requests },
});
console.log('✓ July 2026 formatting applied: header green/white, data dark-grey fg, alternating mint/white rows, WEEK rows black/white.');
