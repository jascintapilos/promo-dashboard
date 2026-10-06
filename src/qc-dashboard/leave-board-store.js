// Leave Board store — casual team leave tracker (no approval workflow).
// Ported from the Apps Script "Offline Board".
//
// Persistence: one JSON file on the hub server, data/leave-board.local.json (override
// with LEAVE_BOARD_FILE). The *.local.json pattern is gitignored, so the in-place
// git-pull deploy never touches it and entries survive deploys — same approach as
// promo-refresh-state.local.json. No Google credentials or ops-sheet config needed.
//
// Every mutation is a synchronous read -> modify -> atomic write (temp file, then
// rename), so concurrent requests are serialized by the event loop and a crash
// mid-write can never truncate the file. A JSONL file is a best-effort audit trail.
import { appendFile, mkdir } from 'node:fs/promises';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const AUDIT_DIR = 'captures/qc-dashboard';
const AUDIT_PATH = `${AUDIT_DIR}/leave-board-log.jsonl`;
const HEADER = ['id', 'name', 'type', 'start', 'end', 'note', 'createdAt', 'updatedAt'];
const ALLOWED_TYPES = new Set(['AL', 'MC', 'EL', 'HALF']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Resolved per call (not at import) so tests can point it at a temp file.
function dataFile() {
  return process.env.LEAVE_BOARD_FILE || path.resolve('data', 'leave-board.local.json');
}

// Validate + normalize a submitted entry. Ported from the Offline Board's offlineClean_.
// Values are stored as plain JSON strings, so a leading =/+/-/@ is just text.
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
  return HEADER.map((k) => r[k] ?? '');
}
function recordFromRow(row = []) {
  return Object.fromEntries(HEADER.map((k, i) => [k, row[i] ?? '']));
}

// A missing file is an empty board. A corrupt file THROWS rather than reading as
// empty — otherwise the next save would overwrite it and wipe everyone's leave.
function readAll() {
  const file = dataFile();
  if (!existsSync(file)) return [];
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(`leave board data file is unreadable (${e.message}); fix or move it aside`); }
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : null;
  if (!entries) throw new Error('leave board data file has no entries array; fix or move it aside');
  return entries.map((e) => recordFromRow(rowFromRecord(e))).filter((r) => r.id);
}

function writeAll(entries) {
  const file = dataFile();
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmp, JSON.stringify({ entries }, null, 2), 'utf8');
    renameSync(tmp, file);
  } catch (e) { try { unlinkSync(tmp); } catch {} throw e; }
}

async function audit(record) {
  try {
    await mkdir(AUDIT_DIR, { recursive: true });
    await appendFile(AUDIT_PATH, `${JSON.stringify(record)}\n`, 'utf8');
  } catch { /* audit is best-effort; never block a write on the log */ }
}

export async function listEntries() {
  return readAll();
}

export async function addEntry(input, user = {}) {
  const c = cleanInput(input);
  const now = new Date().toISOString();
  const record = { id: crypto.randomUUID(), ...c, createdAt: now, updatedAt: now };
  const entries = readAll();
  entries.push(record);
  writeAll(entries);
  await audit({ action: 'add', by: user.email || '', ...record });
  return { entry: record };
}

export async function updateEntry(id, input, user = {}) {
  if (!id) throw httpError(400, 'id is required');
  const c = cleanInput(input);
  const entries = readAll();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx < 0) throw httpError(404, 'entry not found');
  const now = new Date().toISOString();
  const record = { id, ...c, createdAt: entries[idx].createdAt || now, updatedAt: now };
  entries[idx] = record;
  writeAll(entries);
  await audit({ action: 'update', by: user.email || '', ...record });
  return { entry: record };
}

export async function deleteEntry(id, user = {}) {
  if (!id) throw httpError(400, 'id is required');
  const entries = readAll();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx < 0) throw httpError(404, 'entry not found');
  entries.splice(idx, 1);
  writeAll(entries);
  await audit({ action: 'delete', by: user.email || '', id });
  return { ok: true };
}

export const _test = { ALLOWED_TYPES, HEADER, cleanInput, rowFromRecord, recordFromRow, dataFile };
