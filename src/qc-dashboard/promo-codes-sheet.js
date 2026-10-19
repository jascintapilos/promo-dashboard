// Promo Codes tab — the Ops sheet ("PromoOps Data") is the hand-off between the
// VDI and the dashboard server. No upload key: both sides already have Google
// Sheets access to that spreadsheet.
//
//   VDI (hourly, bin/push-promo-codes.mjs): check every code on BO (read-only),
//     write the list to the "Promo Codes" tab + run info to "Promo Codes Status".
//   Server (GET /api/promo-codes): read both tabs, cache a few minutes, serve to
//     allowlisted viewers only.
//
// The data tab is plain, human-readable columns (BO status as space-separated
// brand lists) so anyone looking at the sheet can read it too.
// See docs/plans/promo-codes-tab.md.

import { readFileSync } from 'node:fs';
import { sanitizePromoCodeRow, MAX_PROMO_CODE_ROWS } from './promo-codes-store.js';

export const DATA_TAB = 'Promo Codes';
export const STATUS_TAB = 'Promo Codes Status';

export const DATA_HEADERS = Object.freeze([
  'Source', 'Team / Stakeholder', 'CRM PIC', 'Mechanic / Section', 'Code', 'WS Code', 'Sheet brands', 'All brands',
  'Regions', 'Type', 'Offer / Bonus name', 'Sheet status', 'Note', 'Retired',
  'Active on BO', 'End date passed', 'Not active on BO', 'Not checked', 'Mismatch',
]);
const LAST_COL = String.fromCharCode(64 + DATA_HEADERS.length); // 19 columns → "S"
const BO_COLS = [['Active on BO', 'active'], ['End date passed', 'expired'], ['Not active on BO', 'inactive'], ['Not checked', 'unchecked']];
const MISMATCH_SEP = ' | ';

const S = Object.freeze({
  lastAttempt: 'Last attempt', result: 'Result', detail: 'Detail', lastGood: 'Last good update',
  boChecked: 'BO checked at', cee: 'CEE rows', sales: 'Sales rows', crm: 'CRM rows', notChecked: 'Brands not checked this run',
});

const words = (s) => String(s || '').split(/\s+/).filter(Boolean);

// ── payload → sheet values (VDI side) ────────────────────────────────────────

export function rowToSheet(r) {
  const boList = (st) => Object.entries(r.bo || {}).filter(([, v]) => v === st).map(([k]) => k).join(' ');
  return [
    r.source, r.group || '', r.pic || '', r.section || '', r.code, r.wsCode || '', (r.brands || []).join(' '),
    r.brandsAll ? (r.brandsAllWs ? 'ALL+WS' : 'ALL') : '', (r.regions || []).join(' '), r.type || '', r.offer || '',
    r.sheetStatus || '', r.note || '', r.retired ? 'yes' : '',
    boList('active'), boList('expired'), boList('inactive'), boList('unchecked'), (r.mismatch || []).join(MISMATCH_SEP),
  ];
}

export function statusToSheet(st) {
  return [
    ['Field', 'Value'],
    [S.lastAttempt, st.pulledAt || ''],
    [S.result, st.ok ? 'OK' : 'FAILED'],
    [S.detail, st.detail || ''],
    [S.lastGood, st.lastGoodAt || ''],
    [S.boChecked, st.boCheckedAt || ''],
    [S.cee, String(st.sources?.CEE ?? '')],
    [S.sales, String(st.sources?.Sales ?? '')],
    [S.crm, String(st.sources?.CRM ?? '')],
    [S.notChecked, (st.siteErrors || []).map((e) => `${e.brand} — ${String(e.message || '').replace(/;/g, ',')}`).join('; ')],
  ];
}

// ── sheet values → page payload (server side) ────────────────────────────────

function rowFromSheet(cells, col) {
  const get = (h) => (col[h] >= 0 && cells[col[h]] != null ? String(cells[col[h]]).trim() : '');
  const bo = {};
  for (const [h, st] of BO_COLS) for (const k of words(get(h))) bo[k] = st;
  const all = get('All brands').toUpperCase();
  return sanitizePromoCodeRow({
    source: get('Source'), group: get('Team / Stakeholder'), pic: get('CRM PIC'), section: get('Mechanic / Section'),
    code: get('Code'), wsCode: get('WS Code'), brands: words(get('Sheet brands')),
    brandsAll: all.startsWith('ALL'), brandsAllWs: all === 'ALL+WS', regions: words(get('Regions')),
    type: get('Type'), offer: get('Offer / Bonus name'), sheetStatus: get('Sheet status'), note: get('Note'),
    retired: get('Retired').toLowerCase() === 'yes', bo,
    mismatch: get('Mismatch') ? get('Mismatch').split(MISMATCH_SEP).map((m) => m.trim()).filter(Boolean) : [],
  });
}

function statusFromSheet(values) {
  const kv = new Map((values || []).slice(1).map((r) => [String(r[0] || '').trim(), String(r[1] ?? '').trim()]));
  const n = (k) => (kv.get(k) && /^\d+$/.test(kv.get(k)) ? Number(kv.get(k)) : 0);
  const siteErrors = (kv.get(S.notChecked) || '').split(';').map((s) => s.trim()).filter(Boolean)
    .map((s) => { const [brand, ...m] = s.split(' — '); return { brand: brand.trim().slice(0, 40), message: m.join(' — ').slice(0, 300) }; });
  return {
    lastAttempt: kv.get(S.lastAttempt) || null, ok: kv.get(S.result) === 'OK', detail: (kv.get(S.detail) || '').slice(0, 500),
    lastGoodAt: kv.get(S.lastGood) || null, boCheckedAt: kv.get(S.boChecked) || null,
    sources: { CEE: n(S.cee), Sales: n(S.sales), CRM: n(S.crm) }, siteErrors,
  };
}

// Returns the same shape the page has always read: { data, status }.
// data is null until the first good write; malformed rows are skipped (counted).
export function sheetToPayload(dataValues, statusValues) {
  const st = statusFromSheet(statusValues);
  const status = st.lastAttempt
    ? { ok: st.ok, lastGoodAt: st.lastGoodAt, lastFailureAt: st.ok ? null : st.lastAttempt, detail: st.detail }
    : null;
  const header = (dataValues || [])[0] || [];
  const col = Object.fromEntries(DATA_HEADERS.map((h) => [h, header.indexOf(h)]));
  if (!dataValues || dataValues.length < 2 || col.Code < 0 || !st.lastGoodAt) return { data: null, status };
  const rows = [];
  let skipped = 0;
  for (const cells of dataValues.slice(1, MAX_PROMO_CODE_ROWS + 1)) {
    if (!cells || !cells.length || !String(cells[col.Code] || '').trim()) continue;
    try { rows.push(rowFromSheet(cells, col)); } catch { skipped++; }
  }
  return {
    data: { rows, pulledAt: st.lastGoodAt, boCheckedAt: st.boCheckedAt, sources: st.sources, siteErrors: st.siteErrors, skippedRows: skipped },
    status,
  };
}

// ── server reader: cached, single-flight, serves stale on a Google hiccup ─────

const isMissingTab = (e) => /unable to parse range/i.test(String(e?.message || e?.errors?.[0]?.message || ''));

async function fetchFromGoogle() {
  const [{ loadGoogleapis, getGoogleAuth }, { getOpsSheetId }] = await Promise.all([import('../google-auth.js'), import('../ops-sheet.js')]);
  const { google } = await loadGoogleapis();
  const { client } = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth: client });
  const spreadsheetId = getOpsSheetId();
  try {
    const r = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: [`'${DATA_TAB}'!A1:${LAST_COL}`, `'${STATUS_TAB}'!A1:B`] });
    const [d, s] = r.data.valueRanges || [];
    return { data: d?.values || [], status: s?.values || [] };
  } catch (e) {
    if (isMissingTab(e)) return { data: [], status: [] }; // VDI hasn't written yet → "No data yet"
    throw e;
  }
}

// Local tests only: AUTH_MODE=dev + PROMO_CODES_SHEET_FIXTURE=<json {data,status}> replaces Google.
function fetchFromFixture(file) {
  const j = JSON.parse(readFileSync(file, 'utf8'));
  return { data: j.data || [], status: j.status || [] };
}

export function createPromoCodesReader({ ttlMs = 5 * 60_000, fetchValues, now = () => Date.now() } = {}) {
  const env = process.env;
  const fetcher = fetchValues
    || (env.AUTH_MODE === 'dev' && env.PROMO_CODES_SHEET_FIXTURE ? async () => fetchFromFixture(env.PROMO_CODES_SHEET_FIXTURE) : fetchFromGoogle);
  let cache = null; // { at, payload }
  let inflight = null;
  return async function read() {
    if (cache && now() - cache.at < ttlMs) return cache.payload;
    if (!inflight) {
      inflight = (async () => {
        try {
          const { data, status } = await fetcher();
          const payload = { ...sheetToPayload(data, status), readAt: new Date(now()).toISOString() };
          cache = { at: now(), payload };
          return payload;
        } catch (e) {
          if (cache) return { ...cache.payload, readError: 'Could not reach the Google Sheet just now — showing the last copy.' };
          return { data: null, status: null, readError: 'Could not reach the Google Sheet just now. Try again in a minute.' };
        } finally { inflight = null; }
      })();
    }
    return inflight;
  };
}

// ── VDI writer ───────────────────────────────────────────────────────────────

// Creates the tabs if needed; returns the data tab's current row count (0 if new).
async function ensureTabs(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(title,gridProperties.rowCount)' });
  const byTitle = new Map(meta.data.sheets.map((s) => [s.properties.title, s.properties]));
  const missing = [DATA_TAB, STATUS_TAB].filter((t) => !byTitle.has(t));
  if (missing.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) } });
  }
  return byTitle.get(DATA_TAB)?.gridProperties?.rowCount || 0;
}

async function readStatusValues(sheets, spreadsheetId) {
  try { return (await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${STATUS_TAB}'!A1:B` })).data.values || []; }
  catch { return []; }
}

// Good run: data first (explicit range, never append), then clear leftover rows
// below it, then the status tab — so a reader never sees an empty list mid-write.
export async function writeGoodRun(sheets, spreadsheetId, payload) {
  const gridRows = await ensureTabs(sheets, spreadsheetId);
  const values = [DATA_HEADERS.slice(), ...payload.rows.map(rowToSheet)];
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: `'${DATA_TAB}'!A1:${LAST_COL}${values.length}`, valueInputOption: 'RAW', requestBody: { values },
  });
  // Clear rows left over from a longer previous list (only rows that exist in the grid).
  if (gridRows > values.length) {
    await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${DATA_TAB}'!A${values.length + 1}:${LAST_COL}${gridRows}` });
  }
  const status = statusToSheet({ ...payload, ok: true, lastGoodAt: payload.pulledAt });
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: `'${STATUS_TAB}'!A1:B${status.length}`, valueInputOption: 'RAW', requestBody: { values: status },
  });
}

// Failed run: keep the list and the last-good fields; only record the failure.
export async function writeFailedRun(sheets, spreadsheetId, { pulledAt, detail }) {
  await ensureTabs(sheets, spreadsheetId);
  const prev = statusFromSheet(await readStatusValues(sheets, spreadsheetId));
  const status = statusToSheet({ ...prev, pulledAt, ok: false, detail, lastGoodAt: prev.lastGoodAt, boCheckedAt: prev.boCheckedAt });
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: `'${STATUS_TAB}'!A1:B${status.length}`, valueInputOption: 'RAW', requestBody: { values: status },
  });
}
