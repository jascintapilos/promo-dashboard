/**
 * Task 8 — write the "Retention (data)" backend tab to the workbook.
 * Human-readable per-code decision table from scratchpad/ret/ret-metrics-MY.json,
 * grouped by decision + colour-coded (mirrors the "Acquisition (data)" tab).
 * Run: node bin/ret_report/write_sheet_tab.mjs
 */
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const RET = 'C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/ret';
const ID = '1I7LLEir7EVsrdZnqUhR6QWRzemvDOQEY84SgmqU58GQ';
const TAB = 'Retention (data)';

const m = JSON.parse(fs.readFileSync(path.join(RET, 'ret-metrics-MY.json'), 'utf8'));
const K = m.kpis, T = m.thresholds, MTM = m.money_to_move;
const ORDER = ['Scale', 'Maintain', 'Optimise', 'Reduce', 'Stop', 'Watch-money', 'Monitor', 'Hold'];
const RGB = {
  Scale: [0.894, 0.953, 0.918], Maintain: [0.890, 0.933, 0.973], Optimise: [0.973, 0.937, 0.851],
  Reduce: [0.976, 0.914, 0.867], Stop: [0.973, 0.882, 0.878], 'Watch-money': [0.980, 0.949, 0.847],
  Monitor: [0.933, 0.945, 0.941], Hold: [0.933, 0.910, 0.961],
};
const sorted = [...m.codes].sort((a, b) => (ORDER.indexOf(a.decision) - ORDER.indexOf(b.decision)) || (b.spend - a.spend));

const NC = 14;
const HEAD = ['Decision', 'Code', 'Name', 'Type', 'Players', 'Spend', 'NGR Lift', 'NGR/RM', 'Uplift pp', 'Redeposit %', 'Cost/retained', '1-player %', 'Flags', 'Reason'];
const pad = a => [...a, ...Array(NC - a.length).fill('')];
const rows = [];
rows.push(pad(['WS1 RETENTION — DECISION DATA']));
rows.push(pad([`Malaysia · MYR · Period ${m.period} · data as of ${m.data_as_of}`]));
rows.push(pad([]));
rows.push(pad(['KPIs', `Spend RM${K.spend.toLocaleString()}`, `+ RM${K.winback_spend_held.toLocaleString()} win-back held`, `NGR Lift RM${K.ngr_lift.toLocaleString()}`, `NGR/RM RM${K.ngr_lift_per_rm}`, `Redeposit ${K.redeposit_rate}%`, `Money-to-move RM${MTM.stop_reduce.toLocaleString()}`]));
rows.push(pad(['Rule', `≥ ${T.vol_floor} matured players`, `break-even RM${T.break_even}`, `give-floor RM${T.give_floor}`, `strong ≥ RM${T.scale_hi}`, `retains: uplift > +${T.deadband_pp}pp vs tier×type norm`, `win-back → Hold; 1-player >${Math.round(T.conc_share * 100)}% demoted`]));
rows.push(pad(['Note', 'NGR is NET of the bonus (verified) → break-even 0. Uplift is directional vs a look-alike population, not a matched control.']));
rows.push(pad([]));
const HEAD_ROW = rows.length;
rows.push(HEAD);
const nz = v => (v == null ? '' : v);
for (const c of sorted) {
  rows.push([c.decision, c.code, c.name || '', c.mechanic || '', c.claimers, c.spend, c.ngr_lift,
    nz(c.ngr_lift_per_rm), nz(c.redeposit_uplift), nz(c.redeposit_rate), nz(c.cost_per_retained),
    nz(c.ngr_top1_share), (c.flags || []).join('; '), c.reason || '']);
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
await s.spreadsheets.values.clear({ spreadsheetId: ID, range: `'${TAB}'!A1:Z400` });
await s.spreadsheets.values.update({ spreadsheetId: ID, range: `'${TAB}'!A1`, valueInputOption: 'RAW', requestBody: { values: rows } });

const N = rows.length, dataStart = HEAD_ROW + 1;
const reqs = [];
reqs.push({ repeatCell: { range: { sheetId: sid, startRowIndex: 0, endRowIndex: N, startColumnIndex: 0, endColumnIndex: NC }, cell: { userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } }, fields: 'userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment' } });
const fmt = (c0, c1, pat) => reqs.push({ repeatCell: { range: { sheetId: sid, startRowIndex: dataStart, endRowIndex: N, startColumnIndex: c0, endColumnIndex: c1 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: pat } } }, fields: 'userEnteredFormat.numberFormat' } });
fmt(4, 5, '#,##0');                            // Players
fmt(5, 7, '"RM"#,##0;"−RM"#,##0');             // Spend, NGR Lift
fmt(7, 8, '"RM"0.00;"−RM"0.00');               // NGR/RM
fmt(8, 9, '"+"0.0;"−"0.0');                    // Uplift pp
fmt(9, 10, '0.0"%"');                           // Redeposit %
fmt(10, 11, '"RM"#,##0');                       // Cost/retained
fmt(11, 12, '0"%"');                            // 1-player share (fraction -> %)
[0, 3, 4, 5, HEAD_ROW].forEach(r => reqs.push({ repeatCell: { range: { sheetId: sid, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: NC }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } }));
reqs.push({ repeatCell: { range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 13 } } }, fields: 'userEnteredFormat.textFormat' } });
// decision colour per contiguous block
let i = dataStart;
while (i < N) {
  const dec = rows[i][0]; let j = i; while (j < N && rows[j][0] === dec) j++;
  const rgb = RGB[dec] || [1, 1, 1];
  reqs.push({ repeatCell: { range: { sheetId: sid, startRowIndex: i, endRowIndex: j, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: { red: rgb[0], green: rgb[1], blue: rgb[2] }, textFormat: { bold: true } } }, fields: 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.bold' } });
  i = j;
}
const W = [96, 230, 260, 100, 62, 90, 95, 78, 72, 90, 95, 72, 220, 340];
W.forEach((px, k) => reqs.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: k, endIndex: k + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } }));
reqs.push({ updateSheetProperties: { properties: { sheetId: sid, gridProperties: { frozenRowCount: dataStart } }, fields: 'gridProperties.frozenRowCount' } });
await s.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: reqs } });

const counts = {};
for (const c of sorted) counts[c.decision] = (counts[c.decision] || 0) + 1;
meta = await s.spreadsheets.get({ spreadsheetId: ID });
console.log(`"${TAB}" written: ${sorted.length} codes, ${N} rows.`);
console.log('by decision:', ORDER.filter(d => counts[d]).map(d => `${d} ${counts[d]}`).join(' · '));
console.log('tabs:', meta.data.sheets.map(x => x.properties.title).join(' | '));
