// Google Sheets API client for the Promo Code Request Details Template.
//
// Wraps an auth resolver (src/google-auth.js — service account OR OAuth
// installed-app) + spreadsheets v4 client so the rest of the pipeline can
// read live row state and write generated values (promo_code,
// promotion_name_en, promotion_name_zh_id) back to the sheet.
//
// Auth is resolved by src/google-auth.js — see that file for the three
// supported paths.
//
// All three current-month invariants are honoured:
//   • findCurrentMonthTab() resolves "May 2026" / "June 2026" / … the same
//     way the XLSX ingest does. The HEADER_ALIASES are imported from
//     src/ingest-xlsx.js so the live-read column map matches the XLSX one.
//   • A handle like "P067-r68" maps to sheet row 68 directly — source_line
//     is the same number on both paths.
//
// Public API:
//   getSpreadsheetId()                        → string
//   getSheetsClient()                         → { sheets, auth, email, mode }
//   listTabs(client)                          → [{ name, sheetId }, …]
//   resolveCurrentMonthTab(client, today?)    → tab name
//   readHeader(client, tabName)               → string[] (row 1)
//   readRow(client, tabName, row)             → string[] (any row)
//   detectColumnMapFromHeader(headerCells)    → { promo_code: 22, … } (re-exports ingest-xlsx logic)
//   writeCell(client, tabName, row, colSpec, value)  → response
//   writeFields(client, tabName, row, valuesByField, colMap) → response
//   colIndexToLetter(n)                       → "A".."AZ"…
//   a1Range(tabName, ref)                     → "'May 2026'!W68"
//
// All functions throw on error so the caller can decide retry / abort.

import {
  detectColumnMap as detectColumnMapFromXlsx,
  findCurrentMonthTab as findCurrentMonthTabFromList,
} from './ingest-xlsx.js';

import { getGoogleAuth, loadGoogleapis } from './google-auth.js';

export const SPREADSHEET_ID = '1dqvCM9SoPLJ2iYNCQRe450wBk3S7HSHtbayuAJguodM';

export function getSpreadsheetId() {
  return process.env.PROMO_SHEET_ID || SPREADSHEET_ID;
}

let _clientPromise = null;
export function getSheetsClient() {
  if (_clientPromise) return _clientPromise;
  _clientPromise = (async () => {
    const { client, email, mode } = await getGoogleAuth();
    const { google } = await loadGoogleapis();
    const sheets = google.sheets({ version: 'v4', auth: client });
    return { sheets, auth: client, email, mode };
  })();
  return _clientPromise;
}

// ── Spreadsheet metadata ────────────────────────────────────────────────

export async function listTabs(client) {
  const { sheets } = client;
  const res = await sheets.spreadsheets.get({
    spreadsheetId: getSpreadsheetId(),
    fields: 'sheets.properties(sheetId,title)',
  });
  return (res.data.sheets || []).map((s) => ({
    name: s.properties.title,
    sheetId: s.properties.sheetId,
  }));
}

export async function resolveCurrentMonthTab(client, today = new Date()) {
  const tabs = await listTabs(client);
  // findCurrentMonthTabFromList expects `{ name }` entries — same shape.
  const hit = findCurrentMonthTabFromList(tabs, today);
  if (!hit) {
    throw new Error(
      `No current-month tab found in spreadsheet ${getSpreadsheetId()}.\n` +
      `Available tabs: ${tabs.map((t) => t.name).join(', ')}`
    );
  }
  return hit.name;
}

// ── Cell read ───────────────────────────────────────────────────────────

export async function readHeader(client, tabName) {
  return readRow(client, tabName, 1);
}

export async function readRow(client, tabName, row) {
  const { sheets } = client;
  const range = a1Range(tabName, `${row}:${row}`);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  return (res.data.values && res.data.values[0]) || [];
}

export function detectColumnMapFromHeader(headerCells) {
  return detectColumnMapFromXlsx(headerCells);
}

// ── Cell write ──────────────────────────────────────────────────────────

// colSpec accepts: 0-based column index (number), column letter ("W"), or
// a field name resolved via colMap (when colMap is provided).
export async function writeCell(client, tabName, row, colSpec, value, { colMap } = {}) {
  const colLetter = resolveColLetter(colSpec, colMap);
  const range = a1Range(tabName, `${colLetter}${row}`);
  const { sheets } = client;
  const res = await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[value]] },
  });
  return res.data;
}

// Batch-write multiple fields on the same row in one API call. Skips fields
// not present in colMap (so a caller can pass { promo_code: 'X', foo: 'Y' }
// and the unknown field is silently ignored — matching XLSX parser leniency).
export async function writeFields(client, tabName, row, valuesByField, colMap) {
  if (!colMap) throw new Error('writeFields requires a colMap from detectColumnMapFromHeader');
  const data = [];
  for (const [field, value] of Object.entries(valuesByField)) {
    const colIdx = colMap[field];
    if (colIdx == null) continue;  // field not in current sheet header — skip
    const colLetter = colIndexToLetter(colIdx);
    data.push({
      range: a1Range(tabName, `${colLetter}${row}`),
      values: [[value]],
    });
  }
  if (data.length === 0) return { skipped: true, reason: 'no known fields' };
  const { sheets } = client;
  const res = await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  });
  return res.data;
}

// ── Helpers ─────────────────────────────────────────────────────────────

// 0-based column index → A1 column letters. 0→A, 25→Z, 26→AA, 701→ZZ, 702→AAA.
export function colIndexToLetter(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`bad column index: ${n}`);
  let s = '';
  let m = n + 1;
  while (m > 0) {
    const r = (m - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    m = Math.floor((m - 1) / 26);
  }
  return s;
}

// A1 column letter → 0-based index. "A"→0, "Z"→25, "AA"→26.
export function colLetterToIndex(letters) {
  const s = String(letters || '').toUpperCase();
  if (!/^[A-Z]+$/.test(s)) throw new Error(`bad column letter: ${letters}`);
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function a1Range(tabName, ref) {
  const needsQuote = /[\s'!]/.test(tabName);
  const escapedName = needsQuote ? `'${tabName.replace(/'/g, "''")}'` : tabName;
  return `${escapedName}!${ref}`;
}

function resolveColLetter(colSpec, colMap) {
  if (typeof colSpec === 'number') return colIndexToLetter(colSpec);
  const s = String(colSpec || '');
  if (/^[A-Za-z]+$/.test(s)) return s.toUpperCase();
  if (colMap && colMap[s] != null) return colIndexToLetter(colMap[s]);
  throw new Error(
    `cannot resolve column "${colSpec}" — pass a 0-based index, an A1 letter, or a field name with colMap`
  );
}
