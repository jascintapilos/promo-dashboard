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
//   A: date       (DD-MM-YYYY of the submission run's startDate)
//   B: timestamp  (ISO of the write)
//   C: machine    (hostname of the writing VDI)
//   D: role       ("primary" | "backup")
//   E: status     ("SUCCESS" | "FAILED")
//   F: combos_ok  (count of successful combos)
//   G: combos_err (count of failed combos)

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

// Returns {status,machine,timestamp,role,combos_ok,combos_err} for the given
// date if a marker row exists, or null. Only the LATEST row for that date is
// considered — a failed attempt that later succeeds shows SUCCESS.
export async function readMarker(dateKey) {
  const cfg = loadMarkerConfig();
  if (!cfg) return null;
  const { sheets } = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: cfg.spreadsheetId,
    range: `${cfg.tabName}!A2:G`,
  });
  const rows = res.data.values ?? [];
  let latest = null;
  for (const r of rows) {
    if (r[0] === dateKey) latest = r;
  }
  if (!latest) return null;
  return {
    date:       latest[0],
    timestamp:  latest[1],
    machine:    latest[2],
    role:       latest[3],
    status:     latest[4],
    combos_ok:  Number(latest[5] || 0),
    combos_err: Number(latest[6] || 0),
  };
}

export async function writeMarker(dateKey, { role, status, combosOk, combosErr }) {
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
  ];
  return sheets.spreadsheets.values.append({
    spreadsheetId: cfg.spreadsheetId,
    range: `${cfg.tabName}!A:G`,
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
