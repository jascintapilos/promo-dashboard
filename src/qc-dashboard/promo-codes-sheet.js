// Promo Codes — a readable copy of the hourly list in the Ops sheet ("PromoOps
// Data"), written by the VDI (bin/push-promo-codes.mjs) next to its upload to the
// dashboard. The dashboard itself does NOT read this tab (the server has no Google
// access); it is for people who look at the Ops sheet. BO status is shown as
// space-separated brand lists. See docs/plans/promo-codes-tab.md.

export const DATA_TAB = 'Promo Codes';
export const STATUS_TAB = 'Promo Codes Status';

export const DATA_HEADERS = Object.freeze([
  'Source', 'Team / Stakeholder', 'CRM PIC', 'Mechanic / Section', 'Code', 'WS Code', 'Sheet brands', 'All brands',
  'Regions', 'Type', 'Offer / Bonus name', 'Sheet status', 'Note', 'Retired',
  'Active on BO', 'End date passed', 'Not active on BO', 'Not checked', 'Mismatch',
]);
const LAST_COL = String.fromCharCode(64 + DATA_HEADERS.length); // 19 columns → "S"
const MISMATCH_SEP = ' | ';

const S = Object.freeze({
  lastAttempt: 'Last attempt', result: 'Result', detail: 'Detail', lastGood: 'Last good update',
  boChecked: 'BO checked at', cee: 'CEE rows', sales: 'Sales rows', crm: 'CRM rows', notChecked: 'Brands not checked this run',
});

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

// Reads the status tab back so a failed run can keep the last-good fields.
function lastGoodFromStatus(values) {
  const kv = new Map((values || []).slice(1).map((r) => [String(r[0] || '').trim(), String(r[1] ?? '').trim()]));
  return { lastGoodAt: kv.get(S.lastGood) || null, boCheckedAt: kv.get(S.boChecked) || null };
}

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
  let prev = { lastGoodAt: null, boCheckedAt: null };
  try { prev = lastGoodFromStatus((await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${STATUS_TAB}'!A1:B` })).data.values); } catch {}
  const status = statusToSheet({ pulledAt, ok: false, detail, ...prev });
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: `'${STATUS_TAB}'!A1:B${status.length}`, valueInputOption: 'RAW', requestBody: { values: status },
  });
}
