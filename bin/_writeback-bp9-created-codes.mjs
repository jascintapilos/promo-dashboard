#!/usr/bin/env node
// Write "Created Promo Code" column (col Z) back into June 2026 sheet for P019-P082.
import { getGoogleAuth } from '../src/google-auth.js';

const SHEET_ID  = '1dqvCM9SoPLJ2iYNCQRe450wBk3S7HSHtbayuAJguodM';
const TAB       = 'June 2026';

// Ordered by sheet row (row 20 = P019 … row 83 = P082)
const CREATED_CODES = [
  // FC 5X (P019–P035)
  'KN_VM_FC_10_5X_7D','KN_VM_FC_10_5X_14D',
  'KN_VM_FC_20_5X_7D','KN_VM_FC_20_5X_14D',
  'KN_VM_FC_30_5X_7D','KN_VM_FC_30_5X_14D',
  'KN_VM_FC_50_5X_7D','KN_VM_FC_50_5X_14D',
  'KN_VM_FC_80_5X_7D','KN_VM_FC_80_5X_14D',
  'KN_VM_FC_100_5X_7D','KN_VM_FC_100_5X_14D',
  'KN_VM_FC_150_5X_14D','KN_VM_FC_188_5X_14D',
  'KN_VM_FC_288_5X_14D','KN_VM_FC_388_5X_14D','KN_VM_FC_500_5X_14D',
  // FC 8X (P036–P052)
  'KN_VM_FC_10_8X_7D','KN_VM_FC_10_8X_14D',
  'KN_VM_FC_20_8X_7D','KN_VM_FC_20_8X_14D',
  'KN_VM_FC_30_8X_7D','KN_VM_FC_30_8X_14D',
  'KN_VM_FC_50_8X_7D','KN_VM_FC_50_8X_14D',
  'KN_VM_FC_80_8X_7D','KN_VM_FC_80_8X_14D',
  'KN_VM_FC_100_8X_7D','KN_VM_FC_100_8X_14D',
  'KN_VM_FC_150_8X_14D','KN_VM_FC_188_8X_14D',
  'KN_VM_FC_288_8X_14D','KN_VM_FC_388_8X_14D','KN_VM_FC_500_8X_14D',
  // DM step1 (P053–P059)
  'KN_VM_DM_100_30_5X_14D','KN_VM_DM_150_50_5X_14D',
  'KN_VM_DM_300_100_5X_14D','KN_VM_DM_500_150_5X_14D',
  'KN_VM_DM_600_200_5X_14D','KN_VM_DM_1000_300_5X_14D',
  'KN_VM_DM_300_100_3X_14D',
  // DM step2 2X (P060–P071)
  'KN_VM_DM_100_50_2X_7D','KN_VM_DM_100_50_2X_14D',
  'KN_VM_DM_200_100_2X_7D','KN_VM_DM_200_100_2X_14D',
  'KN_VM_DM_300_150_2X_7D','KN_VM_DM_300_150_2X_14D',
  'KN_VM_DM_500_250_2X_14D','KN_VM_DM_600_300_2X_14D',
  'KN_VM_DM_700_350_2X_14D','KN_VM_DM_800_400_2X_14D',
  'KN_VM_DM_1000_500_2X_14D','KN_VM_DM_2000_1000_2X_14D',
  // DM step3 + hi-val 1X (P072–P082)
  'KN_VM_DM_500_350_1X_14D','KN_VM_DM_1000_700_1X_14D',
  'KN_VM_DM_1000_800_1X_14D','KN_VM_DM_1500_1050_1X_14D',
  'KN_VM_DM_2000_1400_1X_14D',
  'KN_VM_DM_1000_500_1X_14D','KN_VM_DM_1500_750_1X_14D',
  'KN_VM_DM_2000_1000_1X_14D','KN_VM_DM_2500_1250_1X_14D',
  'KN_VM_DM_3000_1500_1X_14D','KN_VM_DM_5000_2500_1X_14D',
];

const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

async function sheetsApi(path, method = 'GET', body) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    method,
    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

// Write header to Z1
const headerRange = `'${TAB}'!Z1`;
await sheetsApi(`/values/${encodeURIComponent(headerRange)}?valueInputOption=USER_ENTERED`, 'PUT', {
  range: headerRange,
  majorDimension: 'ROWS',
  values: [['Created Promo Code']],
});
console.log('✓ Header written → Z1: "Created Promo Code"');

// Write data to Z20:Z83
const dataRange = `'${TAB}'!Z20:Z83`;
await sheetsApi(`/values/${encodeURIComponent(dataRange)}?valueInputOption=USER_ENTERED`, 'PUT', {
  range: dataRange,
  majorDimension: 'ROWS',
  values: CREATED_CODES.map(c => [c]),
});
console.log(`✓ Data written → Z20:Z83 (${CREATED_CODES.length} codes)`);
