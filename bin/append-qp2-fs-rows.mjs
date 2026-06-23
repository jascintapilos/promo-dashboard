// Append 6 FS rows (P134–P139) for QP2 (all 4 merchants).
// Same mechanics as P122–P127 (QPRO2/3/4) but brand = QP2A/B/C/D.
//
// Usage:
//   node bin/append-qp2-fs-rows.mjs          # dry run
//   node bin/append-qp2-fs-rows.mjs --commit # live append
import { getSheetsClient, getSpreadsheetId, readHeader, detectColumnMapFromHeader } from '../src/sheets-client.js';

const DRY_RUN = !process.argv.includes('--commit');
if (DRY_RUN) console.log('[DRY RUN] Pass --commit to execute\n');

const TAB = 'June 2026';
const BRANDS = 'QP2A, QP2B, QP2C, QP2D';
const REGION = 'SG';
const REQUESTOR = 'CEE SG';
const DATE = '22 Jun 2026';
const CAMPAIGN_WELCOME = 'Welcome';
const CAMPAIGN_RELOAD  = 'Reload';
const CAMPAIGN_RET     = 'Retention';
const BONUS_TYPE_WELC = 'Free Spin - Welcome';
const BONUS_TYPE_REL  = 'Free Spin - Reload';
const BONUS_TYPE_RET  = 'Free Spin - Retention';
const VALIDITY     = 7;
const RWD_VALIDITY = 30;
const INBOX = 'Yes';
const POPUP = 'Yes';
const PRIORITY = 'Normal';
const DEADLINE = '22 Jun 2026 12:00 AM';
const BANNER = 'No';

const ROWS = [
  {
    rn: 'P134', campaign: CAMPAIGN_WELCOME, bonus_type: BONUS_TYPE_WELC,
    code: 'WELC_BASE_80FS_GOOSS_20X',
    remark: 'Info Ready\nGame: GOOSS\nSpin value: SGD0.50\nMin dep: SGD100\nTO: 20x',
    name_details: '80 FS GOOSS Welcome Base',
    en: '80 Free Spins - Gates of Olympus Super Scatter',
    zh: '80转免费旋转 - Gates of Olympus Super Scatter',
  },
  {
    rn: 'P135', campaign: CAMPAIGN_WELCOME, bonus_type: BONUS_TYPE_WELC,
    code: 'WELC_BOOSTER_100FS_GOOSS_25X',
    remark: 'Info Ready\nGame: GOOSS\nSpin value: SGD0.50\nMin dep: SGD150\nTO: 25x',
    name_details: '100 FS GOOSS Welcome Booster',
    en: '100 Free Spins - Gates of Olympus Super Scatter',
    zh: '100转免费旋转 - Gates of Olympus Super Scatter',
  },
  {
    rn: 'P136', campaign: CAMPAIGN_RELOAD, bonus_type: BONUS_TYPE_REL,
    code: 'REL_BASE_60FS_GOOSS_12X_V2',
    remark: 'Info Ready\nGame: GOOSS\nSpin value: SGD0.50\nMin dep: SGD100\nTO: 12x',
    name_details: '60 FS GOOSS Reload Base',
    en: '60 Free Spins - Gates of Olympus Super Scatter',
    zh: '60转免费旋转 - Gates of Olympus Super Scatter',
  },
  {
    rn: 'P137', campaign: CAMPAIGN_RELOAD, bonus_type: BONUS_TYPE_REL,
    code: 'REL_BOOSTER_80FS_GOOSS_15X',
    remark: 'Info Ready\nGame: GOOSS\nSpin value: SGD0.50\nMin dep: SGD150\nTO: 15x',
    name_details: '80 FS GOOSS Reload Booster',
    en: '80 Free Spins - Gates of Olympus Super Scatter',
    zh: '80转免费旋转 - Gates of Olympus Super Scatter',
  },
  {
    rn: 'P138', campaign: CAMPAIGN_RET, bonus_type: BONUS_TYPE_RET,
    code: 'RET_GOOSS_BASE_50FS_10X',
    remark: 'Info Ready\nGame: GOOSS\nSpin value: SGD0.50\nMin dep: SGD80\nTO: 10x',
    name_details: '50 FS GOOSS Retention Base',
    en: '50 Free Spins - Gates of Olympus Super Scatter',
    zh: '50转免费旋转 - Gates of Olympus Super Scatter',
  },
  {
    rn: 'P139', campaign: CAMPAIGN_RET, bonus_type: BONUS_TYPE_RET,
    code: 'RET_GOOSS_BOOST_60FS_12X',
    remark: 'Info Ready\nGame: GOOSS\nSpin value: SGD0.50\nMin dep: SGD100\nTO: 12x',
    name_details: '60 FS GOOSS Retention Boost',
    en: '60 Free Spins - Gates of Olympus Super Scatter',
    zh: '60转免费旋转 - Gates of Olympus Super Scatter',
  },
];

const client = await getSheetsClient();
const header = await readHeader(client, TAB);
const colMap = detectColumnMapFromHeader(header);
const NUM_COLS = header.length;

function buildRow(r) {
  const cells = new Array(NUM_COLS).fill('');
  const set = (field, val) => { const idx = colMap[field]; if (idx != null) cells[idx] = val ?? ''; };
  set('status',             'Info Ready');
  set('remark',             r.remark);
  set('banner_needed',      BANNER);
  set('request_number',     r.rn);
  set('requestor',          REQUESTOR);
  set('date',               DATE);
  set('priority',           PRIORITY);
  set('deadline',           DEADLINE);
  set('brand',              BRANDS);
  set('region',             REGION);
  set('campaign',           r.campaign);
  set('bonus_type',         r.bonus_type);
  set('name_details',       r.name_details);
  set('inbox_message',      INBOX);
  set('popup_dialog',       POPUP);
  set('validity',           VALIDITY);
  set('rewards_validity',   RWD_VALIDITY);
  set('promo_code',         r.code);
  set('promotion_name_en',  r.en);
  set('promotion_name_zh_id', r.zh);
  return cells;
}

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
