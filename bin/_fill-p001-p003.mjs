#!/usr/bin/env node
// Fill in missing fields on Guideline rows 2-4 (P001-P003) so they read as
// complete worked examples — same level of detail as P004-P008.
//
//   --apply   actually commit. Default is dry-run.
//
import {
  getSheetsClient,
  getSpreadsheetId,
  a1Range,
} from '../src/sheets-client.js';

const APPLY = process.argv.includes('--apply');

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

const ROWS = [
  // P001 — Free Spin - Welcome (QPRO18, AUD = English-only region, no ZH/ID name).
  row({
    remark: 'Info Ready', banner: 'Yes',
    rn: 'P001', requestor: 'Kevin',
    date: '7 Jan 2026', priority: 'Urgent', deadline: '7 Jan 2026',
    brand: 'QPRO18', region: 'AUD', campaign: 'Acquisition',
    bonus_type: 'Free Spin - Welcome',
    name_details: 'Welcome Bonus 299 Free Spins - Fortune of Olympus, min dep 30, TO0x, 0.20 per spin',
    inbox: 'TRUE', popup: 'TRUE',
    validity: '30', rewards_validity: '7',
    recurring: 'One Time', max_daily: '1',
    promo_code: 'WELC_FS_299SPINS_FOO',
    name_en: 'Welcome Bonus - 299 Free Spins (Fortune of Olympus)',
    name_zh: '',  // AUD region — English-only
  }),
  // P002 — Free Credit (Valentine's themed Double Date campaign).
  row({
    remark: 'Info Ready', banner: 'No',
    rn: 'P002', requestor: 'Kevin',
    date: '10 Feb 2026', priority: 'High', deadline: '14 Feb 2026',
    brand: 'QPRO1, QP2B', region: 'MY',
    campaign: 'Double Date Campaign',
    bonus_type: 'Free Credit',
    name_details: 'Free Credit 50 - 8X TO, max transfer 200',
    inbox: 'TRUE', popup: 'FALSE',
    validity: '7', rewards_validity: '1',
    recurring: 'Recurring', max_daily: '99999',
    promo_code: 'REL_FC50_8X',
    name_en: 'Double Date Free Credit - 50 Free Credit',
    name_zh: '情人节免费彩金 - 50 免费彩金',
  }),
  // P003 — Deposit - Reload (Assurance Package).
  row({
    remark: 'Info Ready', banner: 'No',
    rn: 'P003', requestor: 'Kevin',
    date: '10 Jan 2026', priority: 'High', deadline: '12 Jan 2026',
    brand: 'QPRO1, QP2B', region: 'MY',
    campaign: 'Assurance Package Bonus',
    bonus_type: 'Deposit - Reload',
    name_details: 'Assurance Package Bonus (50%, Reload Bonus, min dep 100, max bns 400, TOx8)',
    inbox: 'TRUE', popup: 'TRUE',
    validity: '1', rewards_validity: '1',
    recurring: 'Recurring', max_daily: '99999',
    promo_code: 'REL_ALL_50PCT_400MX',
    name_en: 'Assurance Package Bonus - 50% Reload Bonus',
    name_zh: '保障套餐奖金 - 50% 续存奖金',
  }),
];

console.log(`Planned write: Guideline!A2:Y4 (3 rows × 25 cols)`);
console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
console.log('');
console.log('Preview (RN | Brand/Region | Bonus Type → Promo Code):');
for (const r of ROWS) {
  console.log(`  ${r[3]} | ${r[8]}/${r[9]} | ${r[11]} → ${r[22]}`);
}

if (!APPLY) {
  console.log('\nDry run only — re-run with --apply to commit.');
  process.exit(0);
}

const client = await getSheetsClient();
const ssid = getSpreadsheetId();

const res = await client.sheets.spreadsheets.values.update({
  spreadsheetId: ssid,
  range: a1Range('Guideline', 'A2:Y4'),
  valueInputOption: 'USER_ENTERED',
  requestBody: { values: ROWS },
});

console.log('');
console.log('✓ Wrote', res.data.updatedCells, 'cells across', res.data.updatedRows, 'rows.');
console.log('  Range:', res.data.updatedRange);
