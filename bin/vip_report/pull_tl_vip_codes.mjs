/**
 * VIP sheet step — pull the TL-approved Pillar='VIP', Malaysia code universe from the live
 * "All Codes" tab to scratchpad/vip/tl-vip-codes-MY.json (mirrors the acq/ret sheet step).
 * Columns in All Codes: Market | Pillar | Bonus Code | Bonus Name | Bonus Type | Classification source | Assigned | Redeemed
 * Run: node bin/vip_report/pull_tl_vip_codes.mjs
 */
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const SCR = 'C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/vip';
const ID = '1I7LLEir7EVsrdZnqUhR6QWRzemvDOQEY84SgmqU58GQ';
fs.mkdirSync(SCR, { recursive: true });

const { installed } = JSON.parse(fs.readFileSync(path.join(ROOT, 'google-oauth-client.local.json'), 'utf8'));
const auth = new google.auth.OAuth2(installed.client_id, installed.client_secret, 'http://localhost:3000/oauth2callback');
auth.setCredentials(JSON.parse(fs.readFileSync(path.join(ROOT, 'google-oauth-token.local.json'), 'utf8')));
const s = google.sheets({ version: 'v4', auth });

const r = await s.spreadsheets.values.get({ spreadsheetId: ID, range: "'All Codes'!A1:H2000" });
const rows = r.data.values || [];
const out = [];
for (const row of rows) {
  if ((row[0] || '').trim() === 'MY' && (row[1] || '').trim() === 'VIP') {
    const code = (row[2] || '').trim();
    if (!code) continue;
    out.push({ code, name: (row[3] || '').trim(), type: (row[4] || '').trim() });
  }
}
// de-dup by code (keep first)
const seen = new Set(), uniq = [];
for (const c of out) { if (!seen.has(c.code)) { seen.add(c.code); uniq.push(c); } }
fs.writeFileSync(path.join(SCR, 'tl-vip-codes-MY.json'), JSON.stringify(uniq, null, 2), 'utf8');
const byType = {};
for (const c of uniq) byType[c.type] = (byType[c.type] || 0) + 1;
console.log(`TL VIP codes (MY): ${uniq.length}`);
console.log('by bonus type:', JSON.stringify(byType));
