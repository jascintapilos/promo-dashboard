#!/usr/bin/env node
// Push Ops sheet tabs to the dashboard server over the relay, so the Ops Dashboard
// reads them from the server instead of from Google with a public API key.
// Reads each tab back from the Ops sheet (VDI OAuth) — the pull scripts stay as
// they are; this mirrors exactly what the sheet holds, Manual Entry tabs included.
//
//   node bin/push-ops-dataset.mjs <key…>                 push current tab contents (ok)
//   node bin/push-ops-dataset.mjs <key…> --failed="why"  record a failed pull (keeps last good rows)
//   node bin/push-ops-dataset.mjs --all
//   env: QC_HUB_URL (default https://qc-dashboard.zoom66.xyz), QC_RELAY_WORKER_ID
//
// Exit 0 when every push succeeded; 1 otherwise (message, never the secret).

import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { readWorkerRelaySecret, buildSignedHeaders, MAX_REPORT_BUILD_BYTES } from '../src/qc-dashboard/relay-auth.js';
import { OPS_DATASETS } from '../src/qc-dashboard/ops-store.js';
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';

const HUB = (process.env.QC_HUB_URL || 'https://qc-dashboard.zoom66.xyz').replace(/\/+$/, '');
const WORKER_ID = process.env.QC_RELAY_WORKER_ID || `ops-push-${process.pid}`;

// Rows exactly as the page used to get them from values:batchGet (formatted
// strings, A:Z). Returns { headers, rows } with rows padded/stringified.
async function readTab(sheets, spreadsheetId, tab) {
  const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${tab}'!A:Z` });
  const values = r.data.values || [];
  const headers = (values[0] || []).map((h) => String(h));
  const rows = values.slice(1).map((row) => row.map((c) => (c == null ? '' : String(c))));
  return { headers, rows };
}

async function postSigned(key, payload, secret) {
  const relPath = `/api/relay/ops/dataset/${key}`;
  const gz = gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
  const { headers, bodyBuffer } = buildSignedHeaders({
    method: 'POST', path: relPath, bodyBuffer: gz, secret, workerId: WORKER_ID, maxBytes: MAX_REPORT_BUILD_BYTES,
  });
  headers['content-type'] = 'application/gzip';
  const resp = await fetch(`${HUB}${relPath}`, { method: 'POST', headers, body: bodyBuffer });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`server rejected ${key} (${resp.status}): ${text.slice(0, 200)}`);
  return { key, bytes: gz.length, response: JSON.parse(text) };
}

// Pushes each key. ok=false sends a failure marker instead of rows.
// Returns [{ key, ok, error?, rowCount? }] — never throws for a single key.
export async function pushOpsDatasets(keys, { ok = true, detail = '', pulledAt = new Date().toISOString(), log = console.log } = {}) {
  const secret = readWorkerRelaySecret();
  if (!secret.present) return keys.map((key) => ({ key, ok: false, error: `relay secret unavailable — ${secret.reason}` }));
  let sheets = null; let spreadsheetId = null;
  const results = [];
  for (const key of keys) {
    try {
      const def = OPS_DATASETS[key];
      if (!def) throw new Error(`unknown dataset "${key}"`);
      let payload = { key, pulledAt, ok, detail };
      if (ok) {
        if (!sheets) { ({ sheets } = await getSheetsClient()); spreadsheetId = getOpsSheetId(); }
        payload = { ...payload, ...(await readTab(sheets, spreadsheetId, def.tab)) };
      }
      const r = await postSigned(key, payload, secret.secret);
      log(`  ↑ ops ${key}: ${ok ? `${payload.rows.length} rows` : 'FAILED marker'} (${(r.bytes / 1024).toFixed(0)} KB gzip) → newest ${r.response.status?.newestRowDate || '—'}`);
      results.push({ key, ok: true, rowCount: ok ? payload.rows.length : null });
    } catch (e) {
      log(`  ✖ ops ${key}: ${e.message}`);
      results.push({ key, ok: false, error: e.message });
    }
  }
  return results;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const failedArg = args.find((a) => a.startsWith('--failed'));
  const keys = args.includes('--all') ? Object.keys(OPS_DATASETS) : args.filter((a) => !a.startsWith('--'));
  if (!keys.length) { console.error('usage: node bin/push-ops-dataset.mjs <key…> | --all [--failed="detail"]'); process.exit(2); }
  const results = await pushOpsDatasets(keys, failedArg ? { ok: false, detail: failedArg.split('=').slice(1).join('=') } : {});
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
