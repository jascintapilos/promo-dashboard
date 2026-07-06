import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';

const { sheets } = await getSheetsClient();
const OPS_ID = getOpsSheetId();

const res = await sheets.spreadsheets.values.get({
  spreadsheetId: OPS_ID,
  range: "'CRM Assignment Log'!A:D",
  valueRenderOption: 'FORMATTED_VALUE',
});
const rows = res.data.values || [];
const [header, ...data] = rows;
console.log('Header:', header);
console.log('Total rows:', data.length);

// FT rows
const ftRows = data.filter(r => (r[3] || '').startsWith('FastTrack'));
const ftByTool = {};
for (const r of ftRows) {
  const tool = r[3] || '?';
  if (!ftByTool[tool]) ftByTool[tool] = [];
  ftByTool[tool].push(r[0]);
}

for (const [tool, dates] of Object.entries(ftByTool)) {
  const sorted = dates.filter(Boolean).sort((a, b) => {
    const toIso = d => { const p = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return p ? `${p[3]}-${p[2]}-${p[1]}` : d; };
    return toIso(a).localeCompare(toIso(b));
  });
  console.log(`\n${tool}: ${dates.length} rows`);
  console.log(`  First: ${sorted[0]}`);
  console.log(`  Last:  ${sorted[sorted.length - 1]}`);
  const toIso = d => { const p = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return p ? `${p[3]}-${p[2]}-${p[1]}` : ''; };
  const recent = sorted.filter(d => { const iso = toIso(d); return iso >= '2026-06-22'; });
  console.log(`  Jun 22+: ${recent.length} rows`);
  const thisWeek = sorted.filter(d => { const iso = toIso(d); return iso >= '2026-06-29' && iso <= '2026-07-06'; });
  console.log(`  Jun 29-Jul 6: ${thisWeek.length} rows`);
}
