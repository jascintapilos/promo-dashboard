/**
 * Sheet step (market-parameterized) — pull the TL-approved code universe for ONE market
 * from the live "All Codes" tab into the three per-pillar scratchpad lists that the Python
 * pipeline reads. Replaces the older per-pillar sheet steps with a single PROMO_MARKET-driven
 * puller so MY and SG (and any future market) share one classification source.
 *
 * All Codes columns: Market | Pillar | Bonus Code | Bonus Name | Bonus Type | ...
 * Output shape per row: {code, name, type, mechanic}  (type == mechanic == Bonus Type, so
 *   the acq consumer which reads `mechanic` and the ret/vip consumers which read `type` both work).
 *
 * Run:  PROMO_MARKET=SG node bin/pull_tl_codes.mjs      (defaults to MY)
 */
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCR = 'C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad';
const ID = '1I7LLEir7EVsrdZnqUhR6QWRzemvDOQEY84SgmqU58GQ';

const MARKET = (process.env.PROMO_MARKET || 'MY').trim().toUpperCase();
const SUF = { MY: 'MY', SG: 'SG' }[MARKET];
if (!SUF) { console.error(`PROMO_MARKET must be MY or SG; got ${MARKET}`); process.exit(1); }

// pillar name in the sheet -> (scratchpad subdir, filename stem)
const PILLARS = [
  { sheet: 'Acquisition', dir: 'acq', stem: 'tl-acq-codes' },
  { sheet: 'Retention',   dir: 'ret', stem: 'tl-ret-codes' },
  { sheet: 'VIP',         dir: 'vip', stem: 'tl-vip-codes' },
];

const { installed } = JSON.parse(fs.readFileSync(path.join(ROOT, 'google-oauth-client.local.json'), 'utf8'));
const auth = new google.auth.OAuth2(installed.client_id, installed.client_secret, 'http://localhost:3000/oauth2callback');
auth.setCredentials(JSON.parse(fs.readFileSync(path.join(ROOT, 'google-oauth-token.local.json'), 'utf8')));
const s = google.sheets({ version: 'v4', auth });

const r = await s.spreadsheets.values.get({ spreadsheetId: ID, range: "'All Codes'!A1:H5000" });
const rows = r.data.values || [];

for (const p of PILLARS) {
  const seen = new Set(), uniq = [];
  for (const row of rows) {
    if ((row[0] || '').trim() !== MARKET) continue;
    if ((row[1] || '').trim() !== p.sheet) continue;
    const code = (row[2] || '').trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const type = (row[4] || '').trim();
    uniq.push({ code, name: (row[3] || '').trim(), type, mechanic: type });
  }
  const dir = path.join(SCR, p.dir);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${p.stem}-${SUF}.json`);
  fs.writeFileSync(out, JSON.stringify(uniq, null, 2), 'utf8');
  const byType = {};
  for (const c of uniq) byType[c.type] = (byType[c.type] || 0) + 1;
  console.log(`${MARKET} ${p.sheet}: ${uniq.length} codes -> ${p.stem}-${SUF}.json | ${JSON.stringify(byType)}`);
}
