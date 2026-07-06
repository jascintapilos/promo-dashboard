// Newly appended rows (values.append + INSERT_ROWS) don't inherit column
// number formatting — Sheets types recognisable date strings as serials but
// renders them as bare numbers until a format is explicitly (re-)applied.
//
// Usage:
//   const appendRes = await sheets.spreadsheets.values.append({ ... });
//   await enforceDateFormat(sheets, spreadsheetId, tabName, appendRes.data.updates.updatedRange, [0, 1, 5]);

export async function enforceDateFormat(sheets, spreadsheetId, tabName, updatedRange, columnIndexes) {
  const m = /![A-Z]+(\d+):[A-Z]+(\d+)/.exec(updatedRange || '');
  if (!m) return;
  const startRowIndex = Number(m[1]) - 1;
  const endRowIndex = Number(m[2]);

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
  });
  const tab = meta.data.sheets.find((s) => s.properties.title === tabName);
  if (!tab) return;
  const sheetId = tab.properties.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: columnIndexes.map((col) => ({
        repeatCell: {
          range: { sheetId, startRowIndex, endRowIndex, startColumnIndex: col, endColumnIndex: col + 1 },
          cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      })),
    },
  });
}
