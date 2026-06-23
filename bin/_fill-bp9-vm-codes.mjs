#!/usr/bin/env node
// Batch-append all BP9MY VM_ / VIP_TRIAL_ codes to the June 2026 promo request sheet.
// Usage:
//   node bin/_fill-bp9-vm-codes.mjs            # dry-run (print only)
//   node bin/_fill-bp9-vm-codes.mjs --commit    # write to sheet
import { getGoogleAuth } from '../src/google-auth.js';

const SHEET_ID = '1dqvCM9SoPLJ2iYNCQRe450wBk3S7HSHtbayuAJguodM';
const TAB      = 'June 2026';
const COMMIT   = process.argv.includes('--commit');
const START_RN  = 19; // next after P018
const CODE_PREFIX = 'KN_';
const DEADLINE    = '16 Jun 2026';

// ── Source data from BP9MY_Promo_Code_Request_latest.csv ─────────────────────
// Columns: bonus_type | code | amount | deposit | to | validity | match | step | notes
const CSV = [
  // Free Credit 5X
  ['Free Credit','VM_FC_10_5X_7D',   10,  'n/a', 5,  7,  'n/a', '-', 'Re-engagement'],
  ['Free Credit','VM_FC_10_5X_14D',  10,  'n/a', 5, 14,  'n/a', '-', 'Re-engagement'],
  ['Free Credit','VM_FC_20_5X_7D',   20,  'n/a', 5,  7,  'n/a', '-', 'Re-engagement'],
  ['Free Credit','VM_FC_20_5X_14D',  20,  'n/a', 5, 14,  'n/a', '-', 'Re-engagement'],
  ['Free Credit','VM_FC_30_5X_7D',   30,  'n/a', 5,  7,  'n/a', '-', 'Re-engagement'],
  ['Free Credit','VM_FC_30_5X_14D',  30,  'n/a', 5, 14,  'n/a', '-', 'Re-engagement'],
  ['Free Credit','VM_FC_50_5X_7D',   50,  'n/a', 5,  7,  'n/a', '-', 'Re-engagement'],
  ['Free Credit','VM_FC_50_5X_14D',  50,  'n/a', 5, 14,  'n/a', '-', 'Re-engagement'],
  ['Free Credit','VM_FC_80_5X_7D',   80,  'n/a', 5,  7,  'n/a', '-', 'Re-engagement'],
  ['Free Credit','VM_FC_80_5X_14D',  80,  'n/a', 5, 14,  'n/a', '-', 'Re-engagement'],
  ['Free Credit','VM_FC_100_5X_7D', 100,  'n/a', 5,  7,  'n/a', '-', 'Re-engagement'],
  ['Free Credit','VM_FC_100_5X_14D',100,  'n/a', 5, 14,  'n/a', '-', 'Re-engagement'],
  ['Free Credit','VM_FC_150_5X_14D',150,  'n/a', 5, 14,  'n/a', '-', 'Re-engagement'],
  ['Free Credit','VM_FC_188_5X_14D',188,  'n/a', 5, 14,  'n/a', '-', 'Re-engagement'],
  ['Free Credit','VM_FC_288_5X_14D',288,  'n/a', 5, 14,  'n/a', '-', 'Re-engagement'],
  ['Free Credit','VM_FC_388_5X_14D',388,  'n/a', 5, 14,  'n/a', '-', 'Re-engagement'],
  ['Free Credit','VM_FC_500_5X_14D',500,  'n/a', 5, 14,  'n/a', '-', 'Re-engagement'],
  // Free Credit 8X
  ['Free Credit','VM_FC_10_8X_7D',   10,  'n/a', 8,  7,  'n/a', '-', 'Higher-value'],
  ['Free Credit','VM_FC_10_8X_14D',  10,  'n/a', 8, 14,  'n/a', '-', 'Higher-value'],
  ['Free Credit','VM_FC_20_8X_7D',   20,  'n/a', 8,  7,  'n/a', '-', 'Higher-value'],
  ['Free Credit','VM_FC_20_8X_14D',  20,  'n/a', 8, 14,  'n/a', '-', 'Higher-value'],
  ['Free Credit','VM_FC_30_8X_7D',   30,  'n/a', 8,  7,  'n/a', '-', 'Higher-value'],
  ['Free Credit','VM_FC_30_8X_14D',  30,  'n/a', 8, 14,  'n/a', '-', 'Higher-value'],
  ['Free Credit','VM_FC_50_8X_7D',   50,  'n/a', 8,  7,  'n/a', '-', 'Higher-value'],
  ['Free Credit','VM_FC_50_8X_14D',  50,  'n/a', 8, 14,  'n/a', '-', 'Higher-value'],
  ['Free Credit','VM_FC_80_8X_7D',   80,  'n/a', 8,  7,  'n/a', '-', 'Higher-value'],
  ['Free Credit','VM_FC_80_8X_14D',  80,  'n/a', 8, 14,  'n/a', '-', 'Higher-value'],
  ['Free Credit','VM_FC_100_8X_7D', 100,  'n/a', 8,  7,  'n/a', '-', 'Higher-value'],
  ['Free Credit','VM_FC_100_8X_14D',100,  'n/a', 8, 14,  'n/a', '-', 'Higher-value'],
  ['Free Credit','VM_FC_150_8X_14D',150,  'n/a', 8, 14,  'n/a', '-', 'Higher-value'],
  ['Free Credit','VM_FC_188_8X_14D',188,  'n/a', 8, 14,  'n/a', '-', 'Higher-value'],
  ['Free Credit','VM_FC_288_8X_14D',288,  'n/a', 8, 14,  'n/a', '-', 'Higher-value'],
  ['Free Credit','VM_FC_388_8X_14D',388,  'n/a', 8, 14,  'n/a', '-', 'Higher-value'],
  ['Free Credit','VM_FC_500_8X_14D',500,  'n/a', 8, 14,  'n/a', '-', 'Higher-value'],
  // Deposit Match step1
  ['Deposit Match','VM_DM_100_30_5X_14D',   30, 100, 5, 14, '30%', 'step1', 'Step 1'],
  ['Deposit Match','VM_DM_150_50_5X_14D',   50, 150, 5, 14, '33%', 'step1', 'Step 1'],
  ['Deposit Match','VM_DM_300_100_5X_14D', 100, 300, 5, 14, '33%', 'step1', 'Step 1'],
  ['Deposit Match','VM_DM_500_150_5X_14D', 150, 500, 5, 14, '30%', 'step1', 'Step 1'],
  ['Deposit Match','VM_DM_600_200_5X_14D', 200, 600, 5, 14, '33%', 'step1', 'Step 1'],
  ['Deposit Match','VM_DM_1000_300_5X_14D',300,1000, 5, 14, '30%', 'step1', 'Step 1'],
  ['Deposit Match','VM_DM_300_100_3X_14D', 100, 300, 3, 14, '33%', 'step1', 'Step 1 (3X variant)'],
  // Deposit Match step2 (2X)
  ['Deposit Match','VM_DM_100_50_2X_7D',    50, 100, 2,  7, '50%', 'step2', 'Step 2'],
  ['Deposit Match','VM_DM_100_50_2X_14D',   50, 100, 2, 14, '50%', 'step2', 'Step 2'],
  ['Deposit Match','VM_DM_200_100_2X_7D',  100, 200, 2,  7, '50%', 'step2', 'Step 2'],
  ['Deposit Match','VM_DM_200_100_2X_14D', 100, 200, 2, 14, '50%', 'step2', 'Step 2'],
  ['Deposit Match','VM_DM_300_150_2X_7D',  150, 300, 2,  7, '50%', 'step2', 'Step 2'],
  ['Deposit Match','VM_DM_300_150_2X_14D', 150, 300, 2, 14, '50%', 'step2', 'Step 2'],
  ['Deposit Match','VM_DM_500_250_2X_14D', 250, 500, 2, 14, '50%', 'step2', 'Step 2'],
  ['Deposit Match','VM_DM_600_300_2X_14D', 300, 600, 2, 14, '50%', 'step2', 'Step 2'],
  ['Deposit Match','VM_DM_700_350_2X_14D', 350, 700, 2, 14, '50%', 'step2', 'Step 2'],
  ['Deposit Match','VM_DM_800_400_2X_14D', 400, 800, 2, 14, '50%', 'step2', 'Step 2'],
  ['Deposit Match','VM_DM_1000_500_2X_14D',500,1000, 2, 14, '50%', 'step2', 'Step 2'],
  ['Deposit Match','VM_DM_2000_1000_2X_14D',1000,2000,2, 14, '50%', 'step2', 'Step 2'],
  // Deposit Match step3 (1X high-match)
  ['Deposit Match','VM_DM_500_350_1X_14D',  350, 500, 1, 14, '70%', 'step3', 'Step 3'],
  ['Deposit Match','VM_DM_1000_700_1X_14D', 700,1000, 1, 14, '70%', 'step3', 'Step 3'],
  ['Deposit Match','VM_DM_1000_800_1X_14D', 800,1000, 1, 14, '80%', 'step3', 'Step 3'],
  ['Deposit Match','VM_DM_1500_1050_1X_14D',1050,1500,1, 14, '70%', 'step3', 'Step 3'],
  ['Deposit Match','VM_DM_2000_1400_1X_14D',1400,2000,1, 14, '70%', 'step3', 'Step 3'],
  // Deposit Match step2 high-value (1X, 50%)
  ['Deposit Match','VM_DM_1000_500_1X_14D',  500,1000, 1, 14, '50%', 'step2', 'Step 2 (high-value)'],
  ['Deposit Match','VM_DM_1500_750_1X_14D',  750,1500, 1, 14, '50%', 'step2', 'Step 2 (high-value)'],
  ['Deposit Match','VM_DM_2000_1000_1X_14D',1000,2000, 1, 14, '50%', 'step2', 'Step 2 (high-value)'],
  ['Deposit Match','VM_DM_2500_1250_1X_14D',1250,2500, 1, 14, '50%', 'step2', 'Step 2 (high-value)'],
  ['Deposit Match','VM_DM_3000_1500_1X_14D',1500,3000, 1, 14, '50%', 'step2', 'Step 2 (high-value)'],
  ['Deposit Match','VM_DM_5000_2500_1X_14D',2500,5000, 1, 14, '50%', 'step2', 'Step 2 (high-value)'],
];

function nameDetails(row) {
  const [type,,amount,deposit,to,,match] = row;
  if (type === 'Free Credit')
    return `Free Credit ${amount}, TOx${to}`;
  if (type === 'Deposit Match')
    return `${match} Deposit Match, Min Dep ${deposit}, Max Bonus ${amount}, TOx${to}`;
  // Tier Upgrade
  const tier = row[1].replace('VIP_TRIAL_','').replace('_UPGRADE','');
  return `VIP Trial ${tier.charAt(0)+tier.slice(1).toLowerCase()} Tier Upgrade (marker — no credit)`;
}

function enName(row) {
  const [type,,amount,,to,,match,,notes] = row;
  if (type === 'Free Credit') return `VM Free Credit ${amount}`;
  if (type === 'Deposit Match') return `VM ${match} Deposit Match (TOx${to})`;
  const tier = row[1].replace('VIP_TRIAL_','').replace('_UPGRADE','');
  return `VM VIP Trial ${tier.charAt(0)+tier.slice(1).toLowerCase()} Upgrade`;
}

function zhName(row) {
  const [type,,amount,,to,,match] = row;
  if (type === 'Free Credit') return `VM 免费彩金 ${amount}`;
  if (type === 'Deposit Match') return `VM ${match} 存款奖金 (TOx${to})`;
  return '';
}

function campaign(row) {
  const [type,,,,,,, step, notes] = row;
  if (type === 'Tier Upgrade') return 'VM VIP Trial';
  if (type === 'Free Credit') return notes.includes('Higher') ? 'VM Higher Value' : 'VM Re-engagement';
  if (step === 'step3') return 'VM Journey Step 3';
  if (step === 'step2') return 'VM Journey Step 2';
  return 'VM Journey Step 1';
}

function bonusTypeSheet(row) {
  const [type] = row;
  if (type === 'Free Credit') return 'Free Credit';
  if (type === 'Deposit Match') return 'Deposit - Reload';
  return 'Tier Upgrade';
}

function priority(row) {
  const [,,,,,validity] = row;
  return validity === 7 ? 'Urgent' : 'Normal';
}

// Build rows: A–Y (25 cols)
const rows = CSV.map((row, i) => {
  const rn = `P${String(START_RN + i).padStart(3, '0')}`;
  const [type,,,,, validity] = row;
  const isUpgrade = type === 'Tier Upgrade';
  return [
    '',                    // A Status
    'Info Ready',          // B Remark
    'No',                  // C Banner
    rn,                    // D RN
    'VM',                  // E Requestor
    '15 Jun 2026',         // F Date
    priority(row),         // G Priority
    DEADLINE,              // H Deadline
    'BP9',                 // I Brand
    'MY, SG',              // J Region
    campaign(row),         // K Campaign
    bonusTypeSheet(row),   // L Bonus Type
    nameDetails(row),      // M Name/Details
    isUpgrade ? 'FALSE' : 'TRUE',  // N Inbox
    isUpgrade ? 'FALSE' : 'TRUE',  // O Popup
    isUpgrade ? '' : String(validity), // P Validity
    isUpgrade ? '' : '1',  // Q Rewards Validity
    '',                    // R Expiry mins (WS1 only)
    'Recurring',           // S Recurring/One Time
    '',                    // T Max per player (unlimited)
    '',                    // U Change Type
    '',                    // V Details to Change
    CODE_PREFIX + row[1],  // W Promo Code
    enName(row),           // X EN Name
    zhName(row),           // Y ZH Name
  ];
});

// ── Print preview ─────────────────────────────────────────────────────────────
const COLS = ['Status','Remark','Banner','RN','Requestor','Date','Priority','Deadline','Brand','Region','Campaign','Bonus Type','Name/Details','Inbox','Popup','Validity','RwdVal','ExpMins','Recur','MaxPP','ChgType','Details','PromoCode','EN Name','ZH Name'];
console.log(`Preview — ${rows.length} rows to append (${COMMIT ? 'COMMIT MODE' : 'DRY RUN'}):\n`);
console.log('RN     | BonusType     | PromoCode                       | Validity | M-Details');
console.log('───────┼───────────────┼─────────────────────────────────┼──────────┼───────────────────────────────────────────────');
rows.forEach(r => {
  console.log(`${r[3].padEnd(6)} | ${r[11].padEnd(13)} | ${r[22].padEnd(31)} | ${r[15].padEnd(8)} | ${r[12]}`);
});

if (!COMMIT) {
  console.log('\n── DRY RUN — no changes made. Re-run with --commit to write to sheet. ──');
  process.exit(0);
}

// ── Write to sheet ────────────────────────────────────────────────────────────
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

const body = {
  range: `'${TAB}'!A:Y`,
  majorDimension: 'ROWS',
  values: rows,
};
const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/'${encodeURIComponent(TAB)}'!A:Y:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
const res = await fetch(url, {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
if (!res.ok) {
  const text = await res.text();
  console.error(`✗ Sheets API error ${res.status}: ${text}`);
  process.exit(1);
}
const json = await res.json();
console.log(`\n✓ Appended ${rows.length} rows → ${json.updates?.updatedRange}`);
