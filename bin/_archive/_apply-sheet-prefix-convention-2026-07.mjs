// Phase 1 + Phase 2 (as amended) — promo request sheet prefix convention.
// Run: node apply-sheet-convention.mjs [--commit]
import { getSheetsClient, getSpreadsheetId, listTabs, a1Range } from 'file:///C:/Users/vdiuser/Downloads/promo-automation/promo-automation/src/sheets-client.js';

const COMMIT = process.argv.includes('--commit');
const JULY = 'July 2026';
const REF = 'Ref - Codes';
const FIRST_NEW_ROW = 18;      // July data ends at row 17 (P016)
const LAST_ROW = 2077;         // July grid rowCount
const FORMULA_LAST_ROW = 1000;

const OWNERS = [['CRM', 'CRM'], ['VM', 'VM'], ['TSM', 'TSM'], ['AM', 'AM'], ['AFF', 'AFF']];
const OBJECTIVES = [
  ['ACQ - Welcome', 'WELC'],
  ['Retention', 'REL'],
  ['Churn - Reactivation', 'RET'],
  ['Ad Hoc', 'ADHOC'],
  ['Grooming', 'GROOM'],
];
const STAKEHOLDERS = ['KN', 'CD', 'YH', 'JT'];

const W1_TEXT = `Promo Code


Code format:
FT_OWNER_OBJECTIVE_[NODEP]_MECHANIC/DATE
FT = Fast Track (auto, WS1 only)

Owner: CRM / VM / TSM / AM / AFF
Objective codes:
WELC = ACQ / Welcome
REL = Retention (active players)
RET = Churn / Reactivation
ADHOC = Ad Hoc campaigns
GROOM = Grooming / VIP progression
NODEP = No deposit requirement (modifier)

Stakeholder tags (KN/CD/YH/JT) go in the Stakeholder column, NOT in the code.

*For Promo team use only`;

const main = async () => {
  const client = await getSheetsClient();
  const { sheets } = client;
  const sid = getSpreadsheetId();
  const tabs = await listTabs(client);
  const july = tabs.find((t) => t.name === JULY);
  if (!july) throw new Error('July 2026 tab not found');
  const guideline = tabs.find((t) => t.name === 'Guideline');
  let refTab = tabs.find((t) => t.name === REF);

  console.log(COMMIT ? '── COMMIT MODE ──' : '── DRY RUN (pass --commit to apply) ──');

  // ── 1. Create Ref - Codes tab ──
  if (!refTab) {
    console.log(`[1] addSheet "${REF}" (hidden)`);
    if (COMMIT) {
      const res = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sid,
        requestBody: { requests: [{ addSheet: { properties: { title: REF, gridProperties: { rowCount: 50, columnCount: 12 }, hidden: true } } }] },
      });
      refTab = { name: REF, sheetId: res.data.replies[0].addSheet.properties.sheetId };
    }
  } else {
    console.log(`[1] "${REF}" already exists (sheetId=${refTab.sheetId}) — reusing`);
  }

  // ── 2. Fill Ref - Codes lists ──
  console.log('[2] write Ref - Codes lists (owners, objectives, stakeholders, nodep)');
  if (COMMIT) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sid,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: a1Range(REF, 'A1:B6'), values: [['Owner Label', 'Owner Code'], ...OWNERS] },
          { range: a1Range(REF, 'D1:E6'), values: [['Objective Label', 'Objective Code'], ...OBJECTIVES] },
          { range: a1Range(REF, 'G1:G5'), values: [['Stakeholder'], ...STAKEHOLDERS.map((s) => [s])] },
          { range: a1Range(REF, 'I1:I3'), values: [['No Deposit'], ['Yes'], ['No']] },
        ],
      },
    });
  }

  // ── 3. Named ranges ──
  const existing = await sheets.spreadsheets.get({ spreadsheetId: sid, fields: 'namedRanges' });
  const haveNR = new Set((existing.data.namedRanges || []).map((n) => n.name));
  const refSheetId = refTab?.sheetId;
  const nrDefs = [
    ['OwnerList', 1, 6, 0, 1],        // A2:A6
    ['ObjectiveList', 1, 6, 3, 4],    // D2:D6
    ['StakeholderList', 1, 5, 6, 7],  // G2:G5
    ['NoDepList', 1, 3, 8, 9],        // I2:I3
  ];
  const nrRequests = nrDefs
    .filter(([name]) => !haveNR.has(name))
    .map(([name, r1, r2, c1, c2]) => ({
      addNamedRange: { namedRange: { name, range: { sheetId: refSheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 } } },
    }));
  console.log(`[3] named ranges to add: ${nrRequests.length ? nrRequests.map((r) => r.addNamedRange.namedRange.name).join(', ') : '(all exist)'}`);
  if (COMMIT && nrRequests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: sid, requestBody: { requests: nrRequests } });
  }

  // ── 4. Guideline glossary (rows 12-22, below the 9 sample rows) ──
  console.log('[4] write glossary matrix to Guideline rows 12-22');
  const glossary = [
    ['PROMO CODE PREFIX CONVENTION (effective 1 Aug 2026)'],
    ['Format: FT_OWNER_OBJECTIVE_[NODEP]_MECHANIC/DATE  —  FT is auto-added for WS1 only'],
    ['Objective \\ Owner', 'CRM', 'VM (VIP Mgr)', 'TSM (Tele Sales)', 'AM (Acct Mgr)', 'AFF (Affiliate)'],
    ['ACQ - Welcome (WELC)', 'CRM_WELC', 'VM_WELC', 'TSM_WELC', 'AM_WELC', 'AFF_WELC'],
    ['Retention - active (REL)', 'CRM_REL', 'VM_REL', 'TSM_REL', 'AM_REL', 'AFF_REL'],
    ['Churn / Reactivation (RET)', 'CRM_RET', 'VM_RET', 'TSM_RET', 'AM_RET', 'AFF_RET'],
    ['Ad Hoc (ADHOC)', 'CRM_ADHOC', 'VM_ADHOC', 'TSM_ADHOC', 'AM_ADHOC', 'AFF_ADHOC'],
    ['Grooming (GROOM)', 'CRM_GROOM', 'VM_GROOM', 'TSM_GROOM', 'AM_GROOM', 'AFF_GROOM'],
    ['+ NODEP after objective when no deposit required, e.g. TSM_WELC_NODEP'],
    ['+ mechanic/date last, e.g. FT_CRM_RET_2606, FT_VM_REL_25PCT'],
    ['Stakeholder tags: KN=Kien, CD=Cedric/Abigail, YH=YH, JT=Joe — tracked in the Stakeholder column, never inside the code'],
  ];
  if (COMMIT) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sid,
      range: a1Range('Guideline', 'A12'),
      valueInputOption: 'RAW',
      requestBody: { values: glossary },
    });
  }

  // ── 5. July: new headers Z/AA/AB + E header note + W legend ──
  console.log('[5] July headers: E1 note, W1 legend, Z1/AA1/AB1 new columns');
  if (COMMIT) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sid,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: a1Range(JULY, 'E1'), values: [['Requestor\n(Campaign Owner: CRM / VM / TSM / AM / AFF)']] },
          { range: a1Range(JULY, 'W1'), values: [[W1_TEXT]] },
          { range: a1Range(JULY, 'Z1:AB1'), values: [['Stakeholder\n(KN/CD/YH/JT)', 'No Deposit?\n(Yes/No)', 'Suggested Prefix\n(auto — Promo team appends mechanic)']] },
        ],
      },
    });
  }

  // ── 6. Data validation on new rows only (18+) ──
  const oneOfRange = (rangeA1) => ({
    condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: '=' + rangeA1 }] },
    showCustomUi: true,
    strict: true,
  });
  const gridRange = (colIdx) => ({
    sheetId: july.sheetId,
    startRowIndex: FIRST_NEW_ROW - 1,
    endRowIndex: LAST_ROW,
    startColumnIndex: colIdx,
    endColumnIndex: colIdx + 1,
  });
  const valDefs = [
    ['E (Owner)', 4, `'${REF}'!$A$2:$A$6`],
    ['K (Objective)', 10, `'${REF}'!$D$2:$D$6`],
    ['Z (Stakeholder)', 25, `'${REF}'!$G$2:$G$5`],
    ['AA (No Deposit)', 26, `'${REF}'!$I$2:$I$3`],
  ];
  console.log(`[6] dropdown validation rows ${FIRST_NEW_ROW}-${LAST_ROW}: ${valDefs.map((v) => v[0]).join(', ')}`);
  if (COMMIT) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sid,
      requestBody: {
        requests: valDefs.map(([, colIdx, src]) => ({
          setDataValidation: { range: gridRange(colIdx), rule: oneOfRange(src) },
        })),
      },
    });
  }

  // ── 7. Suggested Prefix formulas AB18:AB1000 ──
  console.log(`[7] Suggested Prefix formulas AB${FIRST_NEW_ROW}:AB${FORMULA_LAST_ROW}`);
  if (COMMIT) {
    const formulas = [];
    for (let r = FIRST_NEW_ROW; r <= FORMULA_LAST_ROW; r++) {
      formulas.push([
        `=IF(OR($E${r}="",$K${r}=""),"",IFERROR(VLOOKUP($E${r},'${REF}'!$A:$B,2,0)&"_"&VLOOKUP($K${r},'${REF}'!$D:$E,2,0)&IF($AA${r}="Yes","_NODEP",""),""))`,
      ]);
    }
    await sheets.spreadsheets.values.update({
      spreadsheetId: sid,
      range: a1Range(JULY, `AB${FIRST_NEW_ROW}:AB${FORMULA_LAST_ROW}`),
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: formulas },
    });
  }

  console.log(COMMIT ? '✓ All changes applied.' : '✓ Dry run complete — nothing written.');
};

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
