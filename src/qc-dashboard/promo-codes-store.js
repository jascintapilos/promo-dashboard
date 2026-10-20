// Promo Codes tab — server-side store + viewer allowlist.
//
// The VDI pushes the normalised code list (with live BO status) once a day over
// the HMAC relay (POST /api/relay/promo-codes/dataset); the page reads it through
// GET /api/promo-codes, which only answers sessions whose email is on the viewer
// allowlist. Same layout/rules as ops-store.js:
//   <dir>/promo-codes.json         { rows, pulledAt, boCheckedAt, sources, siteErrors }  (last GOOD push)
//   <dir>/promo-codes.prev.json    the push before that (manual rollback)
//   <dir>/promo-codes.status.json  { ok, pulledAt, lastGoodAt, lastFailureAt, rowCount, detail }
// A push with ok:false never replaces rows — the page keeps the last good list (marked stale).

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { opsDataDir } from './ops-store.js';

// Git-tracked allowlist — explicit emails only; admins are NOT implied.
const VIEWERS_FILE = () => process.env.PROMO_CODES_VIEWERS_PATH || 'promo-codes-viewers.json';
// Role for people who should see ONLY this page (refused the QC Hub + Ops Dashboard).
export const PROMO_CODES_ROLE = 'promo-codes';

export const MAX_PROMO_CODE_ROWS = 20_000;
const BO_STATUSES = new Set(['active', 'expired', 'inactive', 'unchecked']);
const SOURCES = new Set(['CEE', 'Sales', 'CRM']);

const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };

export function promoCodesDataDir(root, env = process.env) {
  return env.PROMO_CODES_DATA_DIR ? path.resolve(env.PROMO_CODES_DATA_DIR) : opsDataDir(root, env);
}

// Reads one list ("emails" or "keyOwners") from the viewer file. A missing or
// malformed file fails closed: empty list.
function loadList(field) {
  const file = VIEWERS_FILE();
  if (!existsSync(file)) return new Set();
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return new Set((Array.isArray(parsed[field]) ? parsed[field] : []).map((e) => String(e).trim().toLowerCase()).filter(Boolean));
  } catch { return new Set(); }
}

export function loadPromoCodeViewers() {
  return loadList('emails');
}

export function canViewPromoCodes(user) {
  if (!user?.email) return false;
  return loadPromoCodeViewers().has(String(user.email).trim().toLowerCase());
}

// Who may generate / revoke the Promo Codes upload key: admins, plus the people
// in "keyOwners" (the owner of the uploading VDI creates the key on that VDI, so
// it never travels). The key can only replace the Promo Codes list.
export function canManagePromoCodesKey(user) {
  if (!user?.email) return false;
  if (user.role === 'admin') return true;
  return loadList('keyOwners').has(String(user.email).trim().toLowerCase());
}

const isIsoInstant = (s) => typeof s === 'string' && s.length <= 40 && !Number.isNaN(Date.parse(s));
const str = (v, max, label) => {
  if (v == null) return '';
  if (typeof v !== 'string' || v.length > max) throw bad(`${label} must be a string of at most ${max} chars`);
  return v;
};
const strList = (v, label) => {
  if (!Array.isArray(v) || v.length > 200) throw bad(`${label} must be an array`);
  return v.map((x) => str(x, 80, label));
};

function validateRow(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw bad('each row must be an object');
  if (!SOURCES.has(r.source)) throw bad('row.source must be CEE, Sales or CRM');
  const code = str(r.code, 120, 'code');
  if (!code) throw bad('row.code is required');
  const bo = {};
  if (!r.bo || typeof r.bo !== 'object' || Array.isArray(r.bo)) throw bad('row.bo must be an object');
  const boEntries = Object.entries(r.bo);
  if (boEntries.length > 100) throw bad('row.bo has too many brands');
  for (const [k, v] of boEntries) {
    if (!/^[A-Z0-9_]{1,20}$/.test(k) || !BO_STATUSES.has(v)) throw bad('row.bo entries must be BRAND: active|expired|inactive|unchecked');
    bo[k] = v;
  }
  return {
    source: r.source, code,
    wsCode: str(r.wsCode, 120, 'wsCode'), group: str(r.group, 120, 'group'), pic: str(r.pic, 80, 'pic'),
    section: str(r.section, 200, 'section'), brands: strList(r.brands || [], 'brands'), brandsAll: r.brandsAll === true,
    regions: strList(r.regions || [], 'regions'), type: str(r.type, 80, 'type'), offer: str(r.offer, 1000, 'offer'),
    sheetStatus: str(r.sheetStatus, 2000, 'sheetStatus'), note: str(r.note, 500, 'note'), retired: r.retired === true, brandsAllWs: r.brandsAllWs === true,
    bo, mismatch: strList(r.mismatch || [], 'mismatch'),
  };
}

// Validates a decoded push body. Returns the normalised record or throws (status 400).
export function validatePromoCodesPush(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('body must be an object');
  if (!isIsoInstant(body.pulledAt)) throw bad('pulledAt must be an ISO timestamp');
  if (typeof body.ok !== 'boolean') throw bad('ok must be boolean');
  const detail = typeof body.detail === 'string' ? body.detail.slice(0, 500) : '';
  if (!body.ok) return { ok: false, pulledAt: body.pulledAt, detail };
  if (!isIsoInstant(body.boCheckedAt)) throw bad('boCheckedAt must be an ISO timestamp');
  if (!Array.isArray(body.rows) || body.rows.length > MAX_PROMO_CODE_ROWS) throw bad(`rows must be an array of at most ${MAX_PROMO_CODE_ROWS}`);
  const rows = body.rows.map(validateRow);
  const sources = {};
  for (const [k, v] of Object.entries(body.sources || {})) if (SOURCES.has(k) && Number.isInteger(v) && v >= 0) sources[k] = v;
  const siteErrors = (Array.isArray(body.siteErrors) ? body.siteErrors : []).slice(0, 100)
    .map((e) => ({ brand: str(String(e?.brand ?? ''), 40, 'siteErrors.brand'), message: String(e?.message ?? '').slice(0, 300) }));
  return { ok: true, pulledAt: body.pulledAt, boCheckedAt: body.boCheckedAt, detail, rows, sources, siteErrors };
}

function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${crypto.randomBytes(6).toString('hex')}`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

export function readPromoCodesStatus(dir) {
  const file = path.join(dir, 'promo-codes.status.json');
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')) || null; } catch { return null; }
}

export function applyPromoCodesPush(dir, rec, now = new Date()) {
  mkdirSync(dir, { recursive: true });
  const prev = readPromoCodesStatus(dir) || {};
  const receivedAt = now.toISOString();
  let status;
  if (rec.ok) {
    const file = path.join(dir, 'promo-codes.json');
    if (existsSync(file)) copyFileSync(file, path.join(dir, 'promo-codes.prev.json'));
    writeAtomic(file, JSON.stringify({
      rows: rec.rows, pulledAt: rec.pulledAt, boCheckedAt: rec.boCheckedAt, sources: rec.sources, siteErrors: rec.siteErrors,
    }));
    status = { ...prev, ok: true, pulledAt: rec.pulledAt, lastGoodAt: rec.pulledAt, receivedAt, rowCount: rec.rows.length, detail: rec.detail };
  } else {
    status = { ...prev, ok: false, pulledAt: rec.pulledAt, lastFailureAt: rec.pulledAt, receivedAt, detail: rec.detail };
  }
  writeAtomic(path.join(dir, 'promo-codes.status.json'), JSON.stringify(status, null, 2));
  return status;
}

// Everything the page needs. `data` is null until the first good push.
export function readPromoCodes(dir) {
  const file = path.join(dir, 'promo-codes.json');
  let data = null;
  if (existsSync(file)) {
    try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { /* corrupt reads as missing; status explains */ }
  }
  return { data, status: readPromoCodesStatus(dir) };
}
