import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.join(__dirname, '..');
const clientJson = JSON.parse(fs.readFileSync(path.join(BASE, 'google-oauth-client.local.json')));
const auth = new google.auth.OAuth2(
  clientJson.installed.client_id,
  clientJson.installed.client_secret,
  clientJson.installed.redirect_uris[0]
);
auth.setCredentials(JSON.parse(fs.readFileSync(path.join(BASE, 'google-oauth-token.local.json'))));

const sheets = google.sheets({ version: 'v4', auth });
const drive  = google.drive({ version: 'v3', auth });
const OKR_ID = '175Qj_q9I-nG2E3zbfDW5_zcML9N6DwdebE0iIreZp2c';
const OLD_DOC = '1FVmRcSxKuIl8NVCdc3ScJxdO39r78RSoDQpqCFc91lI'; // plain text doc to delete

// ── Colour helpers ──────────────────────────────────────────────────────────
const rgb = (r,g,b) => ({ red: r/255, green: g/255, blue: b/255 });
const C = {
  titleBg:    rgb(13,27,42),   titleFg:    rgb(255,255,255),
  sectionBg:  rgb(28,71,135),  sectionFg:  rgb(255,255,255),
  headerBg:   rgb(201,218,248),headerFg:   rgb(0,0,0),
  done:       rgb(217,234,211),
  inprog:     rgb(255,242,204),
  upcoming:   rgb(252,229,205),
  planned:    rgb(234,209,247),
  white:      rgb(255,255,255),
};

// ── Content rows ─────────────────────────────────────────────────────────────
// Each entry: [quarterLabel, statusLabel, deliverables]
const W1 = [
  ['Q1 2026','✓ Completed','• Evaluated AI use case for Promo Content Translation\n• Scoped 4 target languages: EN / ZH / ID / KM\n• Designed HTML pipeline architecture'],
  ['Q2 2026','✓ Completed','• Launched promo-translation-html skill (Claude Code)\n• Tested end-to-end on 5 live promo documents\n• Auto-appends KM/ID glossary terms\n• Handles ZH inverted structure + ID-before-EN ordering'],
  ['Q3 2026','Upcoming',   '• Drive auto-write: output directly into Google Docs\n• Batch translation: multiple docs in one run\n• QC integration: auto-check output before publish'],
  ['Q4 2026','Planned',    '• Full automation — zero manual steps\n• All brand locales covered'],
];
const W2 = [
  ['Q1 2026','✓ Completed','• Evaluated automation feasibility across QPRO, QP2, WS1/WS2\n• Captured API shapes for all 3 platforms (Deposit / FC / FS)\n• Built canary prototype with live BO testing'],
  ['Q2 2026','✓ Completed','• Deployed promo_testbot to production\n• Covers 34 brands: QPRO1–19, QP2A–D, WS1/WS2\n• All 3 bonus types: Deposit, Free Credit, Free Spin\n• Live Sheets ingest, auto-namer, QC engine, inbox automation\n• Blacklist template resolver + per-brand currency filter'],
  ['Q3 2026','Upcoming',   '• Maintain & improve — target ≥95% automation success rate\n• Full WS2 coverage\n• Auto write-back: update request sheet status on completion'],
  ['Q4 2026','Planned',    '• ≥90% total workflow coverage\n• Zero manual BO entry for standard promo types\n• Self-healing QC loop with auto-correction'],
];
const W3 = [
  ['Q1 2026','✓ Completed','• Evaluated automation feasibility for QPRO, QP2, WS1/WS2\n• Captured 14.2 (homepage) and 3.3 (promo page) API shapes\n• Designed B-ID tracking system'],
  ['Q2 2026','✓ Completed','• Deployed upload-promo.js (CLI tool)\n• QPRO + QP2 homepage + promo page banners live\n• Verified on multiple B-IDs (B16, B17+)\n• Weekly health check: monitors expired/expiring/inactive banners\n• Multi-region locale fan-out (EN / ZH / ID)'],
  ['Q3 2026','Upcoming',   '• WS1 v3/v4 and WS2 banner automation\n• Auto-position logic (in-house vs PP vs others)\n• Multi-region fan-out for additional brand locales'],
  ['Q4 2026','Planned',    '• All platforms: end-to-end from B-ID to live banner\n• Zero manual upload steps\n• Automated health checks across all brands'],
];
const W4 = [
  ['Q1 2026','✓ Completed','• Evaluated CRM automation feasibility\n• Mapped FastTrack (FT) API: WS1/WS2 bonus assignment + VM blasting\n• Mapped Smartico API: QPRO2–19 + QP2A–D (19 brand label IDs captured)\n• Assessed complexity across all channel types'],
  ['Q2 2026','In Assessment','• Workflow fully documented\n• Requirements defined for FT VM Blasting automation (MB8 / WS1)\n• Smartico flow builder structure captured (SMS, Inbox, Popup, WA, Bonus nodes)\n• CRM automation requirements 80% complete'],
  ['Q3 2026','Upcoming',   '• FT WS1 VM Blasting automation pilot (MB8)\n• Smartico segment auto-import via CSV\n• Flow builder automation for standard journey types'],
  ['Q4 2026','Planned',    '• Multi-platform CRM automation\n• Segment + campaign setup fully automated\n• End-to-end: promo request → live campaign'],
];
const SUM = [
  ['Q1 2026','Evaluate AI use cases across all 4 workflows','All 4 workflows assessed and scoped. Architecture designed. Promo Code prototype built.'],
  ['Q2 2026','Deploy automation for Promo Code + Banner; assess CRM','Promo Code (34 brands, 3 bonus types) + Banner Upload deployed to production. CRM assessment 80% complete.'],
  ['Q3 2026','Expand to WS1/WS2; pilot CRM automation; ≥95% success rate','Starting July 2026'],
  ['Q4 2026','Full automation coverage ≥90%; productivity gains ≥30%','Starting October 2026'],
];
const COV = [
  ['Translation',           '✓ MVP Live (Q2)', 'QPRO / QP2 / WS1 — 5 docs tested, 4 languages (EN/ZH/ID/KM)'],
  ['Promo Code Creation',   '✓ Production Live (Q2)', '34 brands — QPRO1–19, QP2A–D, WS1/WS2 — 3 bonus types'],
  ['Banner Upload',         '✓ Production Live (Q2)', 'QPRO + QP2 all brands — WS1/WS2 automation in Q3'],
  ['CRM Campaign Setup',    'In Assessment (Q2)', 'Assessment complete — FT + Smartico pilot in Q3'],
];

// ── Row layout ────────────────────────────────────────────────────────────────
// Build flat rows array: [colA, colB, colC]
const BLANK = ['','',''];
const rows = [
  // 1-2: Title block
  ['PROMO OPERATIONS — AUTOMATION ROADMAP 2026','',''],
  ['Jascinta Pilos  ·  Promotions Specialist  ·  The Branding People  ·  June 2026','',''],
  BLANK,
  // 4-5: Overview
  ['OVERVIEW','',''],
  ['This roadmap tracks the evaluation, implementation and expansion of AI-assisted automation across four core Promo Operations workflows. Automation tooling is built on Claude Code (Anthropic) and integrates directly with QPRO, QP2 and WS1/WS2 back-office platforms via API.','',''],
  BLANK,
  // 7-12: Workflow 1
  ['WORKFLOW 1 — TRANSLATION','',''],
  ['Quarter','Status','Key Deliverables'],
  ...W1,
  BLANK,
  // 14-19: Workflow 2
  ['WORKFLOW 2 — PROMO CODE CREATION','',''],
  ['Quarter','Status','Key Deliverables'],
  ...W2,
  BLANK,
  // 21-26: Workflow 3
  ['WORKFLOW 3 — BANNER UPLOAD','',''],
  ['Quarter','Status','Key Deliverables'],
  ...W3,
  BLANK,
  // 28-33: Workflow 4
  ['WORKFLOW 4 — CRM CAMPAIGN SETUP','',''],
  ['Quarter','Status','Key Deliverables'],
  ...W4,
  BLANK,
  // 35-40: Summary
  ['SUMMARY BY QUARTER','',''],
  ['Quarter','Objectives','Result'],
  ...SUM,
  BLANK,
  // 42-47: Coverage
  ['AUTOMATION COVERAGE SNAPSHOT — JUNE 2026','',''],
  ['Workflow','Q1–Q2 Status','Coverage'],
  ...COV,
];

// ── Status → colour map ───────────────────────────────────────────────────────
const statusColor = s => {
  if (!s) return C.white;
  if (s.includes('Completed')) return C.done;
  if (s.includes('Assessment') || s.includes('Progress')) return C.inprog;
  if (s === 'Upcoming') return C.upcoming;
  if (s === 'Planned')  return C.planned;
  return C.white;
};

// Row index (0-based) of each "type"
const titleRows    = [0, 1];
const sectionRows  = [3, 6, 13, 20, 27, 34, 41];
const headerRows   = [7, 14, 21, 28, 35, 42];
const dataRowRanges = [
  [8,11],[15,18],[22,25],[29,32],[36,39],[43,46]
];

async function run() {
  // 1. Delete old plain-text doc
  try {
    await drive.files.delete({ fileId: OLD_DOC });
    console.log('Deleted old doc');
  } catch(e) { console.log('Delete skip:', e.message); }

  // 2. Create new spreadsheet
  const created = await sheets.spreadsheets.create({
    requestBody: { properties: { title: 'Promo Operations — Automation Roadmap 2026' } }
  });
  const ssId = created.data.spreadsheetId;
  const sheetId = created.data.sheets[0].properties.sheetId;
  console.log('Created sheet:', ssId);

  // 3. Write values
  await sheets.spreadsheets.values.update({
    spreadsheetId: ssId,
    range: 'Sheet1!A1:C' + rows.length,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });

  // 4. Build formatting requests
  const req = [];
  const r0 = (r, c, numR=1, numC=1) => ({
    sheetId, startRowIndex: r, endRowIndex: r+numR,
    startColumnIndex: c, endColumnIndex: c+numC
  });
  const cell = (range, fields, format) => ({
    repeatCell: { range, cell: { userEnteredFormat: format }, fields }
  });
  const bgFgBold = (range, bg, fg, size=11, bold=true) =>
    cell(range, 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
      { backgroundColor: bg,
        textFormat: { foregroundColor: fg, bold, fontSize: size },
        horizontalAlignment: 'LEFT' });
  const merge = (r, numC=3) => ({
    mergeCells: { range: r0(r,0,1,numC), mergeType: 'MERGE_ALL' }
  });
  const border = (range) => ({
    updateBorders: {
      range,
      top:    { style:'SOLID', width:1, color: rgb(180,180,180) },
      bottom: { style:'SOLID', width:1, color: rgb(180,180,180) },
      left:   { style:'SOLID', width:1, color: rgb(180,180,180) },
      right:  { style:'SOLID', width:1, color: rgb(180,180,180) },
      innerHorizontal: { style:'SOLID', width:1, color: rgb(180,180,180) },
      innerVertical:   { style:'SOLID', width:1, color: rgb(180,180,180) },
    }
  });

  // Column widths: A=120, B=160, C=500
  req.push({ updateDimensionProperties: {
    range: { sheetId, dimension:'COLUMNS', startIndex:0, endIndex:1 },
    properties: { pixelSize: 120 }, fields:'pixelSize'
  }});
  req.push({ updateDimensionProperties: {
    range: { sheetId, dimension:'COLUMNS', startIndex:1, endIndex:2 },
    properties: { pixelSize: 160 }, fields:'pixelSize'
  }});
  req.push({ updateDimensionProperties: {
    range: { sheetId, dimension:'COLUMNS', startIndex:2, endIndex:3 },
    properties: { pixelSize: 500 }, fields:'pixelSize'
  }});

  // Freeze row 1
  req.push({ updateSheetProperties: {
    properties: { sheetId, gridProperties: { frozenRowCount: 2 } },
    fields: 'gridProperties.frozenRowCount'
  }});

  // Wrap all text
  req.push(cell(r0(0,0,rows.length,3),
    'userEnteredFormat(wrapStrategy)',
    { wrapStrategy: 'WRAP' }));

  // Title rows
  for (const r of titleRows) {
    req.push(merge(r));
    const isMeta = r===1;
    req.push(bgFgBold(r0(r,0), C.titleBg, C.titleFg, isMeta ? 10 : 15));
    if (r===0) req.push({ updateDimensionProperties: {
      range: { sheetId, dimension:'ROWS', startIndex:0, endIndex:1 },
      properties: { pixelSize: 48 }, fields:'pixelSize'
    }});
  }

  // Section header rows
  for (const r of sectionRows) {
    req.push(merge(r));
    req.push(bgFgBold(r0(r,0), C.sectionBg, C.sectionFg, 11));
    req.push({ updateDimensionProperties: {
      range: { sheetId, dimension:'ROWS', startIndex:r, endIndex:r+1 },
      properties: { pixelSize: 30 }, fields:'pixelSize'
    }});
  }

  // Column header rows
  for (const r of headerRows) {
    req.push(bgFgBold(r0(r,0,1,3), C.headerBg, C.headerFg, 10, true));
    req.push(border(r0(r,0,1,3)));
  }

  // Data rows — colour B column by status, borders on A:C
  for (const [start, end] of dataRowRanges) {
    for (let r=start; r<=end; r++) {
      const status = rows[r][1];
      const bg = statusColor(status);
      req.push(cell(r0(r,1), 'userEnteredFormat(backgroundColor)', { backgroundColor: bg }));
      req.push(cell(r0(r,0), 'userEnteredFormat(textFormat)', { textFormat: { bold:true, fontSize:10 } }));
      req.push(border(r0(r,0,1,3)));
      req.push({ updateDimensionProperties: {
        range: { sheetId, dimension:'ROWS', startIndex:r, endIndex:r+1 },
        properties: { pixelSize: 90 }, fields:'pixelSize'
      }});
    }
  }

  // Overview text — merge + wrap + grey bg
  req.push(merge(4));
  req.push(cell(r0(4,0), 'userEnteredFormat(backgroundColor,wrapStrategy)',
    { backgroundColor: rgb(242,242,242), wrapStrategy:'WRAP' }));

  await sheets.spreadsheets.batchUpdate({ spreadsheetId: ssId, requestBody: { requests: req } });
  console.log('Formatted');

  // 5. Share with Jascinta
  await drive.permissions.create({
    fileId: ssId,
    requestBody: { type:'user', role:'writer', emailAddress:'jascinta.pilos@thebrandingpeople.co' },
    sendNotificationEmail: false,
  });
  console.log('Shared');

  // 6. Update OKR Q1!I44 link
  const url = 'https://docs.google.com/spreadsheets/d/' + ssId + '/edit';
  await sheets.spreadsheets.values.update({
    spreadsheetId: OKR_ID,
    range: 'Q1_2026!I44',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['=HYPERLINK("' + url + '","Automation Roadmap")']] },
  });
  console.log('OKR linked');
  console.log('URL:', url);
}

run().catch(e => { console.error(e.message); process.exit(1); });
