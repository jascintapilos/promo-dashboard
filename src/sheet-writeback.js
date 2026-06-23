// Writes promo_code + promotion_name_* back to the promo request sheet
// after a successful canary save. Non-fatal — logs a warning on failure.
//
// Usage:
//   import { writebackPromoFields } from '../src/sheet-writeback.js';
//   await writebackPromoFields(resolved);   // resolved = the record from the canary

import {
  getSheetsClient,
  getSpreadsheetId,
  resolveCurrentMonthTab,
  readHeader,
  detectColumnMapFromHeader,
} from './sheets-client.js';

export async function writebackPromoFields(resolved) {
  const sheetRow = resolved.source_line;
  if (!sheetRow || !Number.isInteger(sheetRow)) {
    console.log('  ⚠ Sheet write-back skipped: no source_line on record');
    return;
  }

  const client = await getSheetsClient();
  const tab = await resolveCurrentMonthTab(client);
  const header = await readHeader(client, tab);
  const colMap = detectColumnMapFromHeader(header);

  const fieldsToWrite = [
    ['promo_code',           resolved.promo_code],
    ['promotion_name_en',    resolved.promotion_name_en],
    ['promotion_name_zh_id', resolved.promotion_name_zh_id],
  ].filter(([field, val]) => colMap[field] !== undefined && val);

  if (fieldsToWrite.length === 0) {
    console.log('  ⚠ Sheet write-back skipped: no writable fields');
    return;
  }

  const data = fieldsToWrite.map(([field, val]) => ({
    range: `${tab}!${String.fromCharCode(65 + colMap[field])}${sheetRow}`,
    values: [[val]],
  }));

  await client.sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  });

  const written = fieldsToWrite.map(([f, v]) => `${f}=${v}`).join(', ');
  console.log(`  ✓ Sheet write-back: ${tab}!row ${sheetRow} → ${written}`);
}
