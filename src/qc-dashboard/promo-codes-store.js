// Promo Codes tab — viewer allowlist, the limited `promo-codes` role, and the row
// sanitiser used when reading the list back from the Ops sheet
// (see promo-codes-sheet.js and docs/plans/promo-codes-tab.md).

import { readFileSync, existsSync } from 'node:fs';

// Git-tracked allowlist — explicit emails only; admins are NOT implied.
const VIEWERS_FILE = () => process.env.PROMO_CODES_VIEWERS_PATH || 'promo-codes-viewers.json';
// Role for people who should see ONLY this page (refused the QC Hub + Ops Dashboard).
export const PROMO_CODES_ROLE = 'promo-codes';

export const MAX_PROMO_CODE_ROWS = 20_000;
const BO_STATUSES = new Set(['active', 'expired', 'inactive', 'unchecked']);
const SOURCES = new Set(['CEE', 'Sales', 'CRM']);

const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };

export function loadPromoCodeViewers() {
  const file = VIEWERS_FILE();
  if (!existsSync(file)) return new Set();
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return new Set((Array.isArray(parsed.emails) ? parsed.emails : []).map((e) => String(e).trim().toLowerCase()).filter(Boolean));
  } catch { return new Set(); } // malformed file fails closed: nobody sees the tab
}

export function canViewPromoCodes(user) {
  if (!user?.email) return false;
  return loadPromoCodeViewers().has(String(user.email).trim().toLowerCase());
}

const str = (v, max, label) => {
  if (v == null) return '';
  if (typeof v !== 'string' || v.length > max) throw bad(`${label} must be a string of at most ${max} chars`);
  return v;
};
const strList = (v, label) => {
  if (!Array.isArray(v) || v.length > 200) throw bad(`${label} must be an array`);
  return v.map((x) => str(x, 80, label));
};

// Sheet cells are editable by anyone with access to the Ops sheet, so every row is
// re-checked before it reaches the page. Throws (status 400) on a malformed row.
export function sanitizePromoCodeRow(r) {
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
