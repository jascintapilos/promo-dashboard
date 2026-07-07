// Shared read/write logic for the 'QC Results Log' tab (Ops sheet). Used by
// bin/log-qc-result.mjs (single-row CLI, creation-time gates) and
// bin/check-structural-health.mjs (bulk writes, scheduled sweeps) so both
// paths compute Final Bot Verdict identically and never drift apart.
import { readFileSync, existsSync, readdirSync } from 'node:fs';

export const TAB = 'QC Results Log';
export const HEADER = [
  'Timestamp', 'Promo Code', 'Brand', 'Handle', 'Region', 'Bonus Type',
  'Triage Verdict', 'Pre-QC Verdict', 'Sentinel Verdict', 'Check Trigger', 'Check Depth',
  'Final Bot Verdict', 'Flagged Reason', 'Linked QA Log ID',
];
export const COL = Object.fromEntries(HEADER.map((h, i) => [h, i]));
export const STAGE_VERDICT_COL = { triage: COL['Triage Verdict'], 'pre-qc': COL['Pre-QC Verdict'], sentinel: COL['Sentinel Verdict'] };
export const VALID_VERDICT = {
  triage: ['READY', 'NOTE', 'RETURN'],
  'pre-qc': ['PASS', 'WARNING', 'FAIL'],
  sentinel: ['PASS', 'WARNING', 'FAIL', 'INCONCLUSIVE'],
};
// 'weekly-sweep' is retained for historical rows; the scheduled estate sweep
// is being replaced by the 5pm daily brand-watch (see
// docs/promo-monitoring-system-proposal.md + advisor review 2026-07-07).
export const VALID_TRIGGER = ['manual', 'post-creation', 'weekly-sweep', 'daily-watch'];
export const VALID_DEPTH = ['full', 'structural'];

function tryRead(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function enrich(handle, bundle, plan, req) {
  const bonusType = bundle?.source?.bonus_type || plan?.bonus_type || plan?.source?.bonus_type || req?.bonus_type || '';
  const regions = bundle?.source?.regions || plan?.source?.regions || req?.regions || [];
  return {
    handle,
    region: Array.isArray(regions) ? [...new Set(regions)].join('/') : String(regions || ''),
    bonusType,
    hasBundle: Boolean(bundle),
  };
}

// Bundles/plans are named <handle>__<brand>.json — if the caller didn't pass
// an explicit handle, search for one whose embedded promo_code matches, so a
// scheduled sweep can still discover the handle for codes that DO have a
// captured bundle.
export function resolveHandleAndEnrichment(code, brand, explicitHandle) {
  if (explicitHandle) {
    const bundle = tryRead(`captures/qc-bundles/${explicitHandle}__${brand}.json`);
    const plan = tryRead(`captures/qc-plans/${explicitHandle}__${brand}.json`);
    const req = tryRead(`captures/requests/${explicitHandle}.json`);
    return enrich(explicitHandle, bundle, plan, req);
  }
  const dir = 'captures/qc-bundles';
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(`__${brand}.json`)) continue;
      const bundle = tryRead(`${dir}/${f}`);
      if (bundle?.promo_code === code) {
        const foundHandle = f.slice(0, -(`__${brand}.json`.length));
        const plan = tryRead(`captures/qc-plans/${foundHandle}__${brand}.json`);
        const req = tryRead(`captures/requests/${foundHandle}.json`);
        return enrich(foundHandle, bundle, plan, req);
      }
    }
  }
  return { handle: '', region: '', bonusType: '', hasBundle: false };
}

export function computeFinalVerdict({ triage, preQc, sentinel }) {
  if (triage === 'Skipped' && preQc === 'Skipped' && sentinel === 'Skipped') return 'Not Evaluated';
  if (triage === 'RETURN') return 'Blocked';
  if (preQc === 'FAIL') return 'Blocked';
  if (sentinel === 'FAIL') return 'Blocked';
  if (sentinel === 'INCONCLUSIVE') return 'Inconclusive';
  if ([triage, preQc, sentinel].some((v) => v === 'NOTE' || v === 'WARNING')) return 'Needs Human Review';
  if (triage === 'READY' && preQc === 'PASS' && sentinel === 'PASS') return 'Auto-Pass';
  if (sentinel === 'PASS' && !triage && !preQc) return 'Auto-Pass'; // sweep-only check, no creation-time gates for this code
  return 'Pending'; // clean so far, but not every applicable stage has run yet
}

// Ensure the tab exists (creates it with the header row if missing). Returns
// { tabExists } as it was BEFORE this call, so the caller can log whether it
// just got created.
export async function ensureTab(sheets, opsId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: opsId, fields: 'sheets.properties.title' });
  const tabExists = meta.data.sheets.some((s) => s.properties.title === TAB);
  if (!tabExists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: opsId,
      requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: opsId,
      range: `'${TAB}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADER] },
    });
  }
  return { tabExists };
}

// Read all existing rows (excluding header) as-is.
export async function readAllRows(sheets, opsId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: opsId, fields: 'sheets.properties.title' });
  if (!meta.data.sheets.some((s) => s.properties.title === TAB)) return [];
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: opsId, range: `'${TAB}'!A2:N100000` });
  return res.data.values || [];
}

// Build the updated row for one (code, brand) entry, given the existing row
// (or null) and the incoming stage/verdict. Pure function — no I/O.
export function buildUpdatedRow(existingRow, entry) {
  const { code, brand, handle: explicitHandle, stage, verdict, trigger, depth, reason } = entry;
  const found = resolveHandleAndEnrichment(code, brand, explicitHandle);
  const row = existingRow ? [...existingRow] : HEADER.map(() => '');
  while (row.length < HEADER.length) row.push('');

  row[COL['Timestamp']] = new Date().toISOString();
  row[COL['Promo Code']] = code;
  row[COL['Brand']] = brand;
  if (!row[COL['Handle']] && found.handle) row[COL['Handle']] = found.handle;
  if (!row[COL['Region']] && (found.region || entry.region)) row[COL['Region']] = found.region || entry.region;
  if (!row[COL['Bonus Type']] && found.bonusType) row[COL['Bonus Type']] = found.bonusType;

  if (stage === 'skip') {
    row[COL['Triage Verdict']] = row[COL['Pre-QC Verdict']] = row[COL['Sentinel Verdict']] = 'Skipped';
  } else {
    row[STAGE_VERDICT_COL[stage]] = verdict;
    if (stage === 'sentinel') {
      row[COL['Check Trigger']] = trigger;
      row[COL['Check Depth']] = depth;
    }
  }
  if (reason) {
    row[COL['Flagged Reason']] = row[COL['Flagged Reason']] ? `${row[COL['Flagged Reason']]} | ${reason}` : reason;
  }
  row[COL['Final Bot Verdict']] = computeFinalVerdict({
    triage: row[COL['Triage Verdict']],
    preQc: row[COL['Pre-QC Verdict']],
    sentinel: row[COL['Sentinel Verdict']],
  });
  return row;
}

// Bulk upsert: given an array of entries ({code, brand, handle?, region?,
// stage, verdict, trigger?, depth?, reason?}), reads the sheet ONCE, computes
// all updated/new rows in memory, then commits with as few API calls as
// possible (one batchUpdate for existing-row updates, one append for new
// rows). This is the path bin/check-structural-health.mjs uses for
// hundreds-to-low-thousands of rows per run — sequential per-row API calls
// at that volume would be slow and quota-risky.
export async function upsertRows(sheets, opsId, entries, { commit = false } = {}) {
  const { tabExists } = commit ? await ensureTab(sheets, opsId) : { tabExists: true };
  const rows = tabExists ? await readAllRows(sheets, opsId) : [];
  const rowIndexByKey = new Map(rows.map((r, i) => [`${r[COL['Brand']]}::${r[COL['Promo Code']]}`, i]));

  const updates = []; // { sheetRow, row }
  const appends = []; // row
  const results = []; // { entry, row, action }

  for (const entry of entries) {
    const key = `${entry.brand}::${entry.code}`;
    const idx = rowIndexByKey.get(key);
    const existingRow = idx != null ? rows[idx] : null;
    const row = buildUpdatedRow(existingRow, entry);
    if (idx != null) {
      updates.push({ sheetRow: idx + 2, row }); // +1 header, +1 1-indexed
      rows[idx] = row; // keep local view consistent if the same key appears twice in one batch
    } else {
      appends.push(row);
      rowIndexByKey.set(key, rows.length);
      rows.push(row);
    }
    results.push({ entry, row, action: idx != null ? 'update' : 'append' });
  }

  if (!commit) return { results, wouldCommit: { updateCount: updates.length, appendCount: appends.length } };

  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: opsId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: updates.map(({ sheetRow, row }) => ({ range: `'${TAB}'!A${sheetRow}:N${sheetRow}`, values: [row] })),
      },
    });
  }
  if (appends.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: opsId,
      range: `'${TAB}'!A:N`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: appends },
    });
  }
  return { results, committed: { updateCount: updates.length, appendCount: appends.length } };
}
