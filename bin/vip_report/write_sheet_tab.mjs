/**
 * VIP plan Task 10 — write the "VIP (data)" backend tab to the workbook.
 * STORY-FIRST: opens with the portfolio verdict, the 3 big moves, portfolio health,
 * per-lane verdicts and a how-to-read guide; then the full code-level decision table
 * (grouped by lane then decision, colour-coded). Mini-games are rolled up by program.
 * Run: node bin/vip_report/write_sheet_tab.mjs
 */
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const VIP = 'C:/Users/vdiuser/AppData/Local/Temp/claude/C--Users-vdiuser-Downloads-promo-automation/879d83be-432b-45e6-8ade-a793a2fe518e/scratchpad/vip';
const ID = '1I7LLEir7EVsrdZnqUhR6QWRzemvDOQEY84SgmqU58GQ';
const TAB = 'VIP (data)';

const m = JSON.parse(fs.readFileSync(path.join(VIP, 'vip-metrics-MY.json'), 'utf8'));
const P = m.program, R = P.roi, W = P.whale, LS = m.lane_summary, MTM = m.money_to_move;
const rm = n => (n == null ? '' : (n < 0 ? '−RM' : 'RM') + Math.abs(Math.round(n)).toLocaleString());
const rmM = n => (n < 0 ? '−RM' : 'RM') + (Math.abs(n) >= 1e6 ? (Math.abs(n) / 1e6).toFixed(2) + 'M' : Math.round(Math.abs(n) / 1e3) + 'K');
const fi = t => { const x = P.by_tier.find(v => v.tier === t); return x ? x.funding_index : '?'; };
const per = l => `${LS[l].codes}c · ${rmM(LS[l].spend)} · ${LS[l].ngr_lift_per_rm >= 0 ? '+' : ''}${LS[l].ngr_lift_per_rm}/RM`;

const LANE_ORDER = ['A-performance', 'B-cashback', 'D-engagement', 'C-entitlement'];
const LANE_SHORT = { 'A-performance': 'A · Perf', 'B-cashback': 'B · Cashback', 'D-engagement': 'D · Engage', 'C-entitlement': 'C · Entitle' };
const DEC_ORDER = ['Scale', 'Maintain', 'Optimise', 'Reduce', 'Stop', 'Watch-money', 'Keep', 'Review', 'Trim', 'Monitor', 'Entitlement'];
const RGB = {
  Scale: [0.894, 0.953, 0.918], Maintain: [0.890, 0.933, 0.973], Optimise: [0.973, 0.937, 0.851],
  Reduce: [0.976, 0.914, 0.867], Stop: [0.973, 0.882, 0.878], 'Watch-money': [0.980, 0.949, 0.847],
  Keep: [0.851, 0.925, 0.878], Review: [0.980, 0.949, 0.847], Trim: [0.976, 0.914, 0.867],
  Monitor: [0.933, 0.945, 0.941], Entitlement: [0.933, 0.910, 0.961],
};
const LANE_RGB = { 'A-performance': [0.90, 0.95, 0.92], 'B-cashback': [0.98, 0.95, 0.85], 'D-engagement': [0.89, 0.93, 0.97], 'C-entitlement': [0.93, 0.91, 0.96] };
const MG = ['lucky-wheel', 'scratch-card', 'mystery-angpow'];
const MG_NAME = { 'lucky-wheel': 'LUCKY WHEEL (program)', 'scratch-card': 'SCRATCH CARD (program)', 'mystery-angpow': 'MYSTERY ANG POW (program)' };

const detail = c => {
  if (c.lane === 'A-performance') return `uplift ${c.redeposit_uplift > 0 ? '+' : ''}${c.redeposit_uplift ?? '—'}pp · redep ${c.redeposit_rate ?? '—'}%`;
  if (c.lane === 'B-cashback') return `kept ${c.retention_after_loss ?? '—'}% · fwd30 ${rm(c.fwd_ngr_30)} · rate ${c.cashback_rate_pct ?? '—'}%`;
  if (c.lane === 'D-engagement') return `habitual ${c.habitual_share ?? '—'}% · claims/mbr ${c.claim_freq ?? '—'}`;
  if (c.lane === 'C-entitlement') return `recipients ${(c.recipients ?? 0).toLocaleString()} · leakage ${c.leakage_share ?? '—'}%`;
  return '';
};
const byDec = (a, b) => (DEC_ORDER.indexOf(a.decision) - DEC_ORDER.indexOf(b.decision)) || (b.spend - a.spend);
function laneRows(lane) {
  const cs = m.codes.filter(c => c.lane === lane);
  if (lane !== 'D-engagement') return cs.slice().sort(byDec);
  const mini = cs.filter(c => MG.includes(c.sub_type)), check = cs.filter(c => !MG.includes(c.sub_type));
  const rolled = MG.map(st => {
    const g = mini.filter(c => c.sub_type === st); if (!g.length) return null;
    const spend = g.reduce((a, c) => a + c.spend, 0), ngr = g.reduce((a, c) => a + (c.ngr_lift || 0), 0);
    const claims = g.reduce((a, c) => a + (c.claims || 0), 0);
    const ggr = spend ? g.reduce((a, c) => a + (c.ggr_coverage || 0) * c.spend, 0) / spend : 0;
    const dc = {}; g.forEach(c => dc[c.decision] = (dc[c.decision] || 0) + 1);
    const split = Object.entries(dc).sort((a, b) => b[1] - a[1]);
    return { lane, decision: split[0][0], code: MG_NAME[st], name: `${g.length} monthly code-sets (renewed each period)`, mechanic: 'mini-game', tier_top: '', claimers: claims, spend, ngr_lift: Math.round(ngr), ngr_lift_per_rm: spend ? +(ngr / spend).toFixed(2) : null, ggr_coverage: +ggr.toFixed(1), _detail: `${g.length} codes · calls: ${split.map(([d, n]) => `${n} ${d}`).join(', ')}`, flags: [], reason: 'Recurring gamification program, rolled up across its monthly renewals.' };
  }).filter(Boolean);
  return [...rolled, ...check.sort(byDec)];
}

const NC = 14;
const HEAD = ['Lane', 'Decision', 'Code', 'Name', 'Type', 'Tier', 'Claimers', 'Spend', 'NGR Lift', 'NGR/RM', 'GGR-cov', 'Detail', 'Flags', 'Reason'];
const pad = a => [...a, ...Array(NC - a.length).fill('')];
const rows = [], sectionRows = [];       // sectionRows = full-bold section headers
const push = (a, isSection) => { if (isSection) sectionRows.push(rows.length); rows.push(pad(a)); };

// ---------- STORY (top) ----------
push(['WS1 VIP — PORTFOLIO & DECISIONS']);
push([`Malaysia · MYR · Period ${m.period} · data as of ${m.data_as_of}`]);
push([]);
push([`THE READ: VIP is ${rmM(P.total_bonus)} — the biggest promo spend. Read it as a PORTFOLIO, not code-by-code. It returns ${rmM(P.total_ytd_ngr)} of NGR (${R.total_value_ratio}× — mostly money whales spend anyway); on the INCREMENTAL read it is ~break-even ex-cashback (${R.incremental_ngr_lift >= 0 ? '+' : ''}${rm(R.incremental_ngr_lift)}). The decisions live in the portfolio, not in any single code.`]);
push([]);
push(['THE THREE BIG MOVES'], true);
push(['1. Cut net-negative subsidy', rmM(MTM.net_negative_subsidy), `${P.net_negative_share_pct}% of VIPs the house loses money on — the cleanest cut`]);
push(['2. Right-size Lane-A whale free-credit', rmM(MTM.laneA_stop_reduce), 'dead-weight on already-active whales (81% VM-pushed) — cap frequency + reprice (raise wagering)']);
push(['3. Trim + review cashback', `${rmM(MTM.cashback_trim)} / ${rmM(MTM.cashback_review)}`, 'trim Gold/Silver (fails break-even), hold Diamond & run a holdout']);
push([]);
push(['PORTFOLIO HEALTH'], true);
push(['Funding balance', `Bronze over-funded ${fi('Bronze')}× · Platinum ${fi('Platinum')} · Diamond ${fi('Diamond')} (starved)`, 'shift the tier envelope UP — budget is not where the NGR is']);
push(['Whale risk', `Top 1% (${W.top1pct_members} players) = ${W.top1pct_ngr_share}% of NGR`, `${rmM(W.value_at_risk_ngr)} value-at-risk across ${W.value_at_risk_members} declining top players`]);
push([]);
push(['LANE VERDICTS — each lane does a different job'], true);
push(['A · Perf', 'money is the judge (NGR/RM)', per('A-performance'), 'Loses money — dead-weight on active/repeat whales; cap the RM400+ whale FC + reprice']);
push(['B · Cashback', 'keeps whales past break-even?', per('B-cashback'), 'Platinum keep · Gold/Silver trim (dead-weight) · Diamond review (inconclusive → holdout)']);
push(['D · Engage', 'does it pay for itself?', per('D-engagement'), `Pays handsomely (GGR ${LS['D-engagement'].ggr_coverage}×) — keep; 3 mini-game programs + 19 check-ins`]);
push(['C · Entitle', 'relationship gift, not graded', per('C-entitlement'), 'Birthday/welcome gifts — act only if they leak to dormant accounts']);
push([]);
push(['HOW TO READ (top-down, never code-first)'], true);
push(['1 · Portfolio', 'does the program pay? where is budget vs value? how concentrated is the risk?']);
push(['2 · Lane', 'each lane has a different JOB — judge each on its own yardstick (above)']);
push(['3 · Codes', 'drill into the table below only for the one lane you are acting on']);
push(['Note', 'NGR is NET of the bonus (verified) → break-even 0. Directional vs own-baseline, not a matched control. Mini-games (Lucky Wheel / Scratch Card / Mystery Ang Pow) rolled up by program (renewed monthly).']);
push([]);
const HEAD_ROW = rows.length;
rows.push(HEAD);

// ---------- FULL CODE TABLE (below) ----------
const display = [];
for (const lane of LANE_ORDER) for (const c of laneRows(lane)) display.push(c);
const nz = v => (v == null ? '' : v);
for (const c of display) rows.push([LANE_SHORT[c.lane], c.decision, c.code, c.name || '', c.mechanic || '', c.tier_top || '', c.claimers ?? '', c.spend, c.ngr_lift, nz(c.ngr_lift_per_rm), nz(c.ggr_coverage), c._detail || detail(c), (c.flags || []).join('; '), c.reason || '']);

const { installed } = JSON.parse(fs.readFileSync(path.join(ROOT, 'google-oauth-client.local.json'), 'utf8'));
const auth = new google.auth.OAuth2(installed.client_id, installed.client_secret, 'http://localhost:3000/oauth2callback');
auth.setCredentials(JSON.parse(fs.readFileSync(path.join(ROOT, 'google-oauth-token.local.json'), 'utf8')));
const s = google.sheets({ version: 'v4', auth });

let meta = await s.spreadsheets.get({ spreadsheetId: ID });
let sheet = meta.data.sheets.find(x => x.properties.title === TAB);
if (!sheet) {
  await s.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] } });
  meta = await s.spreadsheets.get({ spreadsheetId: ID });
  sheet = meta.data.sheets.find(x => x.properties.title === TAB);
}
const sid = sheet.properties.sheetId;
await s.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: [{ unmergeCells: { range: { sheetId: sid } } }] } });
await s.spreadsheets.values.clear({ spreadsheetId: ID, range: `'${TAB}'!A1:Z600` });
await s.spreadsheets.values.update({ spreadsheetId: ID, range: `'${TAB}'!A1`, valueInputOption: 'RAW', requestBody: { values: rows } });

const N = rows.length, dataStart = HEAD_ROW + 1;
const reqs = [];
reqs.push({ repeatCell: { range: { sheetId: sid, startRowIndex: 0, endRowIndex: N, startColumnIndex: 0, endColumnIndex: NC }, cell: { userEnteredFormat: { verticalAlignment: 'TOP' } }, fields: 'userEnteredFormat.verticalAlignment' } });
// story region overflows across empty cells (reads as prose); data region wraps
reqs.push({ repeatCell: { range: { sheetId: sid, startRowIndex: 0, endRowIndex: HEAD_ROW, startColumnIndex: 0, endColumnIndex: NC }, cell: { userEnteredFormat: { wrapStrategy: 'OVERFLOW_CELL' } }, fields: 'userEnteredFormat.wrapStrategy' } });
reqs.push({ repeatCell: { range: { sheetId: sid, startRowIndex: HEAD_ROW, endRowIndex: N, startColumnIndex: 0, endColumnIndex: NC }, cell: { userEnteredFormat: { wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat.wrapStrategy' } });
const fmt = (c0, c1, pat) => reqs.push({ repeatCell: { range: { sheetId: sid, startRowIndex: dataStart, endRowIndex: N, startColumnIndex: c0, endColumnIndex: c1 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: pat } } }, fields: 'userEnteredFormat.numberFormat' } });
fmt(6, 7, '#,##0'); fmt(7, 9, '"RM"#,##0;"−RM"#,##0'); fmt(9, 10, '"RM"0.00;"−RM"0.00'); fmt(10, 11, '0.0"×"');
// bold: title (big), subtitle, section headers, HEAD row, and col A of every story row
reqs.push({ repeatCell: { range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 13 } } }, fields: 'userEnteredFormat.textFormat' } });
[1, HEAD_ROW, ...sectionRows].forEach(r => reqs.push({ repeatCell: { range: { sheetId: sid, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: NC }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } }));
reqs.push({ repeatCell: { range: { sheetId: sid, startRowIndex: 3, endRowIndex: HEAD_ROW, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } });
// colour Lane cell per lane block + Decision cell per row (data region)
let i = dataStart;
while (i < N) { const lane = display[i - dataStart].lane; let j = i; while (j < N && display[j - dataStart].lane === lane) j++; const lr = LANE_RGB[lane] || [1, 1, 1]; reqs.push({ repeatCell: { range: { sheetId: sid, startRowIndex: i, endRowIndex: j, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: { red: lr[0], green: lr[1], blue: lr[2] }, textFormat: { bold: true } } }, fields: 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.bold' } }); i = j; }
for (let r = dataStart; r < N; r++) { const rgb = RGB[display[r - dataStart].decision] || [1, 1, 1]; reqs.push({ repeatCell: { range: { sheetId: sid, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 1, endColumnIndex: 2 }, cell: { userEnteredFormat: { backgroundColor: { red: rgb[0], green: rgb[1], blue: rgb[2] }, textFormat: { bold: true } } }, fields: 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.bold' } }); }
const WID = [92, 150, 220, 240, 82, 78, 68, 92, 96, 78, 72, 240, 150, 300];
WID.forEach((px, k) => reqs.push({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: k, endIndex: k + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } }));
reqs.push({ updateSheetProperties: { properties: { sheetId: sid, gridProperties: { frozenRowCount: dataStart } }, fields: 'gridProperties.frozenRowCount' } });
await s.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: reqs } });

meta = await s.spreadsheets.get({ spreadsheetId: ID });
console.log(`"${TAB}" written: story header (${HEAD_ROW} rows) + ${display.length} code rows = ${N} total.`);
console.log('lanes:', LANE_ORDER.map(l => `${LANE_SHORT[l]} ${display.filter(c => c.lane === l).length}`).join(' · '));
console.log('tabs:', meta.data.sheets.map(x => x.properties.title).join(' | '));
