// Team Notices store — short memos shown at the top of the Ops Dashboard
// (e.g. "use the TUMKT prefix for new QPro/QPly test accounts").
//
// Persistence mirrors leave-board-store.js: one JSON file on the hub server,
// data/notices.local.json (override with NOTICES_FILE). *.local.json is gitignored,
// so the in-place git-pull deploy leaves it alone and notices survive deploys.
// Synchronous read -> modify -> atomic write (temp file, then rename); a corrupt
// file throws instead of reading as empty, so a save can never wipe it.
import { appendFile, mkdir } from 'node:fs/promises';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const AUDIT_DIR = 'captures/qc-dashboard';
const AUDIT_PATH = `${AUDIT_DIR}/notices-log.jsonl`;
const FIELDS = ['id', 'title', 'body', 'by', 'createdAt', 'updatedAt', 'updatedBy'];
const TITLE_MAX = 100;
const BODY_MAX = 2000;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Resolved per call (not at import) so tests can point it at a temp file.
function dataFile() {
  return process.env.NOTICES_FILE || path.resolve('data', 'notices.local.json');
}

function cleanInput(input = {}) {
  const title = String(input.title || '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
  // keep the author's line breaks, trim trailing spaces per line, collapse 3+ blank lines
  const body = String(input.body || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, BODY_MAX);
  if (!title) throw httpError(400, 'title is required');
  if (!body) throw httpError(400, 'message is required');
  return { title, body };
}

function normalize(n = {}) {
  return Object.fromEntries(FIELDS.map((k) => [k, n[k] == null ? '' : String(n[k])]));
}

function readAll() {
  const file = dataFile();
  if (!existsSync(file)) return [];
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(`notices data file is unreadable (${e.message}); fix or move it aside`); }
  if (!Array.isArray(parsed?.notices)) throw new Error('notices data file has no notices array; fix or move it aside');
  return parsed.notices.map(normalize).filter((n) => n.id);
}

function writeAll(notices) {
  const file = dataFile();
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmp, JSON.stringify({ notices }, null, 2), 'utf8');
    renameSync(tmp, file);
  } catch (e) { try { unlinkSync(tmp); } catch {} throw e; }
}

async function audit(record) {
  try {
    await mkdir(AUDIT_DIR, { recursive: true });
    await appendFile(AUDIT_PATH, `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`, 'utf8');
  } catch { /* best-effort */ }
}

// Newest first.
export async function listNotices() {
  return readAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function addNotice(input, user = {}) {
  const c = cleanInput(input);
  const now = new Date().toISOString();
  const notice = normalize({ id: crypto.randomUUID(), ...c, by: user.email || '', createdAt: now, updatedAt: now });
  const all = readAll();
  all.push(notice);
  writeAll(all);
  await audit({ action: 'add', by: user.email || '', ...notice });
  return { notice };
}

export async function updateNotice(id, input, user = {}) {
  if (!id) throw httpError(400, 'id is required');
  const c = cleanInput(input);
  const all = readAll();
  const idx = all.findIndex((n) => n.id === id);
  if (idx < 0) throw httpError(404, 'notice not found');
  const notice = normalize({ ...all[idx], ...c, updatedAt: new Date().toISOString(), updatedBy: user.email || '' });
  all[idx] = notice;
  writeAll(all);
  await audit({ action: 'update', by: user.email || '', ...notice });
  return { notice };
}

export async function deleteNotice(id, user = {}) {
  if (!id) throw httpError(400, 'id is required');
  const all = readAll();
  const idx = all.findIndex((n) => n.id === id);
  if (idx < 0) throw httpError(404, 'notice not found');
  const [removed] = all.splice(idx, 1);
  writeAll(all);
  await audit({ action: 'delete', by: user.email || '', id, title: removed.title });
  return { ok: true };
}

export const _test = { cleanInput, dataFile, TITLE_MAX, BODY_MAX };
