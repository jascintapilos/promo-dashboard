// Append 6 deposit promo rows (P128–P133) to the June 2026 sheet.
// Mechanics sourced from QPRO1 BO (probed 2026-06-22).
// Targets: QPRO2, QPRO3, QPRO4 SG.
//
// Usage:
//   node bin/append-deposit-rows.mjs          # dry run (prints rows only)
//   node bin/append-deposit-rows.mjs --commit # live append to sheet
import { getSheetsClient, getSpreadsheetId, readHeader, detectColumnMapFromHeader } from '../src/sheets-client.js';

const DRY_RUN = !process.argv.includes('--commit');
if (DRY_RUN) console.log('[DRY RUN] Pass --commit to execute\n');

const TAB = 'June 2026';
const BRANDS = 'QPRO2, QPRO3, QPRO4';
const REGION = 'SG';
const REQUESTOR = 'CEE SG';
const DATE = '22 Jun 2026';
const CAMPAIGN = 'CEE SG';
const BONUS_TYPE = 'Deposit - Reload';
const VALIDITY = 30;       // BO validity (bonus expiry days after claim) — matches QPRO1
const RWD_VALIDITY = 7;    // BO reward_validity (claim window days) — matches QPRO1
const INBOX = 'Yes';
const POPUP = 'Yes';
const PRIORITY = 'Normal';

// 6 deposit codes with probed mechanics
const ROWS = [
  {
    rn: 'P128',
    code: 'RET_LC_BASE_15PCT',
    name_details: '15% Reload, max bonus 150, min dep 50, 15x TO\nLive Casino only',
    en: '15% Reload Bonus- Live Casino',
    zh: '15% 充值奖励 - 真人娱乐场',
  },
  {
    rn: 'P129',
    code: 'RET_LC_BOOST_18PCT',
    name_details: '18% Reload, max bonus 150, min dep 50, 15x TO\nLive Casino only',
    en: '18% Reload Bonus- Live Casino',
    zh: '18% 充值奖励 - 真人娱乐场',
  },
  {
    rn: 'P130',
    code: 'RET_SPORTS_BASE_12PCT',
    name_details: '12% Reload, max bonus 150, min dep 50, 10x TO\nSports only',
    en: '12% Reload Bonus - Sports',
    zh: '12% 充值奖金 - 体育',
  },
  {
    rn: 'P131',
    code: 'RET_SPORTS_BOOST_15PCT',
    name_details: '15% Reload, max bonus 150, min dep 50, 10x TO\nSports only',
    en: '15% Reload Bonus - Sports',
    zh: '15% 充值红利 - 体育',
  },
  {
    rn: 'P132',
    code: 'REL_BASE_12PCT_5X',
    name_details: '12% Reload, max bonus 300, min dep 50, 5x TO\nSlots only',
    en: '12% Reload Bonus',
    zh: '12% 充值奖金',
  },
  {
    rn: 'P133',
    code: 'REL_BOOSTER_15PCT_5X',
    name_details: '15% Reload, max bonus 500, min dep 50, 5x TO\nSlots only',
    en: '15% Reload Bonus',
    zh: '15% 充值红利',
  },
];

const client = await getSheetsClient();
const header = await readHeader(client, TAB);
const colMap = detectColumnMapFromHeader(header);

// Build each row as an array aligned to columns A–Y (indices 0–24)
// colMap gives us 0-based indices for each field
const NUM_COLS = header.length; // e.g. 25

function buildRow(r) {
  const cells = new Array(NUM_COLS).fill('');
  const set = (field, val) => {
    const idx = colMap[field];
    if (idx != null) cells[idx] = val ?? '';
  };
  set('status',               'Info Ready');
  set('remark',               'Info Ready');
  set('banner_needed',        '');
  set('request_number',       r.rn);
  set('requestor',            REQUESTOR);
  set('date',                 DATE);
  set('priority',             PRIORITY);
  set('deadline',             '');
  set('brand',                BRANDS);
  set('region',               REGION);
  set('campaign',             CAMPAIGN);
  set('bonus_type',           BONUS_TYPE);
  set('name_details',         r.name_details);
  set('inbox_message',        INBOX);
  set('popup_dialog',         POPUP);
  set('validity',             VALIDITY);
  set('rewards_validity',     RWD_VALIDITY);
  set('expiry_minutes_ws1',   '');
  set('recurring',            '');
  set('max_per_player',       '');
  set('change_type',          '');
  set('change_details',       '');
  set('promo_code',           r.code);
  set('promotion_name_en',    r.en);
  set('promotion_name_zh_id', r.zh);
  return cells;
}

// Print preview
for (const r of ROWS) {
  const row = buildRow(r);
  console.log(`\n${r.rn}: ${r.code}`);
  for (let i = 0; i < row.length; i++) {
    if (row[i] !== '') console.log(`  [${String.fromCharCode(65+i)}] ${row[i]}`);
  }
}

if (DRY_RUN) {
  console.log('\n[DRY RUN] No changes made. Pass --commit to write to sheet.');
  process.exit(0);
}

// Append all 6 rows at once using the Sheets API append endpoint
const { sheets } = client;
const values = ROWS.map(buildRow);
const res = await sheets.spreadsheets.values.append({
  spreadsheetId: getSpreadsheetId(),
  range: `'${TAB}'!A:A`,
  valueInputOption: 'USER_ENTERED',
  insertDataOption: 'INSERT_ROWS',
  requestBody: { values },
});

const updates = res.data.updates;
console.log(`\n✓ Appended ${updates?.updatedRows ?? '?'} rows`);
console.log(`  Range written: ${updates?.updatedRange}`);
console.log(`  Cells updated: ${updates?.updatedCells}`);
