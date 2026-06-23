#!/usr/bin/env node
// write-okr.mjs — Populates Q1 / Q2 / Q3 2026 OKR tabs
// Run from project root: node bin/write-okr.mjs
//
// Target spreadsheet: https://docs.google.com/spreadsheets/d/175Qj_q9I-nG2E3zbfDW5_zcML9N6DwdebE0iIreZp2c
// Cols: A=blank  B=Category  C=Objective  D=Key Result  E=KPI Metric
//       F=Target  G=Level  H=Score  I=Measurement Tool
// Row 1: blank (title/decoration row if any)
// Row 2: header  (black bg, white bold)
// Row 3+: data   (5 rows per KR, one per level 1–5)

import { getGoogleAuth, loadGoogleapis } from '../src/google-auth.js';

const OKR_SPREADSHEET_ID = '175Qj_q9I-nG2E3zbfDW5_zcML9N6DwdebE0iIreZp2c';

// ────────────────────────────────────────────────────────────────
// OKR DATA
// ────────────────────────────────────────────────────────────────

const Q1_DATA = [
  {
    category: 'Operations Leadership (30%)',
    objective: 'Promo Operations Leadership & Team QC Oversight',
    krs: [
      {
        kr: '[15%] Delegate P### tasks to team with ≥90% on-time delivery each month',
        kpi: '% P### tasks delegated on time',
        target: '≥90% per month',
        tool: 'Promo Tracker Sheet',
      },
      {
        kr: '[5%] Monitor QC completion — all active promos reviewed and cleared before go-live each cycle',
        kpi: '% promos QC\'d before activation',
        target: '100% per cycle',
        tool: 'QC Tracker / Promo Sheet',
      },
      {
        kr: '[5%] Team promo setup accuracy maintained at ≥92% (≤8% error rate)',
        kpi: 'Error rate per total promos setup',
        target: '≤8% errors / month',
        tool: 'Correction Log / QC Tracker',
      },
      {
        kr: '[5%] Status updates communicated to relevant parties ≥95% on time',
        kpi: '% on-time status updates sent',
        target: '≥95% per month',
        tool: 'Slack / Promo Tracker',
      },
    ],
  },
  {
    category: 'Team Systems (25%)',
    objective: 'Team Operations Systems & Accuracy',
    krs: [
      {
        kr: '[10%] QC checklist tracker set up and consistently used by team every promo cycle',
        kpi: 'QC Tracker adoption rate',
        target: '100% of cycles',
        tool: 'QC Tracker Sheet',
      },
      {
        kr: '[10%] Correction log maintained and reviewed monthly with all errors captured',
        kpi: '% errors logged vs errors found',
        target: '100% errors logged',
        tool: 'Correction Log Sheet',
      },
      {
        kr: '[5%] Training tracker maintained with attendance records for every session',
        kpi: '% sessions logged in tracker',
        target: '100% sessions logged',
        tool: 'Training Tracker Sheet',
      },
    ],
  },
  {
    category: 'SOP & Documentation (30%)',
    objective: 'Process Documentation & SOP',
    krs: [
      {
        kr: '[15%] SOPs for top 3 promo workflows completed and shared with team by end of Q1',
        kpi: '# SOPs completed',
        target: '≥3 SOPs published',
        tool: 'Google Drive / Notion',
      },
      {
        kr: '[10%] Workflow diagrams created for ≥2 key operational processes',
        kpi: '# workflow diagrams created',
        target: '≥2 diagrams',
        tool: 'Miro / Drive',
      },
      {
        kr: '[5%] Inbox T&C content reviewed and updated for all active brands',
        kpi: '% brands with updated T&C inbox content',
        target: '100% brands updated',
        tool: 'BO / Promo Tracker',
      },
    ],
  },
  {
    category: 'Automation (15%)',
    objective: 'AI / Automation Exploration & Initiative',
    krs: [
      {
        kr: '[10%] Test and deliver ≥1 automation PoC for promo code setup workflow',
        kpi: 'PoC delivered and demonstrated',
        target: '≥1 PoC tested & documented',
        tool: 'GitHub / Scripts',
      },
      {
        kr: '[5%] Document PoC findings and propose next automation steps to manager',
        kpi: 'Proposal document created',
        target: '1 proposal doc shared',
        tool: 'Google Docs / Drive',
      },
    ],
  },
];

const Q2_DATA = [
  {
    category: 'Promo Operations (30%)',
    objective: 'Promo Code Operations & QC Leadership',
    krs: [
      {
        kr: '[15%] Delegate P### tasks to team with ≥90% on-time delivery each month',
        kpi: '% P### tasks delegated on time',
        target: '≥90% per month',
        tool: 'Promo Tracker Sheet',
      },
      {
        kr: '[5%] QC completion — all promos reviewed and cleared before go-live every cycle',
        kpi: '% promos QC\'d before activation',
        target: '100% per cycle',
        tool: 'QC Tracker',
      },
      {
        kr: '[5%] Corrections logged and resolved ≤8 per month',
        kpi: '# corrections per month',
        target: '≤8 / month',
        tool: 'Correction Log',
      },
      {
        kr: '[5%] Status updates communicated to relevant parties ≥95% on time',
        kpi: '% on-time status updates',
        target: '≥95% per month',
        tool: 'Slack / Promo Tracker',
      },
    ],
  },
  {
    category: 'Automation (20%)',
    objective: 'AI Automation Build & Deployment',
    krs: [
      {
        kr: '[10%] Launch promo bot on QPRO & QP2 live — processing ≥80% of P### requests',
        kpi: '% P### processed by bot',
        target: '≥80% bot-processed',
        tool: 'GitHub / QPRO BO / Scripts',
      },
      {
        kr: '[10%] Build and ship 1 additional automation workflow (e.g. Slack Promo Watcher)',
        kpi: 'New workflow delivered',
        target: '1 workflow shipped',
        tool: 'GitHub / Slack API',
      },
    ],
  },
  {
    category: 'Team Development (25%)',
    objective: 'Team Onboarding & Capability Development',
    krs: [
      {
        kr: '[15%] Onboard Bangun & Gaby — both independently handling tasks within 4 weeks of start',
        kpi: 'Onboarding completion rate',
        target: 'Both fully onboarded by wk 4',
        tool: 'Training Tracker / Slack',
      },
      {
        kr: '[5%] Run ≥2 structured training sessions for team members in Q2',
        kpi: '# structured training sessions held',
        target: '≥2 sessions',
        tool: 'Training Tracker',
      },
      {
        kr: '[5%] All tool access provisioned for new team members within 1 week of start date',
        kpi: '% access requests completed on time',
        target: '100% within 1 week',
        tool: 'IT Request Log / Slack',
      },
    ],
  },
  {
    category: 'Cross-Team Coordination (25%)',
    objective: 'Cross-Team Training, QC Planning & Internal Coordination',
    krs: [
      {
        kr: '[10%] Run ≥2 cross-team training sessions with Sales team on promo processes',
        kpi: '# cross-team training sessions held',
        target: '≥2 sessions in Q2',
        tool: 'Training Tracker / Slack',
      },
      {
        kr: '[10%] QC planning framework documented and shared with relevant parties',
        kpi: 'Framework document created and shared',
        target: '1 QC planning framework doc',
        tool: 'Google Docs / Drive',
      },
      {
        kr: '[5%] Platform update comms shared with relevant teams within SLA ≥95% of the time',
        kpi: '% platform updates communicated on time',
        target: '≥95% within SLA',
        tool: 'Slack / Promo Tracker',
      },
    ],
  },
];

const Q3_DATA = [
  {
    category: 'Promo Operations (25%)',
    objective: 'Promo Code Operations & Scaled Oversight',
    krs: [
      {
        kr: '[15%] Delegate P### tasks with ≥90% on-time delivery as team and volume scale',
        kpi: '% P### delegated on time',
        target: '≥90% per month',
        tool: 'Promo Tracker Sheet',
      },
      {
        kr: '[5%] QC completion — all promos reviewed and cleared before go-live every cycle',
        kpi: '% promos QC\'d before activation',
        target: '100% per cycle',
        tool: 'QC Tracker',
      },
      {
        kr: '[5%] Corrections maintained at ≤8 per month across all brands',
        kpi: '# corrections per month',
        target: '≤8 / month',
        tool: 'Correction Log',
      },
    ],
  },
  {
    category: 'Automation Scale-Up (30%)',
    objective: 'Automation Scale-Up & Full Pipeline',
    krs: [
      {
        kr: '[15%] Extend bot coverage to WS1 / WS2 handling ≥50% of platform P### requests',
        kpi: '% WS1/WS2 P### handled by bot',
        target: '≥50% bot-processed',
        tool: 'GitHub / Scripts',
      },
      {
        kr: '[10%] Deploy 1 additional automation pipeline (e.g. banner upload pipeline)',
        kpi: 'New automation pipeline live',
        target: '1 new pipeline deployed',
        tool: 'GitHub / Upload Scripts',
      },
      {
        kr: '[5%] Publish internal pipeline guide for team use and onboarding',
        kpi: 'Pipeline guide published and shared',
        target: '1 guide doc shared with team',
        tool: 'Google Docs / Drive',
      },
    ],
  },
  {
    category: 'Team Performance (25%)',
    objective: 'Team Performance & Succession Planning',
    krs: [
      {
        kr: '[10%] Biannual performance appraisal completed on time for all team members',
        kpi: '% appraisals completed on time',
        target: '100% on time',
        tool: 'HR System / Drive',
      },
      {
        kr: '[10%] Bangun & Gaby demonstrate ≥80% task independence from Q2 onboarding',
        kpi: '% tasks completed independently',
        target: '≥80% independence',
        tool: 'Promo Tracker / QC Log',
      },
      {
        kr: '[5%] Weekly team reports submitted 100% on time every week',
        kpi: '% weekly reports on time',
        target: '100% on time',
        tool: 'Slack / Sheets',
      },
    ],
  },
  {
    category: 'Team Coordination (20%)',
    objective: 'Team Coordination & Operational Governance',
    krs: [
      {
        kr: '[5%] Structured team meetings held weekly with documented action items',
        kpi: '# meetings with action items recorded',
        target: '≥4 meetings / month',
        tool: 'Meeting Notes / Drive',
      },
      {
        kr: '[10%] Cross-team training with Sales — ≥2 sessions held in Q3',
        kpi: '# cross-team sessions held',
        target: '≥2 sessions in Q3',
        tool: 'Training Tracker / Slack',
      },
      {
        kr: '[5%] Operational updates communicated within SLA ≥95% of the time',
        kpi: '% on-time operational comms',
        target: '≥95% within SLA',
        tool: 'Slack / Promo Tracker',
      },
    ],
  },
];

// ────────────────────────────────────────────────────────────────
// ROW GENERATION
// ────────────────────────────────────────────────────────────────

const HEADER_ROW = [
  '',              // A
  'Category',      // B
  'Objective',     // C
  'Key Result',    // D
  'KPI Metric',    // E
  'Target',        // F
  'Level',         // G
  'Score',         // H
  'Measurement Tool', // I
];

/**
 * Builds the flat rows array for a quarter.
 * Category + Objective appear only in the first level-1 row of each objective.
 * KR / KPI / Target / Tool appear only in the level-1 row of each KR block.
 * Level cycles 1–5 for each KR.
 */
function generateRows(objectives) {
  const rows = [];
  for (const obj of objectives) {
    let isFirstKR = true;
    for (const kr of obj.krs) {
      for (let level = 1; level <= 5; level++) {
        rows.push([
          '',                                             // A - always blank
          isFirstKR && level === 1 ? obj.category : '',  // B - Category
          isFirstKR && level === 1 ? obj.objective : '', // C - Objective
          level === 1 ? kr.kr : '',                      // D - Key Result
          level === 1 ? kr.kpi : '',                     // E - KPI Metric
          level === 1 ? kr.target : '',                  // F - Target
          level,                                          // G - Level (1-5)
          '',                                             // H - Score (blank for manual fill)
          level === 1 ? kr.tool : '',                    // I - Measurement Tool
        ]);
      }
      isFirstKR = false;
    }
  }
  return rows;
}

// ────────────────────────────────────────────────────────────────
// FORMATTING
// ────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  return {
    red:   parseInt(hex.slice(1, 3), 16) / 255,
    green: parseInt(hex.slice(3, 5), 16) / 255,
    blue:  parseInt(hex.slice(5, 7), 16) / 255,
  };
}

// One pastel colour per objective (cycles for safety)
const OBJ_COLORS = ['#cfe2ff', '#d1e7dd', '#fff3cd', '#ffddd5'];

function buildFormatRequests(sheetId, objectives) {
  const requests = [];

  // ── Header row (row index 1 = spreadsheet row 2) ──────────────────────────
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1,
        endRowIndex: 2,
        startColumnIndex: 0,
        endColumnIndex: 9,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0, green: 0, blue: 0 },
          textFormat: {
            foregroundColor: { red: 1, green: 1, blue: 1 },
            bold: true,
            fontSize: 10,
            fontFamily: 'Arial',
          },
          wrapStrategy: 'WRAP',
          verticalAlignment: 'MIDDLE',
          horizontalAlignment: 'CENTER',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,wrapStrategy,verticalAlignment,horizontalAlignment)',
    },
  });

  // ── Objective colour bands (starting from row index 2 = row 3) ────────────
  let rowIdx = 2; // row index 2 = spreadsheet row 3
  objectives.forEach((obj, i) => {
    const totalRows = obj.krs.length * 5;
    const color = hexToRgb(OBJ_COLORS[i % OBJ_COLORS.length]);

    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: rowIdx,
          endRowIndex: rowIdx + totalRows,
          startColumnIndex: 0,
          endColumnIndex: 9,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: color,
            textFormat: { fontSize: 10, fontFamily: 'Arial' },
            wrapStrategy: 'WRAP',
            verticalAlignment: 'TOP',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,wrapStrategy,verticalAlignment)',
      },
    });

    // Bold the Category + Objective cell (first row of each objective band, cols B+C)
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: rowIdx,
          endRowIndex: rowIdx + 1,
          startColumnIndex: 1,
          endColumnIndex: 3,
        },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true, fontSize: 10, fontFamily: 'Arial' },
          },
        },
        fields: 'userEnteredFormat.textFormat',
      },
    });

    rowIdx += totalRows;
  });

  // ── Column widths (pixels) ─────────────────────────────────────────────────
  const colWidths = [
    20,   // A  blank
    165,  // B  Category
    240,  // C  Objective
    340,  // D  Key Result
    200,  // E  KPI Metric
    170,  // F  Target
    55,   // G  Level
    55,   // H  Score
    170,  // I  Measurement Tool
  ];
  colWidths.forEach((px, col) => {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: col,
          endIndex: col + 1,
        },
        properties: { pixelSize: px },
        fields: 'pixelSize',
      },
    });
  });

  // ── Freeze first 2 rows (row 1 blank + row 2 header) ──────────────────────
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: { frozenRowCount: 2 },
      },
      fields: 'gridProperties.frozenRowCount',
    },
  });

  return requests;
}

// ────────────────────────────────────────────────────────────────
// MAIN
// ────────────────────────────────────────────────────────────────

const QUARTERS = [
  { tab: 'Q1_2026', label: 'Q1 2026 (Jan–Mar)', data: Q1_DATA },
  { tab: 'Q2_2026', label: 'Q2 2026 (Apr–Jun)', data: Q2_DATA },
  { tab: 'Q3_2026', label: 'Q3 2026 (Jul–Sep)', data: Q3_DATA },
];

async function main() {
  console.log('══════════════════════════════════════════════');
  console.log('  OKR Sheet Writer — Jascinta 2026');
  console.log('══════════════════════════════════════════════');

  const { client, email, mode } = await getGoogleAuth();
  console.log(`✓ Auth OK  [${mode}]  ${email || '(OAuth user)'}`);

  const { google } = await loadGoogleapis();
  const sheets = google.sheets({ version: 'v4', auth: client });

  // ── Discover all tab IDs ───────────────────────────────────────────────────
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: OKR_SPREADSHEET_ID,
    fields: 'sheets.properties(sheetId,title)',
  });
  const tabMap = {};
  for (const s of meta.data.sheets) {
    tabMap[s.properties.title] = s.properties.sheetId;
  }
  console.log(`✓ Tabs: ${Object.keys(tabMap).join(', ')}\n`);

  // ── Write each quarter ─────────────────────────────────────────────────────
  for (const { tab, label, data } of QUARTERS) {
    const sheetId = tabMap[tab];
    if (sheetId === undefined) {
      console.warn(`  ⚠ Tab "${tab}" not found — skipping`);
      continue;
    }
    console.log(`── ${label} (tab="${tab}", sheetId=${sheetId}) ──`);

    const dataRows = generateRows(data);
    const totalKRs  = data.reduce((n, o) => n + o.krs.length, 0);
    const totalObjs = data.length;

    // 1. Clear old content (rows 2–200, keep row 1 untouched)
    await sheets.spreadsheets.values.clear({
      spreadsheetId: OKR_SPREADSHEET_ID,
      range: `${tab}!A2:Z200`,
    });
    console.log(`  ✓ Cleared ${tab}!A2:Z200`);

    // 2. Write header (row 2) then data (row 3+)
    const allRows = [HEADER_ROW, ...dataRows];
    await sheets.spreadsheets.values.update({
      spreadsheetId: OKR_SPREADSHEET_ID,
      range: `${tab}!A2`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: allRows },
    });
    console.log(`  ✓ Values: ${totalObjs} objectives, ${totalKRs} KRs, ${dataRows.length} data rows`);

    // 3. Apply formatting
    const fmtRequests = buildFormatRequests(sheetId, data);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: OKR_SPREADSHEET_ID,
      requestBody: { requests: fmtRequests },
    });
    console.log(`  ✓ Formatting: ${fmtRequests.length} requests applied\n`);
  }

  console.log('══════════════════════════════════════════════');
  console.log('  ✓ Done!');
  console.log(`  https://docs.google.com/spreadsheets/d/${OKR_SPREADSHEET_ID}`);
  console.log('══════════════════════════════════════════════');
}

main().catch(err => {
  console.error('✗ Fatal:', err.message || err);
  if (err.errors) console.error(JSON.stringify(err.errors, null, 2));
  process.exit(1);
});
