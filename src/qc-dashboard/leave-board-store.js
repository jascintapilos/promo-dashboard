// Leave Board store — casual team leave tracker (no approval workflow).
// Ported from the Apps Script "Offline Board". Reuses the same Google auth +
// ops-sheet plumbing as leave-store.js. Data lives in a "Leave Board" tab on the
// ops sheet (or LEAVE_SHEET_ID for test runs); a JSONL file is a best-effort audit trail.
import { appendFile, mkdir } from 'node:fs/promises';
import crypto from 'node:crypto';
import { loadGoogleapis, getGoogleAuth } from '../google-auth.js';
import { getOpsSheetId } from '../ops-sheet.js';

const AUDIT_DIR = 'captures/qc-dashboard';
const AUDIT_PATH = `${AUDIT_DIR}/leave-board-log.jsonl`;
const TAB = 'Leave Board';
const HEADER = ['id', 'name', 'type', 'start', 'end', 'note', 'createdAt', 'updatedAt'];
const ALLOWED_TYPES = new Set(['AL', 'MC', 'EL', 'HALF']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Validate + normalize a submitted entry. Ported from the Offline Board's offlineClean_.
// Rows are written RAW, so Sheets stores every value as typed: dates stay YYYY-MM-DD text
// (USER_ENTERED would turn them into locale-formatted date cells) and a leading =/+/-/@
// can never run as a formula, so no apostrophe guard is needed.
function cleanInput(input = {}) {
  const name = String(input.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const type = String(input.type || '').trim().toUpperCase();
  const start = String(input.start || '').trim();
  const end = String(input.end || '').trim();
  const note = String(input.note || '').trim().slice(0, 80);
  if (!name) throw httpError(400, 'name is required');
  if (!ALLOWED_TYPES.has(type)) throw httpError(400, 'type must be one of AL, MC, EL, HALF');
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) throw httpError(400, 'start and end must be YYYY-MM-DD');
  if (end < start) throw httpError(400, 'end must be on or after start');
  return { name, type, start, end, note };
}

function rowFromRecord(r) {
  return [r.id, r.name, r.type, r.start, r.end, r.note, r.createdAt, r.updatedAt];
}
function recordFromRow(row = []) {
  return Object.fromEntries(HEADER.map((k, i) => [k, row[i] ?? '']));
}

async function audit(record) {
  try {
    await mkdir(AUDIT_DIR, { recursive: true });
    await appendFile(AUDIT_PATH, `${JSON.stringify(record)}\n`, 'utf8');
  } catch { /* audit is best-effort; never block a write on the log */ }
}

async function getSheetsClient() {
  const { google } = await loadGoogleapis();
  const { client } = await getGoogleAuth();
  return google.sheets({ version: 'v4', auth: client });
}
function getLeaveSheetId() {
  return process.env.LEAVE_SHEET_ID || getOpsSheetId();
}

async function sheetProps(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title,sheetId)' });
  return (meta.data.sheets || []).find((s) => s.properties.title === TAB) || null;
}
async function ensureTab(sheets, spreadsheetId) {
  if (await sheetProps(sheets, spreadsheetId)) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${TAB}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADER] },
  });
}
async function findRowNo(sheets, spreadsheetId, id) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB}'!A2:A100000` });
  const idx = (res.data.values || []).findIndex((row) => row[0] === id);
  return idx < 0 ? 0 : idx + 2; // 1-based sheet row (row 1 = header)
}

export async function listEntries() {
  const sheets = await getSheetsClient();
  const spreadsheetId = getLeaveSheetId();
  if (!(await sheetProps(sheets, spreadsheetId))) return [];
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB}'!A2:H100000` });
  return (res.data.values || []).map(recordFromRow).filter((r) => r.id);
}

export async function addEntry(input, user = {}) {
  const c = cleanInput(input);
  const now = new Date().toISOString();
  const record = { id: crypto.randomUUID(), ...c, createdAt: now, updatedAt: now };
  await audit({ action: 'add', by: user.email || '', ...record });
  const sheets = await getSheetsClient();
  const spreadsheetId = getLeaveSheetId();
  await ensureTab(sheets, spreadsheetId);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${TAB}'!A:H`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [rowFromRecord(record)] },
  });
  return { entry: record };
}

export async function updateEntry(id, input, user = {}) {
  if (!id) throw httpError(400, 'id is required');
  const c = cleanInput(input);
  const sheets = await getSheetsClient();
  const spreadsheetId = getLeaveSheetId();
  if (!(await sheetProps(sheets, spreadsheetId))) throw httpError(404, 'entry not found');
  const rowNo = await findRowNo(sheets, spreadsheetId, id);
  if (!rowNo) throw httpError(404, 'entry not found');
  const cur = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB}'!A${rowNo}:H${rowNo}` });
  const existing = recordFromRow((cur.data.values || [])[0] || []);
  const now = new Date().toISOString();
  const record = { id, ...c, createdAt: existing.createdAt || now, updatedAt: now };
  await audit({ action: 'update', by: user.email || '', ...record });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${TAB}'!A${rowNo}:H${rowNo}`,
    valueInputOption: 'RAW',
    requestBody: { values: [rowFromRecord(record)] },
  });
  return { entry: record };
}

export async function deleteEntry(id, user = {}) {
  if (!id) throw httpError(400, 'id is required');
  const sheets = await getSheetsClient();
  const spreadsheetId = getLeaveSheetId();
  const props = await sheetProps(sheets, spreadsheetId);
  if (!props) throw httpError(404, 'entry not found');
  const rowNo = await findRowNo(sheets, spreadsheetId, id);
  if (!rowNo) throw httpError(404, 'entry not found');
  await audit({ action: 'delete', by: user.email || '', id });
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: { sheetId: props.properties.sheetId, dimension: 'ROWS', startIndex: rowNo - 1, endIndex: rowNo },
        },
      }],
    },
  });
  return { ok: true };
}

export const _test = { ALLOWED_TYPES, HEADER, cleanInput, rowFromRecord, recordFromRow };
