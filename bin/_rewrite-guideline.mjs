#!/usr/bin/env node
// Rewrite the Guideline tab to mirror the May 2026 (current-month) 25-col
// schema. Migrates the existing P001-P003 rows into the new layout and
// appends 5 new examples (P004-P008) — one per bonus type.
//
//   --apply   actually write to the sheet. Default is dry-run (prints rows).
//
import {
  getSheetsClient,
  getSpreadsheetId,
  a1Range,
} from '../src/sheets-client.js';

const APPLY = process.argv.includes('--apply');

// 25-col header mirrored exactly from May 2026!A1:Y1.
const HEADER = [
  'Status',
  'Remark\n\n(Type "Info Ready" \n\nAttach file/Specify Game Categories, if any)',
  'Banner Needed\n\n(Yes/No)\n\n(If yes, please make a copy of Banner Request Details Template and attach the file here)',
  'Request Number (RN)',
  'Requestor',
  'Date',
  'Priority',
  'Deadline ',
  'Brand\n\n(Include ALL Brands in one row if the request is to create the same code)',
  'Region\n\n\n(Include ALL Regions in one row if the request is to create the same code)',
  'Campaign Name/Objective',
  'Bonus Type ',
  'Name/Details (Internal reference)\n\nPlease use the same format from the Guideline tab',
  'Inbox Message ',
  'Pop Up Dialog',
  'Validity',
  'Rewards Validity',
  'Expiry In Minutes (WS1 only)',
  'Recurring/One Time',
  'Max per Player (Lifetime)\n\nDaily Max',
  'Change Type (if any)\n\nNote: Only fill in if code is already created',
  'Details to Change (if any)\n\nNote: Only fill in if code is already created',
  'Promo Code\n\n\nCode format:\nFT = Fast Track (for WS1 only)\nREL = Active Segment\nRET = Churn Segment\nWELC = Welcome Bonuses\nNODEP = No deposit requirement\n\n\nVM/TSM = VIP manager (usually REL/RET)\nTele Sales (WELC)\nAFF = affiliate\n\n*For Promo team use only',
  'Promotion Names (EN)\n\n*For Promo team use only',
  'Promotion Names (ZH/ID)\n\n*For Promo team use only',
];

// Row builder — keep order aligned with HEADER above.
function row({
  status = '', remark = '', banner = '',
  rn, requestor = '', date = '', priority = '', deadline = '',
  brand = '', region = '', campaign = '', bonus_type = '',
  name_details = '', inbox = '', popup = '',
  validity = '', rewards_validity = '', expiry_ws1 = '-',
  recurring = '', max_daily = '',
  change_type = '', change_details = '',
  promo_code = '', name_en = '', name_zh = '',
}) {
  return [
    status, remark, banner,
    rn, requestor, date, priority, deadline,
    brand, region, campaign, bonus_type,
    name_details, inbox, popup,
    validity, rewards_validity, expiry_ws1,
    recurring, max_daily,
    change_type, change_details,
    promo_code, name_en, name_zh,
  ];
}

// Existing P001-P003 migrated into new 25-col layout.
const MIGRATED = [
  row({
    rn: 'P001',
    date: '7 Jan 2026', priority: 'Urgent', deadline: '7 Jan 2026',
    brand: 'QPRO18', region: 'AUD', campaign: 'Acquisition',
    bonus_type: 'Free Spin - Welcome',
    name_details: 'Welcome Bonus 299 Free Spins - Fortune of Olympus, min dep XX, TO, 0.20 per spin',
    inbox: 'TRUE', popup: 'TRUE',
    validity: '30', rewards_validity: '7',
    recurring: 'One Time',
  }),
  row({
    rn: 'P002',
    campaign: 'Double Date Campaign',
    bonus_type: 'Free Credit',
    name_details: 'Free Credit 50 - 8X TO, max transfer XX',
    inbox: 'TRUE', popup: 'FALSE',
    validity: '7', rewards_validity: '1',
    recurring: 'Recurring',
  }),
  row({
    rn: 'P003',
    campaign: 'Assurance Package Bonus',
    bonus_type: 'Deposit - Reload',
    name_details: 'Assurance Package Bonus (50%, Reload Bonus, min dep 100, max bns 400, TOxx)',
    inbox: 'TRUE', popup: 'TRUE',
    validity: '1', rewards_validity: '1',
    recurring: 'Recurring',
  }),
];

// Five fresh examples — one per bonus type.
const NEW_EXAMPLES = [
  row({
    remark: 'Info Ready', banner: 'No',
    rn: 'P004', requestor: 'Sample',
    date: '26 May 2026', priority: 'Normal', deadline: '30 May 2026',
    brand: 'QPRO1', region: 'MY', campaign: 'Acquisition',
    bonus_type: 'Deposit - Welcome',
    name_details: 'Welcome Bonus 100%, max bonus 500, min depo 50, TOx12',
    inbox: 'TRUE', popup: 'TRUE',
    validity: '30', rewards_validity: '7',
    recurring: 'One Time', max_daily: '1',
    promo_code: 'WELC_100PCT_500MX',
    name_en: 'Welcome Bonus - 100% First Deposit Bonus',
    name_zh: '欢迎奖金 - 100% 首存奖金',
  }),
  row({
    remark: 'Info Ready', banner: 'No',
    rn: 'P005', requestor: 'Sample',
    date: '26 May 2026', priority: 'Normal', deadline: '30 May 2026',
    brand: 'QPRO1', region: 'MY', campaign: 'Daily Reload',
    bonus_type: 'Deposit - Reload',
    name_details: 'Reload Bonus 50%, max bonus 200, min depo 100, TOx5',
    inbox: 'TRUE', popup: 'FALSE',
    validity: '1', rewards_validity: '1',
    recurring: 'Recurring', max_daily: '99999',
    promo_code: 'REL_ALL_50PCT_200MX',
    name_en: 'Daily Reload Bonus - 50% Reload Bonus',
    name_zh: '每日续存优惠 - 50% 续存奖金',
  }),
  row({
    remark: 'Info Ready', banner: 'No',
    rn: 'P006', requestor: 'Sample',
    date: '26 May 2026', priority: 'Normal', deadline: '30 May 2026',
    brand: 'QPRO1', region: 'MY', campaign: 'No Deposit Free Credit',
    bonus_type: 'Free Credit',
    name_details: 'Free Credit 50 - TOx8, max transfer 200',
    inbox: 'TRUE', popup: 'TRUE',
    validity: '7', rewards_validity: '1',
    recurring: 'One Time', max_daily: '1',
    promo_code: 'NODEP_FC50_8X',
    name_en: 'Free Credit Giveaway - 50 Free Credit',
    name_zh: '免费彩金赠送 - 50 免费彩金',
  }),
  row({
    remark: 'Info Ready', banner: 'Yes',
    rn: 'P007', requestor: 'Sample',
    date: '26 May 2026', priority: 'Normal', deadline: '30 May 2026',
    brand: 'QPRO1', region: 'MY', campaign: 'Acquisition',
    bonus_type: 'Free Spin - Welcome',
    name_details: 'Welcome Bonus 99 Free Spins - Fortune of Olympus, min dep 50, TO0x, 0.20 per spin',
    inbox: 'TRUE', popup: 'TRUE',
    validity: '30', rewards_validity: '7',
    recurring: 'One Time', max_daily: '1',
    promo_code: 'WELC_FS_99SPINS_FOO',
    name_en: 'Welcome Bonus - 99 Free Spins (Fortune of Olympus)',
    name_zh: '欢迎奖金 - 99 次免费旋转 (Fortune of Olympus)',
  }),
  row({
    remark: 'Info Ready', banner: 'No',
    rn: 'P008', requestor: 'Sample',
    date: '26 May 2026', priority: 'Normal', deadline: '30 May 2026',
    brand: 'QPRO1', region: 'MY', campaign: 'Survey Reward',
    bonus_type: 'Free Spin - Reload',
    name_details: 'Reload Bonus 25 Free Spins - Gates of Olympus, min dep 30, TO3x, 0.20 per spin',
    inbox: 'TRUE', popup: 'TRUE',
    validity: '7', rewards_validity: '30',
    recurring: 'Recurring', max_daily: '99999',
    promo_code: 'REL_FS_25SPINS_GOO_3X',
    name_en: 'Daily Free Spins - 25 Free Spins (Gates of Olympus)',
    name_zh: '每日免费旋转 - 25 次免费旋转 (Gates of Olympus)',
  }),
];

const ALL_ROWS = [HEADER, ...MIGRATED, ...NEW_EXAMPLES];

console.log(`Planned write: Guideline!A1:Y${ALL_ROWS.length} (${ALL_ROWS.length} rows × 25 cols)`);
console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
console.log('');
console.log('Preview (RN | Bonus Type | Name/Details → Promo Code):');
for (let i = 1; i < ALL_ROWS.length; i++) {
  const r = ALL_ROWS[i];
  console.log(`  ${r[3]} | ${r[11]} | ${(r[12] || '').slice(0, 70)} → ${r[22] || '(blank)'}`);
}

if (!APPLY) {
  console.log('');
  console.log('Dry run only — re-run with --apply to commit.');
  process.exit(0);
}

const client = await getSheetsClient();
const ssid = getSpreadsheetId();

const res = await client.sheets.spreadsheets.values.update({
  spreadsheetId: ssid,
  range: a1Range('Guideline', `A1:Y${ALL_ROWS.length}`),
  valueInputOption: 'USER_ENTERED',
  requestBody: { values: ALL_ROWS },
});

console.log('');
console.log('✓ Wrote', res.data.updatedCells, 'cells across', res.data.updatedRows, 'rows.');
console.log('  Range:', res.data.updatedRange);
