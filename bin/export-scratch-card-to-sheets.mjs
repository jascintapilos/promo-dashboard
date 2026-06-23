// Creates a new Google Sheet and writes the consolidated scratch card prize
// distribution data (6 source CSVs merged) into it.
// Usage: node bin/export-scratch-card-to-sheets.mjs

import { getGoogleAuth, loadGoogleapis } from '../src/google-auth.js';

const ROWS = [
  ['brand', 'currency', 'reward_prize_identifier', 'count'],
  ['a66', 'myr', 'wc_scratch_card_lucky_draw_ticket', 57],
  ['a66', 'myr', 'wc_scratch_card_no_prize', 78],
  ['a66', 'myr', 'wc_scratch_card_rm_0_10', 532],
  ['a66', 'myr', 'wc_scratch_card_rm_1', 97],
  ['a66', 'myr', 'wc_scratch_card_rm_2', 408],
  ['a66', 'myr', 'wc_scratch_card_rm_20', 9],
  ['a66', 'myr', 'wc_scratch_card_rm_4', 22],
  ['a66', 'myr', 'wc_scratch_card_rm_50', 19],
  ['a66', 'myr', 'wc_scratch_card_rm_80', 4],
  ['a66', 'sgd', 'wc_scratch_card_no_prize', 5],
  ['a66', 'sgd', 'wc_scratch_card_sgd_0_10', 27],
  ['a66', 'sgd', 'wc_scratch_card_sgd_1', 6],
  ['a66', 'sgd', 'wc_scratch_card_sgd_2', 9],
  ['a66', 'sgd', 'wc_scratch_card_sgd_20', 1],
  ['ibc22', 'myr', 'wc_scratch_card_lucky_draw_ticket', 36],
  ['ibc22', 'myr', 'wc_scratch_card_no_prize', 40],
  ['ibc22', 'myr', 'wc_scratch_card_rm_0_10', 353],
  ['ibc22', 'myr', 'wc_scratch_card_rm_1', 44],
  ['ibc22', 'myr', 'wc_scratch_card_rm_2', 307],
  ['ibc22', 'myr', 'wc_scratch_card_rm_20', 8],
  ['ibc22', 'myr', 'wc_scratch_card_rm_4', 15],
  ['ibc22', 'myr', 'wc_scratch_card_rm_5', 1],
  ['ibc22', 'myr', 'wc_scratch_card_rm_50', 16],
  ['ibc22', 'myr', 'wc_scratch_card_rm_80', 3],
  ['ibc22', 'sgd', 'wc_scratch_card_sgd_0_10', 1],
  ['spade66', 'myr', 'wc_scratch_card_lucky_draw_ticket', 69],
  ['spade66', 'myr', 'wc_scratch_card_no_prize', 64],
  ['spade66', 'myr', 'wc_scratch_card_rm_0_10', 540],
  ['spade66', 'myr', 'wc_scratch_card_rm_1', 81],
  ['spade66', 'myr', 'wc_scratch_card_rm_188', 1],
  ['spade66', 'myr', 'wc_scratch_card_rm_2', 515],
  ['spade66', 'myr', 'wc_scratch_card_rm_20', 7],
  ['spade66', 'myr', 'wc_scratch_card_rm_4', 26],
  ['spade66', 'myr', 'wc_scratch_card_rm_50', 23],
  ['spade66', 'myr', 'wc_scratch_card_rm_80', 3],
  ['spade66', 'sgd', 'wc_scratch_card_lucky_draw_ticket', 6],
  ['spade66', 'sgd', 'wc_scratch_card_no_prize', 3],
  ['spade66', 'sgd', 'wc_scratch_card_sgd_0_10', 47],
  ['spade66', 'sgd', 'wc_scratch_card_sgd_1', 11],
  ['spade66', 'sgd', 'wc_scratch_card_sgd_2', 32],
  ['spade66', 'sgd', 'wc_scratch_card_sgd_4', 2],
  ['spade66', 'sgd', 'wc_scratch_card_sgd_50', 1],
];

async function main() {
  const { client } = await getGoogleAuth();
  const { google } = await loadGoogleapis();
  const sheets = google.sheets({ version: 'v4', auth: client });

  // 1. Create new spreadsheet
  const createRes = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: 'Scratch Card Prize Distribution' },
    },
  });
  const spreadsheetId = createRes.data.spreadsheetId;
  const url = createRes.data.spreadsheetUrl;

  // 2. Write all rows in one batch
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Sheet1!A1',
    valueInputOption: 'RAW',
    requestBody: { values: ROWS },
  });

  // 3. Bold + freeze header row
  const sheetId = createRes.data.sheets[0].properties.sheetId;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: 'userEnteredFormat.textFormat.bold',
          },
        },
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
          },
        },
      ],
    },
  });

  console.log(`\nSheet created: ${url}\n`);
  console.log(`${ROWS.length - 1} data rows written (${ROWS.length} total incl. header).`);
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
