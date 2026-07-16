import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';

const { sheets } = await getSheetsClient();
const spreadsheetId = getOpsSheetId();
const response = await sheets.spreadsheets.values.get({
  spreadsheetId,
  range: "'Promo Code Log'!A:G",
});

const rows = response.data.values || [];
const header = rows[0] || [];
const column = (name) => header.findIndex((value) =>
  String(value || '').trim().toLowerCase() === name.toLowerCase());

const dateColumn = column('Date');
const creatorColumn = column('Created By');
const monthly = new Map();

function monthOf(value) {
  const text = String(value || '').trim();
  let match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}`;
  match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : '';
}

for (const row of rows.slice(1)) {
  const month = monthOf(row[dateColumn]);
  if (!month) continue;
  const creator = String(row[creatorColumn] || '').trim().toLowerCase();
  const stats = monthly.get(month) || { total: 0, ai: 0, human: 0, blank: 0 };
  stats.total += 1;
  if (creator === 'promo test bot' || creator === 'promo_testbot') stats.ai += 1;
  else if (creator) stats.human += 1;
  else stats.blank += 1;
  monthly.set(month, stats);
}

console.log(JSON.stringify(Object.fromEntries([...monthly].sort()), null, 2));
