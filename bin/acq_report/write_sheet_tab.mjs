/**
 * Task 10 (optional) — write the "Acquisition (data)" backend tab to the workbook.
 * Human-readable per-code decision table from scratchpad/acq/acq-metrics-MY.json.
 * Run: node bin/acq_report/write_sheet_tab.mjs
 */
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const ACQ = 'C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/acq';
const ID = '1I7LLEir7EVsrdZnqUhR6QWRzemvDOQEY84SgmqU58GQ';
const TAB = 'Acquisition (data)';

const m = JSON.parse(fs.readFileSync(path.join(ACQ, 'acq-metrics-MY.json'), 'utf8'));
const K = m.kpis, T = m.thresholds;
const ORDER = ['Scale', 'Maintain', 'Optimise', 'Reduce', 'Stop', 'Referral', 'Low volume'];
const RGB = {
  Scale: [0.894, 0.953, 0.918], Maintain: [0.890, 0.933, 0.973], Optimise: [0.973, 0.937, 0.851],
  Reduce: [0.976, 0.914, 0.867], Stop: [0.973, 0.882, 0.878], Referral: [0.933, 0.910, 0.961], 'Low volume': [0.933, 0.945, 0.941],
};
const sorted = [...m.codes].sort((a, b) => (ORDER.indexOf(a.decision) - ORDER.indexOf(b.decision)) || (b.spend - a.spend));

const HEAD = ['Decision', 'Code', 'Name', 'Mechanic', 'Users', 'New', 'FTDs', 'Conv %', 'Purity %', 'Cost/FTD', 'Lift /RM', '30-day stick', 'NGR 7d', 'Reason'];
const blank = Array(14).fill('');
const rows = [];
rows.push(['WS1 ACQUISITION — DECISION DATA', ...Array(13).fill('')]);
rows.push([`Malaysia · MYR · Period ${m.period} · data as of ${m.data_as_of}`, ...Array(13).fill('')]);
rows.push([...blank]);
rows.push(['KPIs', `Spend RM${K.spend.toLocaleString()}`, `FTDs ${K.ftd.toLocaleString()}`, `Cost/FTD RM${K.cost_per_ftd}`, `Stick ${K.stick_30}%`, `Conversion ${K.conversion}%`, ...Array(8).fill('')]);
rows.push(['Rule', `≥ ${T.floor_claimers} users to judge`, `cheap ≤ RM${T.cost_per_ftd_p25}`, `mid ≤ RM${T.cost_per_ftd_p50}`, `expensive ≥ RM${T.cost_per_ftd_p75}`, `sticky ≥ ${T.stick_median}%`, ...Array(8).fill('')]);
rows.push([...blank]);
const HEAD_ROW = rows.length; // 0-based index of header row
rows.push(HEAD);
const num = v => (v == null ? '' : v);
for (const c of sorted) {
  rows.push([c.decision, c.code, c.name || '', c.mechanic || '', c.claimers, c.new_players, c.ftd,
    c.conversion, c.purity, num(c.cost_per_ftd), num(c.dep_lift_per_rm), num(c.stick_30), c.ngr_w7, c.reason]);
}

const { installed } = JSON.parse(fs.readFileSync(path.join(ROOT, 'google-oauth-client.local.json'), 'utf8'));
const auth = new google.auth.OAuth2(installed.client_id, installed.client_secret, 'http://localhost:3000/oauth2callback');
auth.setCredentials(JSON.parse(fs.readFileSync(path.join(ROOT, 'google-oauth-token.local.json'), 'utf8')));
const s = google.sheets({ version: 'v4', auth });

let meta = await s.spreadsheets.get({ spreadsheetId: ID });
let sheet = meta.data.sheets.find(x => x.properties.title === TAB);
if (!sheet) {
  await s.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] } });
  meta = await s.spreadsheets.get({ spreadsheetId: ID });
  sheet = meta.data.sheets.find(x => x.properties.title === TAB);
}
const sid = sheet.properties.sheetId;
await s.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: [{ unmergeCells: { range: { sheetId: sid } } }] } });
await s.spreadsheets.values.clear({ spreadsheetId: ID, range: `'${TAB}'!A1:Z200` });
await s.spreadsheets.values.update({ spreadsheetId: ID, range: `'${TAB}'!A1`, valueInputOption: 'RAW', requestBody: { values: rows } });

const N = rows.length, dataStart = HEAD_ROW + 1;
const reqs = [];
// wrap + top align
reqs.push({ repeatCell: { range: { sheetId: sid, startRowIndex: 0, endRowIndex: N, startColumnIndex: 0, endColumnIndex: 14 }, cell: { userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } }, fields: 'userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment' } });
// number formats on data rows
const fmt = (c0, c1, pat) => reqs.push({ repeatCell: { range: { sheetId: sid, startRowIndex: dataStart, endRowIndex: N, startColumnIndex: c0, endColumnIndex: c1 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: pat } } }, fields: 'userEnteredFormat.numberFormat' } });
fmt(4, 7, '#,##0');                 // Users/New/FTDs
fmt(7, 9, '0.0"%"');                // Conv/Purity
fmt(9, 10, '"RM"#,##0');            // Cost/FTD
fmt(10, 11, '0.0"×"');              // Lift
fmt(11, 12, '0.0"%"');             // Stick
fmt(12, 13, '"RM"#,##0;"−RM"#,##0'); // NGR
// bold: title, kpi, rule, header
[0, 3, 4, HEAD_ROW].forEach(r => reqs.push({ repeatCell: { range: { sheetId: sid, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 14 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } }));
// title bigger
reqs.push({ repeatCell: { range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 13 } } }, fields: 'userEnteredFormat.textFormat' } });
// decision cell colour per contiguous block
let i = dataStart;
while (i < N) {
  const dec = rows[i][0]; let j = i; while (j < N && rows[j][0] === dec) j++;
  const rgb = RGB[dec] || [1, 1, 1];
  reqs.push({ repeatCell: { range: { sheetId: sid, startRowIndex: i, endRowIndex: j, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: { red: rgb[0], green: rgb[1], blue: rgb[2] }, textFormat: { bold: true } } }, fields: 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.bold' } });
  i = j;
}
// widths
const W = [90, 240, 300, 110, 60, 55, 60, 70, 70, 85, 75, 95, 90, 360];
W.forEach((px, k) => reqs.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: k, endIndex: k + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } }));
// freeze through header
reqs.push({ updateSheetProperties: { properties: { sheetId: sid, gridProperties: { frozenRowCount: dataStart } }, fields: 'gridProperties.frozenRowCount' } });
await s.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: reqs } });

meta = await s.spreadsheets.get({ spreadsheetId: ID });
console.log(`"${TAB}" written: ${sorted.length} codes, ${N} rows.`);
console.log('tabs:', meta.data.sheets.map(x => x.properties.title).join(' | '));
