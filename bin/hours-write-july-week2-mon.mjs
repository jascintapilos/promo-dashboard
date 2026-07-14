import { getSheetsClient, getSpreadsheetId } from '../src/sheets-client.js';

const c = await getSheetsClient();
const spreadsheetId = getSpreadsheetId();

const meta = await c.sheets.spreadsheets.get({ spreadsheetId });
const julySheet = meta.data.sheets.find(s => s.properties.title === 'July 2026');
const juneSheet  = meta.data.sheets.find(s => s.properties.title === 'June 2026');
const julyId = julySheet.properties.sheetId;
const juneId  = juneSheet.properties.sheetId;

// 1. Copy FULL format from June → July (200 rows covers all existing + future data)
//    PASTE_FORMAT = cell formats only (font, wrap, colour, borders) — values untouched
await c.sheets.spreadsheets.batchUpdate({
  spreadsheetId,
  requestBody: {
    requests: [
      {
        copyPaste: {
          source:      { sheetId: juneId, startRowIndex: 0, endRowIndex: 200, startColumnIndex: 0, endColumnIndex: 8 },
          destination: { sheetId: julyId, startRowIndex: 0, endRowIndex: 200, startColumnIndex: 0, endColumnIndex: 8 },
          pasteType: 'PASTE_FORMAT',
          pasteOrientation: 'NORMAL',
        },
      },
    ],
  },
});
console.log('✓ Format (wrap, font, colour) copied from June → July.');

// 2. Write Week 2 data
const FIRST_DATA_ROW = 35;  // row after WEEK 2 marker (R34)
const DENOM = 40;
const TAB = 'July 2026';

const dataRow = (date, task, hours, rowNum, remark = '') => [
  date, task, '', hours,
  `=SUM($D$${FIRST_DATA_ROW}:D${rowNum})`,
  `=${DENOM}-E${rowNum}`,
  `=(E${rowNum}/${DENOM})*100`,
  remark,
];

const updates = [
  { row: 34, data: ['WEEK 2', '', '', '', '', '', '', ''] },
  // Mon 13/07 — 6.5h
  { row: 35, data: dataRow('13/07/2026', 'Weekly BA Standup (Kevin, Lester/Aiodin, WY, Menhua + full team — Zoom)', 0.5, 35) },
  { row: 36, data: dataRow('', '#promotions-team — Weekly report prep: utilization reminder to team, dashboard publishing + data verification (Alysa, Gaby, Bangun)', 1.5, 36) },
  { row: 37, data: dataRow('', '#ba-promo — P073-P078 + P066-P068 delegation to Gaby; PTI/PP FS coins=0 lines=0 confirmation with WY + Wen', 1, 37) },
  { row: 38, data: dataRow('', 'Gaby DM + WY DM — Claude token limit support (extra credits, $100 added); #hr-promotions reference check feedback to WY', 0.5, 38) },
  { row: 39, data: dataRow('', 'Kasturi DM — training handover to Wen, status monitoring', 0.5, 39) },
  { row: 40, data: dataRow('', 'Claude Automation — promo session work (FS game config, P066-P078 batch prep)', 2.5, 40) },
];

const batchData = updates.map(({ row, data: rowData }) => ({
  range: `'${TAB}'!A${row}:H${row}`,
  values: [rowData],
}));

const resp = await c.sheets.spreadsheets.values.batchUpdate({
  spreadsheetId,
  requestBody: { valueInputOption: 'USER_ENTERED', data: batchData },
});
console.log(`✓ Week 2 Mon 13/07 written: ${resp.data.totalUpdatedCells} cells (R34–R40).`);
