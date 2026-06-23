#!/usr/bin/env node
// QC the just-written Guideline tab — compare header against May 2026 + dump rows.
import {
  getSheetsClient,
  getSpreadsheetId,
} from '../src/sheets-client.js';

const client = await getSheetsClient();
const ssid = getSpreadsheetId();

async function readRange(range) {
  const res = await client.sheets.spreadsheets.values.get({
    spreadsheetId: ssid,
    range,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  return res.data.values || [];
}

const guidelineHeader = (await readRange("'Guideline'!A1:Z1"))[0] || [];
const mayHeader = (await readRange("'May 2026'!A1:Z1"))[0] || [];

console.log('━━━━━━ HEADER PARITY CHECK ━━━━━━');
const maxCols = Math.max(guidelineHeader.length, mayHeader.length);
let mismatch = 0;
for (let i = 0; i < maxCols; i++) {
  const col = String.fromCharCode(65 + i);
  const g = (guidelineHeader[i] || '').trim();
  const m = (mayHeader[i] || '').trim();
  const ok = g === m;
  if (!ok) mismatch++;
  console.log(`${ok ? '✓' : '✗'} ${col}: G="${g.slice(0, 50).replace(/\n/g, '/')}" | M="${m.slice(0, 50).replace(/\n/g, '/')}"`);
}
console.log(`\nMismatched columns: ${mismatch}`);

console.log('\n━━━━━━ GUIDELINE DATA ROWS (R2-R9) ━━━━━━');
const rows = await readRange("'Guideline'!A2:Y9");
rows.forEach((r, i) => {
  console.log(`\nRow ${i + 2}:`);
  ['Status','Remark','Banner','RN','Requestor','Date','Priority','Deadline','Brand','Region','Campaign','BonusType','Name/Details','Inbox','Popup','Validity','RewVal','ExpMin','Recur','MaxDly','ChgType','ChgDetails','PromoCode','EN Name','ZH/ID Name'].forEach((label, j) => {
    const v = (r[j] || '').toString().slice(0, 70);
    if (v) console.log(`  ${label.padEnd(12)}: ${v}`);
  });
});
