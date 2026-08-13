// Shared success marker for GM01 daily commission submission.
//
// Both primary (Gaby, 10:00) and backup (Jascinta, 10:30) VDIs consult one
// Google Sheet before submitting. If today's row is already marked SUCCESS,
// the backup exits without re-submitting — preventing double payout.
//
// Config: gm01-shared-marker.local.json (gitignored)
//   {"spreadsheetId": "1abc...", "tabName": "GM01-Daily-Log"}
//
// Sheet columns (row 1 header, appended chronologically):
//   A: date          (DD-MM-YYYY of the submission run's startDate)
//   B: timestamp     (ISO of the write)
//   C: machine       (hostname of the writing VDI)
//   D: role          ("primary" | "backup")
//   E: status        ("SUCCESS" | "PARTIAL")
//   F: combos_ok     (count of successful combos, cumulative across VDIs)
//   G: combos_err    (count of combos not yet successful, cumulative)
//   H: combo_keys_ok (JSON array of submissionKey() values confirmed successful
//                     so far, cumulative across VDIs — lets a run on either
//                     machine skip combos the OTHER machine already completed,
//                     even after a partial-failure run wrote no marker before)
//
// status is SUCCESS only once every combo for the date is accounted for
// (cumulatively); otherwise PARTIAL. A run only writes a row at all if it has
// at least one newly-or-previously successful combo to report — a run with
// zero successes writes nothing, same as before this file existed.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { getSheetsClient } from './sheets-client.js';

const ROOT        = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_FILE = path.join(ROOT, 'gm01-shared-marker.local.json');

export function loadMarkerConfig() {
  if (!existsSync(CONFIG_FILE)) return null;
  try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); } catch { return null; }
}

// Returns {status,machine,timestamp,role,combos_ok,combos_err,combo_keys_ok}
// for the given date if a marker row exists, or null. Only the LATEST row for
// that date is considered — each write carries the full cumulative key list,
// so the latest row alone is always the complete picture (see writeMarker).
export async function readMarker(dateKey) {
  const cfg = loadMarkerConfig();
  if (!cfg) return null;
  const { sheets } = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: cfg.spreadsheetId,
    range: `${cfg.tabName}!A2:H`,
  });
  const rows = res.data.values ?? [];
  let latest = null;
  for (const r of rows) {
    if (r[0] === dateKey) latest = r;
  }
  if (!latest) return null;
  let comboKeysOk = [];
  try { comboKeysOk = JSON.parse(latest[7] || '[]'); } catch { comboKeysOk = []; }
  return {
    date:          latest[0],
    timestamp:     latest[1],
    machine:       latest[2],
    role:          latest[3],
    status:        latest[4],
    combos_ok:     Number(latest[5] || 0),
    combos_err:    Number(latest[6] || 0),
    combo_keys_ok: comboKeysOk,
  };
}

// comboKeysOk must be the FULL cumulative list of successful submissionKey()
// values for this date, not just this run's own contribution — readMarker
// only looks at the latest row, so a partial write that only listed "what I
// just did" would silently forget whatever the other VDI had already recorded.
export async function writeMarker(dateKey, { role, status, combosOk, combosErr, comboKeysOk }) {
  const cfg = loadMarkerConfig();
  if (!cfg) return null;
  const { sheets } = await getSheetsClient();
  const row = [
    dateKey,
    new Date().toISOString(),
    os.hostname(),
    role,
    status,
    combosOk,
    combosErr,
    JSON.stringify(comboKeysOk ?? []),
  ];
  return sheets.spreadsheets.values.append({
    spreadsheetId: cfg.spreadsheetId,
    range: `${cfg.tabName}!A:H`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

// Role of THIS VDI. Set once via gm01-shared-marker.local.json.
export function getRole() {
  const cfg = loadMarkerConfig();
  return cfg?.role || 'unknown';
}
