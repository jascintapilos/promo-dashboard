import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';

const { sheets } = await getSheetsClient();
const OPS_ID = getOpsSheetId();

for (const tab of ['Utilisation', 'Utilisation Weekly']) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: OPS_ID,
    range: `'${tab}'!A:H`,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const rows = res.data.values || [];
  console.log(`\n=== ${tab} (${rows.length} rows) ===`);
  console.log('Header:', JSON.stringify(rows[0]));
  const kas = rows.filter(r => (r[0] || '').includes('Kasturi'));
  console.log(`Kasturi rows: ${kas.length}`);
  kas.slice(0, 5).forEach(r => console.log(' ', JSON.stringify(r)));
  if (tab === 'Utilisation Weekly') {
    // show last 8 rows for context
    console.log('Last 8 rows:');
    rows.slice(-8).forEach(r => console.log(' ', JSON.stringify(r)));
  }
}
