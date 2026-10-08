// Ops Dashboard data store — the server-side copy of the Ops sheet tabs.
//
// The VDI nightly runner pushes each tab over the HMAC relay
// (POST /api/relay/ops/dataset/<key>); the page reads them back through the
// session-gated GET /api/ops/data. This replaces the browser reading the Google
// Sheet with a public API key, and the server needs no Google credentials.
//
// Layout (gitignored, must survive deploys like data/promo/):
//   <dir>/<key>.json        { key, headers, rows, pulledAt }   (last GOOD push)
//   <dir>/<key>.prev.json   the push before that (manual rollback)
//   <dir>/status.json       { <key>: { pulledAt, lastGoodAt, lastFailureAt, ok, rowCount, newestRowDate, detail } }
//
// A push with ok:false never replaces rows — it only records the failure, so a
// broken step leaves the last good data on screen (marked stale), not an empty tab.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// key → { tab, required: columns the page reads, dateCol: column used for newestRowDate }
export const OPS_DATASETS = Object.freeze({
  promos:               { tab: 'Promo Code Log',         required: ['Date', 'Code', 'Brand', 'Region', 'Created By', 'Type'], dateCol: 'Date' },
  banners:              { tab: 'Banner Log',             required: ['Uploaded Date', 'Brand', 'Region', 'Banner Title', 'Status', 'Uploaded By'], dateCol: 'Uploaded Date' },
  crm:                  { tab: 'CRM Assignment Log',     required: ['Date', 'Brand', 'Region', 'CRM Tool', 'Segment Name', 'Created By'], dateCol: 'Date' },
  // The CRM log is a SPLIT feed: each source lands as its own dataset so a broken
  // source can never clobber or mask a healthy one. The page concatenates these
  // with `crm` (which carries whatever still arrives via the sheet) into one view.
  // `crmSmartico` is pushed straight by bin/pull-smartico-mcp.mjs (no sheet).
  crmSmartico:          { tab: '(direct push)',          required: ['Date', 'Brand', 'Region', 'CRM Tool', 'Segment Name', 'Created By'], dateCol: 'Date' },
  crmFt:                { tab: '(direct push)',          required: ['Date', 'Brand', 'Region', 'CRM Tool', 'Segment Name', 'Created By'], dateCol: 'Date' },
  games:                { tab: 'New Games',              required: ['Date', 'Brand', 'Region', 'Game Name', 'Game Provider'], dateCol: 'Date' },
  utilisation:          { tab: 'Utilisation',            required: ['Staff', '% Utilisation'], dateCol: null },
  sysStatus:            { tab: 'System Status',          required: ['Timestamp', 'Instance', 'Label', 'Status'], dateCol: 'Timestamp' },
  adhoc:                { tab: 'Adhoc Tasks',            required: ['Date', 'Task Type', 'Task', 'Assignee'], dateCol: 'Date' },
  utilWeekly:           { tab: 'Utilisation Weekly',     required: ['Week', 'Staff', 'Hours', 'Expected'], dateCol: 'Week' },
  manualPromo:          { tab: 'Manual Entry (Promo)',   required: ['Date', 'Code', 'Brand', 'Region'], dateCol: 'Date' },
  manualBanner:         { tab: 'Manual Entry (Banner)',  required: ['Uploaded Date', 'Brand', 'Region', 'Banner Title'], dateCol: 'Uploaded Date' },
  manualCrm:            { tab: 'Manual Entry (CRM)',     required: ['Date', 'Brand', 'Region', 'CRM Tool'], dateCol: 'Date' },
  bannerHealth:         { tab: 'Banner Health',          required: ['Timestamp', 'Type', 'Site', 'Brand'], dateCol: 'Timestamp' },
  homepageBannerStatus: { tab: 'Homepage Banner Status', required: ['Timestamp', 'Site', 'Brand', 'Status'], dateCol: 'Timestamp' },
  workLog:              { tab: 'Work Log',               required: ['Date', 'Staff', 'Task', 'Hours'], dateCol: 'Date' },
});

export const MAX_OPS_ROWS = 50_000;
export const MAX_OPS_COLS = 26; // the page reads A:Z

const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };

export function opsDataDir(root, env = process.env) {
  return env.OPS_DATA_DIR ? path.resolve(env.OPS_DATA_DIR) : path.join(root, 'data', 'ops');
}

// Sheet dates arrive as YYYY-MM-DD, ISO timestamps, or D/M/YYYY (manual entry).
// Returns YYYY-MM-DD or null.
export function toIsoDay(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function isIsoInstant(s) {
  return typeof s === 'string' && s.length <= 40 && !Number.isNaN(Date.parse(s));
}

// Validates a decoded push body. Returns the normalised record or throws (status 400).
export function validateOpsPush(key, body) {
  const def = OPS_DATASETS[key];
  if (!def) throw bad('unknown dataset');
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('body must be an object');
  if (body.key !== key) throw bad('key mismatch');
  if (!isIsoInstant(body.pulledAt)) throw bad('pulledAt must be an ISO timestamp');
  if (typeof body.ok !== 'boolean') throw bad('ok must be boolean');
  const detail = typeof body.detail === 'string' ? body.detail.slice(0, 500) : '';
  if (!body.ok) return { key, ok: false, pulledAt: body.pulledAt, detail };

  const { headers, rows } = body;
  if (!Array.isArray(headers) || !headers.length || headers.length > MAX_OPS_COLS) throw bad('headers must be a non-empty array');
  if (!headers.every((h) => typeof h === 'string' && h.length <= 80)) throw bad('headers must be strings');
  const missing = def.required.filter((c) => !headers.includes(c));
  if (missing.length) throw bad(`missing columns: ${missing.join(', ')}`);
  if (!Array.isArray(rows) || rows.length > MAX_OPS_ROWS) throw bad(`rows must be an array of at most ${MAX_OPS_ROWS}`);
  for (const r of rows) {
    if (!Array.isArray(r) || r.length > MAX_OPS_COLS) throw bad('each row must be an array of at most 26 cells');
    for (const c of r) if (typeof c !== 'string' || c.length > 5000) throw bad('cells must be strings');
  }
  return { key, ok: true, pulledAt: body.pulledAt, detail, headers, rows };
}

function newestRowDate(def, headers, rows) {
  if (!def.dateCol) return null;
  const i = headers.indexOf(def.dateCol);
  if (i < 0) return null;
  let best = null;
  for (const r of rows) { const d = toIsoDay(r[i]); if (d && (!best || d > best)) best = d; }
  return best;
}

function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${crypto.randomBytes(6).toString('hex')}`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

export function readOpsStatus(dir) {
  const file = path.join(dir, 'status.json');
  if (!existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, 'utf8')) || {}; } catch { return {}; }
}

// Applies a validated push. Good pushes replace the dataset (keeping one .prev);
// failed pushes only update status.
export function applyOpsPush(dir, rec, now = new Date()) {
  mkdirSync(dir, { recursive: true });
  const status = readOpsStatus(dir);
  const prev = status[rec.key] || {};
  const receivedAt = now.toISOString();
  if (rec.ok) {
    const file = path.join(dir, `${rec.key}.json`);
    if (existsSync(file)) copyFileSync(file, path.join(dir, `${rec.key}.prev.json`));
    writeAtomic(file, JSON.stringify({ key: rec.key, headers: rec.headers, rows: rec.rows, pulledAt: rec.pulledAt }));
    status[rec.key] = {
      ...prev, ok: true, pulledAt: rec.pulledAt, lastGoodAt: rec.pulledAt, receivedAt,
      rowCount: rec.rows.length, newestRowDate: newestRowDate(OPS_DATASETS[rec.key], rec.headers, rec.rows), detail: rec.detail,
    };
  } else {
    status[rec.key] = { ...prev, ok: false, pulledAt: rec.pulledAt, lastFailureAt: rec.pulledAt, receivedAt, detail: rec.detail };
  }
  writeAtomic(path.join(dir, 'status.json'), JSON.stringify(status, null, 2));
  return status[rec.key];
}

// Everything the page needs in one payload. Datasets never pushed are omitted
// (the page shows them as "not synced yet").
export function readOpsData(dir) {
  const datasets = {};
  for (const key of Object.keys(OPS_DATASETS)) {
    const file = path.join(dir, `${key}.json`);
    if (!existsSync(file)) continue;
    try {
      const d = JSON.parse(readFileSync(file, 'utf8'));
      datasets[key] = { headers: d.headers, rows: d.rows };
    } catch { /* a corrupt file reads as missing; status still tells the story */ }
  }
  return { datasets, status: readOpsStatus(dir) };
}
