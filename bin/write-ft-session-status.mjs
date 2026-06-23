#!/usr/bin/env node
/**
 * Reads the three FT CRM session files and writes their health status to
 * the 'System Status' tab in the Weekly Report sheet.
 * Called from ft-keepalive.bat after refresh-ft-sessions.mjs.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';

const OPS_ID = getOpsSheetId();
const TAB = 'System Status';
const NOW = new Date().toISOString();

const INSTANCES = {
  ws1:   'WS1/WS2',
  qpro1: 'QPRO1',
  qp2:   'QP2A–D',
};

const rows = [['Timestamp', 'Instance', 'Label', 'Status', 'Valid Until', 'Detail']];

for (const [inst, label] of Object.entries(INSTANCES)) {
  const file = path.resolve(`ft-session-${inst}.local.json`);
  if (!existsSync(file)) {
    rows.push([NOW, inst, label, 'MISSING', '', 'Session file not found']);
    continue;
  }

  const session = JSON.parse(readFileSync(file, 'utf8'));
  const tok = session.cookies?.find(c => c.name === 'portaltoken');
  if (!tok?.value) {
    rows.push([NOW, inst, label, 'NO TOKEN', '', 'portaltoken not found in session']);
    continue;
  }

  const exp = tok.expires || 0;
  const nowSec = Math.floor(Date.now() / 1000);
  const validUntil = exp > 0 ? new Date(exp * 1000).toISOString() : 'session';

  // Quick API check
  const base = new URL(session.loginUrl).origin;
  let status = 'UNKNOWN', detail = '';
  try {
    const res = await fetch(`${base}/crm-api/Authentication/AdminUsers`, {
      headers: { authtoken: tok.value, Accept: 'application/json' },
    });
    const data = await res.json().catch(() => null);
    if (data?.Success === false) {
      const msg = data?.Errors?.[0]?.Message || 'API rejected token';
      status = 'EXPIRED';
      detail = msg;
    } else if (!res.ok) {
      status = 'ERROR';
      detail = `HTTP ${res.status}`;
    } else {
      status = 'OK';
      detail = session.refreshedAt ? `Refreshed ${session.refreshedAt.slice(0,16).replace('T',' ')}` : '';
    }
  } catch (e) {
    status = 'ERROR';
    detail = e.message.slice(0, 60);
  }

  rows.push([NOW, inst, label, status, validUntil, detail]);
}

try {
  const { sheets } = await getSheetsClient();

  // Ensure tab exists
  const meta = await sheets.spreadsheets.get({ spreadsheetId: OPS_ID, fields: 'sheets.properties.title' });
  const exists = meta.data.sheets.some(s => s.properties.title === TAB);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: OPS_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
    });
    console.log(`Created '${TAB}' tab`);
  }

  // Upsert: keep existing rows for OTHER instances (pull statuses), replace only our 3 FT instances.
  const myInstances = new Set(Object.keys(INSTANCES));
  const existing = await sheets.spreadsheets.values.get({ spreadsheetId: OPS_ID, range: `'${TAB}'!A:F` });
  const all = existing.data.values || [];
  const header = all[0] || rows[0];
  const kept = all.slice(1).filter(r => r && r.some(c => c) && !myInstances.has(r[1]));
  const finalRows = [header, ...kept, ...rows.slice(1)];

  await sheets.spreadsheets.values.clear({ spreadsheetId: OPS_ID, range: `'${TAB}'!A:F` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: OPS_ID,
    range: `'${TAB}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: finalRows },
  });

  const statuses = rows.slice(1).map(r => `${r[1]}:${r[3]}`).join(' ');
  console.log(`✅ System Status written (${statuses})`);
} catch (e) {
  console.error(`⚠  Could not write System Status: ${e.message}`);
}
