#!/usr/bin/env node
// Write QP2D (SPADE66, merchant_id/site_id=4) TLEO QC OVERVIEW to the sheet.
// Layout: title + stats banner, action-items block, then a colour-coded matrix
// (green = configured, red = missing) so gaps are spottable at a glance.
// Deactivated stray codes are listed last, greyed, and marked resolved.

import { getSheetsClient } from '../src/sheets-client.js';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const SSID = '1xnuqFBBy4tepk4tgYThv0voNhQcH3Gnyh2HUV0KRPoA';
const QC_SHEET_ID = 1054653393;
const { sheets } = await getSheetsClient();

// ── 1. Read planned codes from Sheet1 & Sheet2 ──────────────────────────────
async function readRange(tab, range) {
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: SSID, range: `'${tab}'!${range}` });
  return r.data.values || [];
}
const s1 = await readRange('Sheet1', 'A1:L100');
const s2 = await readRange('Sheet 2', 'A1:J100');

function extractQp2dCode(cell) {
  if (!cell) return null;
  if (cell.includes('QP2D:')) {
    const line = cell.split('\n').find(l => l.startsWith('QP2D:'));
    return line ? line.replace('QP2D:', '').trim() : null;
  }
  const v = cell.trim();
  if (!v || v === 'Promo Code QP2D' || v === 'Promo Code' || v === 'Promo Name') return null;
  return v;
}
const sheetCodes = new Map();
for (let i = 1; i < s1.length; i++) {
  const r = s1[i];
  const cS = extractQp2dCode(r[3]); const nS = r[5]?.trim();
  if (cS && nS) sheetCodes.set(cS, nS);
  const cB = extractQp2dCode(r[9]); const nB = r[11]?.trim();
  if (cB && nB) sheetCodes.set(cB, nB);
}
for (let i = 1; i < s2.length; i++) {
  const r = s2[i];
  const cS = extractQp2dCode(r[3]); const nS = r[4]?.trim();
  if (cS && nS && !sheetCodes.has(cS)) sheetCodes.set(cS, nS);
  const cB = extractQp2dCode(r[8]); const nB = r[9]?.trim();
  if (cB && nB && !sheetCodes.has(cB)) sheetCodes.set(cB, nB);
}

// ── 2. Fetch SPADE66 (QP2D) promos from BO ──────────────────────────────────
const site = getSite('ibc22');
const resp = await authedFetch(site, '/api/bo/promotion?code=TLEO&perPage=200&page=1');
const allRows = resp.data?.rows || [];
const all = Array.isArray(allRows) ? allRows : Object.values(allRows);
const boMap = new Map();
all
  .filter(p => p.code?.includes('TLEO') && (p.merchant_ids || []).some(m => m.id === 4))
  .forEach(p => boMap.set(p.code, p));

// ── 3. Helpers ────────────────────────────────────────────────────────────────
function detectNameIssue(code, boName) {
  const issues = [];
  const mxMatch = code.match(/_(\d+)MX/);
  if (mxMatch) {
    const mxName = boName.match(/max bns (\d+)/);
    if (mxName && mxName[1] !== mxMatch[1]) issues.push(`name shows max bns ${mxName[1]} (code = ${mxMatch[1]})`);
  }
  if (boName.includes('no max transfer')) issues.push('"no max transfer" → should be "no max withdrawal"');
  return issues.join('; ');
}
function parseCategory(code, boName) {
  if (/Slot and LC/i.test(boName) || code.startsWith('FT_TLEO_FC')) return 'Slot + LC';
  if (/Live Casino/i.test(boName) || /_LC_/.test(code)) return 'Live Casino';
  return 'Slot';
}
function parseTier(code, boName) {
  if (/Silver/i.test(boName)) return 'Silver';
  if (/Normal-Bronze/i.test(boName)) return 'Normal';
  if (/Bronze/i.test(boName)) return 'Bronze';
  if (code.endsWith('_BR')) return 'Bronze';
  return '';
}
function parseRate(code) {
  if (code.startsWith('FT_TLEO_FC')) return 'FC';
  const m = code.match(/_(\d+)PCT/);
  return m ? `${m[1]}%` : '';
}
function catOrder(c) { return c === 'Live Casino' ? 0 : c === 'Slot' ? 1 : 2; }
function rateOrder(r) { return r === 'FC' ? 99 : parseInt(r) || 0; }
function tierOrder(t) { return t === 'Silver' ? 0 : t === 'Bronze' ? 1 : 2; }

// ── 4. Build item list ──────────────────────────────────────────────────────
const allCodes = new Set([...sheetCodes.keys(), ...boMap.keys()]);
const items = [...allCodes].map(code => {
  const promo = boMap.get(code);
  const inBO = !!promo;
  const inSheet = sheetCodes.has(code);
  const status = inBO ? promo.status : null;
  const isActive = status === 1;
  const boName = inBO ? promo.name : '(NOT IN BO)';
  const cat = parseCategory(code, boName);
  const tier = parseTier(code, boName);
  const rate = parseRate(code);
  const hasInbox = inBO && promo.message_template_id > 0;
  const hasSms = inBO && promo.message_template_sms_id > 0;
  const dp = promo?.dialog_popup_list;
  const hasPopup = inBO && (Array.isArray(dp) ? dp.length > 0 : (dp && Object.keys(dp || {}).length > 0));
  const nameIssue = inBO ? detectNameIssue(code, boName) : '';
  const isStray = inBO && !inSheet;
  const deactivatedStray = isStray && !isActive;
  const notes = [
    deactivatedStray ? 'Deactivated stray (status=0) — resolved; QP2 has no hard-delete, safely inactive' :
      (isStray ? 'Extra — not in plan (ACTIVE)' : ''),
    !inBO ? 'MISSING from BO' : '',
    nameIssue,
  ].filter(Boolean).join('; ');
  // OK = active in-plan code fully configured. Deactivated stray = resolved.
  const ok = (inBO && inSheet && isActive && hasInbox && hasPopup && hasSms && !nameIssue) || deactivatedStray;
  return { code, cat, tier, rate, boName, status, isActive, hasInbox, hasPopup, hasSms, notes, ok, inBO, inSheet, deactivatedStray };
});
// Sort: live/in-plan first (grouped), deactivated strays pushed to the very end.
items.sort((a, b) =>
  (a.deactivatedStray ? 1 : 0) - (b.deactivatedStray ? 1 : 0) ||
  catOrder(a.cat) - catOrder(b.cat) ||
  rateOrder(a.rate) - rateOrder(b.rate) ||
  tierOrder(a.tier) - tierOrder(b.tier) ||
  a.code.localeCompare(b.code));

// ── 5. Stats ──────────────────────────────────────────────────────────────────
const active = items.filter(i => i.isActive);
const planned = items.filter(i => i.inSheet);
const inboxN = active.filter(i => i.hasInbox).length;
const popupN = active.filter(i => i.hasPopup).length;
const smsN = active.filter(i => i.hasSms).length;
const actionItems = items.filter(i => !i.ok);            // unresolved only
const deactivated = items.filter(i => i.deactivatedStray);
const today = new Date().toISOString().slice(0, 10);

// ── 6. Compose grid ───────────────────────────────────────────────────────────
const TITLE = `QP2D · SPADE66 (merchant/site_id 4) — TLEO Promo Configuration QC`;
const STATS = `Planned ${planned.length} · Active in BO ${active.length} · Inbox ${inboxN}/${active.length} · Pop Up ${popupN}/${active.length} · SMS ${smsN}/${active.length} · Open issues ${actionItems.length} · Deactivated strays ${deactivated.length} · ${today}`;
const LEGEND = `CHECKBOX LEGEND   ☑ Inbox = Message Template (member inbox message)   ·   ☑ Pop Up = Login Popup dialog (after-login)   ·   ☑ SMS = SMS notification template   ·   ☑ OK = all three set + name/plan correct`;

const grid = [];
grid.push([TITLE]);
grid.push([STATS]);
grid.push([LEGEND]);
grid.push(['']);
const actionHeaderRow = grid.length;
const actionHeaderTxt = actionItems.length
  ? `ACTION ITEMS — ${actionItems.length} need attention`
  : `ACTION ITEMS — ALL CLEAR  ✓  (popup added to 50% Slot · FC228 name fixed · stray 228MX deactivated)`;
grid.push([actionHeaderTxt]);
const actionStart = grid.length;
for (const a of actionItems) {
  const miss = [];
  if (!a.hasInbox) miss.push('Inbox');
  if (!a.hasPopup) miss.push('Pop Up');
  if (!a.hasSms) miss.push('SMS');
  const detail = [a.notes, miss.length ? `Missing: ${miss.join(', ')}` : ''].filter(Boolean).join('  —  ');
  grid.push([`✗  ${a.code}`, detail]);
}
const actionEnd = grid.length;
grid.push(['']);
const headerRow = grid.length;
grid.push(['#', 'Promo Code', 'Category', 'Tier', 'Rate', 'Inbox', 'Pop Up', 'SMS', 'OK', 'QP2D BO Name', 'Notes']);
const dataStart = grid.length;
items.forEach((it, idx) => {
  // For deactivated strays use text markers (not booleans) so red/green CF skips them.
  const cell = (v) => (it.deactivatedStray ? '—' : v);
  grid.push([
    idx + 1, it.code, it.cat, it.tier, it.rate,
    cell(it.hasInbox), cell(it.hasPopup), cell(it.hasSms), it.deactivatedStray ? 'n/a' : it.ok,
    it.boName, it.notes,
  ]);
});
const dataEnd = grid.length;
const firstStrayIdx = items.findIndex(i => i.deactivatedStray);
const liveDataEnd = firstStrayIdx === -1 ? dataEnd : dataStart + firstStrayIdx; // exclusive end of boolean rows

// ── 7. RESET sheet (remove stale merges/CF/formatting/validation from prior runs) ──
// values.clear() alone leaves merges + conditional formats + data validations
// behind; as the layout shifts between runs those stale objects land on the
// wrong rows (e.g. an old action-item B:K merge covering the header row).
{
  const meta0 = await sheets.spreadsheets.get({ spreadsheetId: SSID });
  const qcSheet = meta0.data.sheets.find(s => s.properties.sheetId === QC_SHEET_ID);
  const resetReq = [];
  (qcSheet.merges || []).forEach(m => resetReq.push({ unmergeCells: { range: m } }));
  const cfCount = (qcSheet.conditionalFormats || []).length;
  for (let i = cfCount - 1; i >= 0; i--) resetReq.push({ deleteConditionalFormatRule: { sheetId: QC_SHEET_ID, index: i } });
  resetReq.push({
    repeatCell: {
      range: { sheetId: QC_SHEET_ID, startRowIndex: 0, endRowIndex: 300, startColumnIndex: 0, endColumnIndex: 26 },
      cell: { userEnteredFormat: {}, dataValidation: null },
      fields: 'userEnteredFormat,dataValidation',
    },
  });
  if (resetReq.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId: SSID, requestBody: { requests: resetReq } });
}

// ── 7b. Clear + write values ──────────────────────────────────────────────────
await sheets.spreadsheets.values.clear({ spreadsheetId: SSID, range: "'QC SHEET'!A1:Z300" });
const width = 11;
const padded = grid.map(r => { const c = [...r]; while (c.length < width) c.push(''); return c; });
await sheets.spreadsheets.values.update({
  spreadsheetId: SSID, range: "'QC SHEET'!A1", valueInputOption: 'RAW', requestBody: { values: padded },
});

// ── 8. Formatting ────────────────────────────────────────────────────────────
const COL = { INBOX: 5, POPUP: 6, SMS: 7, OK: 8 };
const requests = [];
const band = (r0, r1, bg, tf) => ({ repeatCell: { range: { sheetId: QC_SHEET_ID, startRowIndex: r0, endRowIndex: r1, startColumnIndex: 0, endColumnIndex: width }, cell: { userEnteredFormat: { backgroundColor: bg, textFormat: tf } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } });
const merge = (r0, r1, c0 = 0, c1 = width) => ({ mergeCells: { range: { sheetId: QC_SHEET_ID, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 }, mergeType: 'MERGE_ALL' } });

requests.push(merge(0, 1));
requests.push(band(0, 1, { red: 0.12, green: 0.24, blue: 0.40 }, { bold: true, fontSize: 13, foregroundColor: { red: 1, green: 1, blue: 1 } }));
requests.push(merge(1, 2));
requests.push(band(1, 2, { red: 0.85, green: 0.91, blue: 0.98 }, { bold: true, fontSize: 10 }));
requests.push(merge(2, 3));
requests.push(band(2, 3, { red: 0.93, green: 0.95, blue: 0.86 }, { italic: true, fontSize: 10, foregroundColor: { red: 0.25, green: 0.30, blue: 0.15 } }));
requests.push(merge(actionHeaderRow, actionHeaderRow + 1));
const actionBg = actionItems.length ? { red: 0.96, green: 0.78, blue: 0.30 } : { red: 0.71, green: 0.88, blue: 0.71 };
requests.push(band(actionHeaderRow, actionHeaderRow + 1, actionBg, { bold: true, fontSize: 11 }));
if (actionEnd > actionStart) {
  for (let r = actionStart; r < actionEnd; r++) requests.push(merge(r, r + 1, 1, width));
  requests.push(band(actionStart, actionEnd, { red: 1.0, green: 0.96, blue: 0.86 }, { fontSize: 10 }));
  requests.push({ repeatCell: { range: { sheetId: QC_SHEET_ID, startRowIndex: actionStart, endRowIndex: actionEnd, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: { red: 0.78, green: 0.13, blue: 0.13 } } } }, fields: 'userEnteredFormat.textFormat' } });
}
// Table header
requests.push({ repeatCell: { range: { sheetId: QC_SHEET_ID, startRowIndex: headerRow, endRowIndex: headerRow + 1, startColumnIndex: 0, endColumnIndex: width }, cell: { userEnteredFormat: { backgroundColor: { red: 0.18, green: 0.34, blue: 0.55 }, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)' } });
requests.push({ updateSheetProperties: { properties: { sheetId: QC_SHEET_ID, gridProperties: { frozenRowCount: headerRow + 1 } }, fields: 'gridProperties.frozenRowCount' } });

// Checkbox validation + green/red CF only on LIVE rows (exclude deactivated strays)
if (liveDataEnd > dataStart) {
  for (const col of [COL.INBOX, COL.POPUP, COL.SMS, COL.OK]) {
    requests.push({ setDataValidation: { range: { sheetId: QC_SHEET_ID, startRowIndex: dataStart, endRowIndex: liveDataEnd, startColumnIndex: col, endColumnIndex: col + 1 }, rule: { condition: { type: 'BOOLEAN' }, showCustomUi: true } } });
  }
  const cbRange = { sheetId: QC_SHEET_ID, startRowIndex: dataStart, endRowIndex: liveDataEnd, startColumnIndex: COL.INBOX, endColumnIndex: COL.OK + 1 };
  const fc = String.fromCharCode(65 + COL.INBOX);
  requests.push({ addConditionalFormatRule: { rule: { ranges: [cbRange], booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=${fc}${dataStart + 1}=FALSE` }] }, format: { backgroundColor: { red: 0.96, green: 0.80, blue: 0.80 } } } }, index: 0 } });
  requests.push({ addConditionalFormatRule: { rule: { ranges: [cbRange], booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=${fc}${dataStart + 1}=TRUE` }] }, format: { backgroundColor: { red: 0.80, green: 0.93, blue: 0.80 } } } }, index: 1 } });
}
// Centre meta + flag columns
for (const col of [0, 2, 3, 4, COL.INBOX, COL.POPUP, COL.SMS, COL.OK]) {
  requests.push({ repeatCell: { range: { sheetId: QC_SHEET_ID, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: col, endColumnIndex: col + 1 }, cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat.horizontalAlignment' } });
}
// Grey out deactivated stray rows
if (firstStrayIdx !== -1) {
  requests.push({ repeatCell: { range: { sheetId: QC_SHEET_ID, startRowIndex: dataStart + firstStrayIdx, endRowIndex: dataEnd, startColumnIndex: 0, endColumnIndex: width }, cell: { userEnteredFormat: { backgroundColor: { red: 0.87, green: 0.87, blue: 0.87 }, textFormat: { italic: true, foregroundColor: { red: 0.4, green: 0.4, blue: 0.4 } } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } });
}
// Column widths
for (const [idx, px] of [[0, 36], [1, 290], [2, 95], [3, 70], [4, 55], [5, 60], [6, 65], [7, 55], [8, 50], [9, 330], [10, 320]]) {
  requests.push({ updateDimensionProperties: { range: { sheetId: QC_SHEET_ID, dimension: 'COLUMNS', startIndex: idx, endIndex: idx + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } });
}
requests.push({ repeatCell: { range: { sheetId: QC_SHEET_ID, startRowIndex: dataStart, endRowIndex: dataEnd, startColumnIndex: 9, endColumnIndex: 11 }, cell: { userEnteredFormat: { wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat.wrapStrategy' } });
requests.push({ updateBorders: { range: { sheetId: QC_SHEET_ID, startRowIndex: headerRow, endRowIndex: dataEnd, startColumnIndex: 0, endColumnIndex: width }, top: { style: 'SOLID', color: { red: 0.7, green: 0.7, blue: 0.7 } }, bottom: { style: 'SOLID', color: { red: 0.7, green: 0.7, blue: 0.7 } }, left: { style: 'SOLID', color: { red: 0.7, green: 0.7, blue: 0.7 } }, right: { style: 'SOLID', color: { red: 0.7, green: 0.7, blue: 0.7 } }, innerHorizontal: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } }, innerVertical: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } } } });

await sheets.spreadsheets.batchUpdate({ spreadsheetId: SSID, requestBody: { requests } });

console.log('=== QC OVERVIEW updated ===');
console.log(STATS);
console.log(`\nOpen action items: ${actionItems.length}`);
actionItems.forEach(a => console.log(`  ✗ ${a.code}: ${a.notes}`));
console.log(`\nDeactivated strays (resolved): ${deactivated.length}`);
deactivated.forEach(d => console.log(`  • ${d.code} (status=0)`));
console.log('\nDone ✓');
