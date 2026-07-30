import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import crypto from 'node:crypto';
import { loadGoogleapis, getGoogleAuth } from '../google-auth.js';
import { getOpsSheetId } from '../ops-sheet.js';

const ROOT = 'captures/qc-dashboard';
const LOG_PATH = `${ROOT}/qc-log.jsonl`;
const TAB = 'Manual QC Log';
const HEADER = [
  'UUID', 'Timestamp', 'Promo Code', 'Brand', 'Platform', 'Region', 'Promo Type',
  'QC Result', 'Checked By', 'Findings JSON', 'Error Category', 'Description',
  'Expected', 'Actual', 'Action Required', 'Person Responsible', 'Amendment Status',
  'Recheck Status', 'Recheck Of', 'Evidence Link', 'BO Link', 'Fetch Snapshot',
  'Duration (s)', 'Sheet Status',
];

export function normalizeQcRecord(input, user) {
  const now = new Date().toISOString();
  return {
    uuid: input.uuid || crypto.randomUUID(),
    timestamp: input.timestamp || now,
    brand: input.brand,
    code: input.code,
    platform: input.platform || '',
    region: input.region || '',
    promo_type: input.promo_type || input.promoType || '',
    qc_result: input.qc_result || input.result,
    checked_by: input.checked_by || user?.email || '',
    findings: input.findings || [],
    error_category: input.error_category || input.errorCategory || '',
    description: input.description || '',
    expected: input.expected || '',
    actual: input.actual || '',
    action_required: input.action_required || input.actionRequired || '',
    person_responsible: input.person_responsible || input.personResponsible || '',
    amendment_status: input.amendment_status || input.amendmentStatus || '',
    recheck_status: input.recheck_status || input.recheckStatus || '',
    recheck_of: input.recheck_of || input.recheckOf || '',
    evidence_link: input.evidence_link || input.evidenceLink || '',
    bo_link: input.bo_link || input.boLink || '',
    fetch_snapshot: input.fetch_snapshot || input.fetchSnapshot || '',
    duration_s: input.duration_s ?? input.durationS ?? '',
    sheet_pending: false,
    // Increment 7 (real-QC upgrade): compare block + override object are
    // JSONL-only for now — the sheet header stays at 24 columns so existing
    // installs don't need a migration. When the sheet is later widened,
    // these fields already have a stable shape in the log to draw from.
    compare: input.compare || null,
    override: input.override || null,
  };
}

async function appendJsonl(record) {
  await mkdir(ROOT, { recursive: true });
  await appendFile(LOG_PATH, `${JSON.stringify(record)}\n`, 'utf8');
}

export async function readQcLog() {
  if (!existsSync(LOG_PATH)) return [];
  const raw = await readFile(LOG_PATH, 'utf8');
  return raw.split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function rowFromRecord(r) {
  return [
    r.uuid, r.timestamp, r.code, r.brand, r.platform, r.region, r.promo_type,
    r.qc_result, r.checked_by, JSON.stringify(r.findings || []), r.error_category,
    r.description, r.expected, r.actual, r.action_required, r.person_responsible,
    r.amendment_status, r.recheck_status, r.recheck_of, r.evidence_link, r.bo_link,
    r.fetch_snapshot, r.duration_s, r.sheet_pending ? 'sheet_pending' : 'written',
  ];
}

async function ensureManualTab(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
  const exists = meta.data.sheets.some((s) => s.properties.title === TAB);
  if (!exists) {
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
}

async function upsertSheet(record) {
  const { google } = await loadGoogleapis();
  const { client } = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth: client });
  const spreadsheetId = getOpsSheetId();
  await ensureManualTab(sheets, spreadsheetId);
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${TAB}'!A2:A100000`,
  });
  const ids = existing.data.values || [];
  const idx = ids.findIndex((row) => row[0] === record.uuid);
  const values = [rowFromRecord(record)];
  if (idx >= 0) {
    const rowNo = idx + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${TAB}'!A${rowNo}:X${rowNo}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
    return { action: 'update' };
  }
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${TAB}'!A:X`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
  return { action: 'append' };
}

export async function saveQcRecord(input, user) {
  const record = normalizeQcRecord(input, user);
  await appendJsonl(record);
  try {
    const sheet = await upsertSheet(record);
    return { record, sheet };
  } catch (e) {
    const pending = { ...record, sheet_pending: true, sheet_error: e.message };
    await appendJsonl(pending);
    return { record: pending, sheet: { action: 'pending', error: e.message } };
  }
}

export async function findDuplicateRecent({ brand, code, hours = 24 }) {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return (await readQcLog())
    .filter((r) => r.brand === brand && r.code === code && Date.parse(r.timestamp) >= cutoff)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0] || null;
}

export async function queryHistory({ brand, result, from, to } = {}) {
  const rows = await readQcLog();
  const fromMs = from ? Date.parse(from) : -Infinity;
  const toMs = to ? Date.parse(to) : Infinity;
  const filtered = rows.filter((r) => {
    const t = Date.parse(r.timestamp);
    return (!brand || r.brand === brand)
      && (!result || r.qc_result === result)
      && t >= fromMs
      && t <= toMs;
  }).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const aggregate = filtered.reduce((acc, r) => {
    acc.total += 1;
    acc.byResult[r.qc_result || 'UNKNOWN'] = (acc.byResult[r.qc_result || 'UNKNOWN'] || 0) + 1;
    acc.byBrand[r.brand || 'UNKNOWN'] = (acc.byBrand[r.brand || 'UNKNOWN'] || 0) + 1;
    return acc;
  }, { total: 0, byResult: {}, byBrand: {} });
  return { rows: filtered.slice(0, 100), aggregate };
}

export async function markSheetReplay(uuid, status) {
  await mkdir(ROOT, { recursive: true });
  await writeFile(`${ROOT}/sheet-replay-${uuid}.json`, `${JSON.stringify({ uuid, status, ts: new Date().toISOString() }, null, 2)}\n`, 'utf8');
}
