#!/usr/bin/env node
// Append 5 promo requests for FIFA World Cup Kickstart Campaign 2026 (WS1)
// P105–P109

import {
  getSheetsClient,
  getSpreadsheetId,
  listTabs,
  a1Range,
} from '../src/sheets-client.js';

const client = await getSheetsClient();
const { sheets } = client;
const sid = getSpreadsheetId();

const tabs = await listTabs(client);
const tab = tabs.find((t) => /june\s*2026/i.test(t.name))?.name;
if (!tab) throw new Error('June 2026 tab not found');
console.log('Tab:', tab);

// Column order A–Y matching COLUMN_INDEX_MAR2026:
// A=status, B=remark, C=banner_needed, D=request_number, E=requestor,
// F=date, G=priority, H=deadline, I=brand, J=region, K=campaign,
// L=bonus_type, M=name_details, N=inbox_message, O=popup_dialog,
// P=validity, Q=rewards_validity, R=expiry_minutes_ws1, S=recurring,
// T=max_per_player, U=change_type, V=change_details, W=promo_code,
// X=promotion_name_en, Y=promotion_name_zh_id

const TODAY = '6/18/2026';
const CAMPAIGN = 'FIFA World Cup Kickstart Campaign 2026';
const BRAND = 'WS1';
const REGION = 'MY';

const rows = [
  // P105 — FC Free Bet, Gold
  [
    /* A status            */ 'Requested',
    /* B remark            */ 'Info Ready',
    /* C banner_needed     */ 'No',
    /* D request_number    */ 'P105',
    /* E requestor         */ 'Jascinta',
    /* F date              */ TODAY,
    /* G priority          */ '',
    /* H deadline          */ '',
    /* I brand             */ BRAND,
    /* J region            */ REGION,
    /* K campaign          */ CAMPAIGN,
    /* L bonus_type        */ 'Free Credit',
    /* M name_details      */ 'FIFA WC Kickstart - Sports Free Bet\nGold: RM100\nTO: 5x\nCategory: Sportsbook only\nClaim Window: 1 day',
    /* N inbox_message     */ '',
    /* O popup_dialog      */ '',
    /* P validity          */ '',
    /* Q rewards_validity  */ '1',
    /* R expiry_ws1        */ '1440',
    /* S recurring         */ 'One Time',
    /* T max_per_player    */ '',
    /* U change_type       */ '',
    /* V change_details    */ '',
    /* W promo_code        */ 'WC26_FB_100_GLD',
    /* X promotion_name_en */ 'FIFA World Cup Kickstart - Sports Free Bet',
    /* Y promotion_name_zh */ '',
  ],

  // P106 — FC Free Bet, Platinum
  [
    /* A */ 'Requested',
    /* B */ 'Info Ready',
    /* C */ 'No',
    /* D */ 'P106',
    /* E */ 'Jascinta',
    /* F */ TODAY,
    /* G */ '',
    /* H */ '',
    /* I */ BRAND,
    /* J */ REGION,
    /* K */ CAMPAIGN,
    /* L */ 'Free Credit',
    /* M */ 'FIFA WC Kickstart - Sports Free Bet\nPlatinum: RM160\nTO: 5x\nCategory: Sportsbook only\nClaim Window: 1 day',
    /* N */ '',
    /* O */ '',
    /* P */ '',
    /* Q */ '1',
    /* R */ '1440',
    /* S */ 'One Time',
    /* T */ '',
    /* U */ '',
    /* V */ '',
    /* W */ 'WC26_FB_160_PLT',
    /* X */ 'FIFA World Cup Kickstart - Sports Free Bet',
    /* Y */ '',
  ],

  // P107 — FC Free Bet, Diamond
  [
    /* A */ 'Requested',
    /* B */ 'Info Ready',
    /* C */ 'No',
    /* D */ 'P107',
    /* E */ 'Jascinta',
    /* F */ TODAY,
    /* G */ '',
    /* H */ '',
    /* I */ BRAND,
    /* J */ REGION,
    /* K */ CAMPAIGN,
    /* L */ 'Free Credit',
    /* M */ 'FIFA WC Kickstart - Sports Free Bet\nDiamond: RM250\nTO: 5x\nCategory: Sportsbook only\nClaim Window: 1 day',
    /* N */ '',
    /* O */ '',
    /* P */ '',
    /* Q */ '1',
    /* R */ '1440',
    /* S */ 'One Time',
    /* T */ '',
    /* U */ '',
    /* V */ '',
    /* W */ 'WC26_FB_250_DMD',
    /* X */ 'FIFA World Cup Kickstart - Sports Free Bet',
    /* Y */ '',
  ],

  // P108 — 30% Deposit Bonus, Gold
  [
    /* A */ 'Requested',
    /* B */ 'Info Ready',
    /* C */ 'No',
    /* D */ 'P108',
    /* E */ 'Jascinta',
    /* F */ TODAY,
    /* G */ '',
    /* H */ '',
    /* I */ BRAND,
    /* J */ REGION,
    /* K */ CAMPAIGN,
    /* L */ 'Deposit',
    /* M */ 'FIFA WC Kickstart - 30% Deposit Bonus\nGold: Max Bonus RM1,000\nMin Dep: RM300\nTO: 12x\nCategory: Sportsbook only\nClaim Window: 7 days\nOffered to FC claimants only',
    /* N */ '',
    /* O */ '',
    /* P */ '',
    /* Q */ '7',
    /* R */ '10080',
    /* S */ 'One Time',
    /* T */ '',
    /* U */ '',
    /* V */ '',
    /* W */ 'WC26_DEP_30PCT_1K_GLD',
    /* X */ 'FIFA World Cup Kickstart - 30% Deposit Bonus',
    /* Y */ '',
  ],

  // P109 — 30% Deposit Bonus, Platinum & Diamond
  [
    /* A */ 'Requested',
    /* B */ 'Info Ready',
    /* C */ 'No',
    /* D */ 'P109',
    /* E */ 'Jascinta',
    /* F */ TODAY,
    /* G */ '',
    /* H */ '',
    /* I */ BRAND,
    /* J */ REGION,
    /* K */ CAMPAIGN,
    /* L */ 'Deposit',
    /* M */ 'FIFA WC Kickstart - 30% Deposit Bonus\nPlat & Diamond: Max Bonus RM2,000\nMin Dep: RM300\nTO: 12x\nCategory: Sportsbook only\nClaim Window: 7 days\nOffered to FC claimants only',
    /* N */ '',
    /* O */ '',
    /* P */ '',
    /* Q */ '7',
    /* R */ '10080',
    /* S */ 'One Time',
    /* T */ '',
    /* U */ '',
    /* V */ '',
    /* W */ 'WC26_DEP_30PCT_2K_PLTDMD',
    /* X */ 'FIFA World Cup Kickstart - 30% Deposit Bonus',
    /* Y */ '',
  ],
];

const res = await sheets.spreadsheets.values.append({
  spreadsheetId: sid,
  range: a1Range(tab, 'A:Y'),
  valueInputOption: 'USER_ENTERED',
  insertDataOption: 'INSERT_ROWS',
  requestBody: { values: rows },
});

const updates = res.data.updates;
console.log('✓ Appended:', updates.updatedRange, '|', updates.updatedRows, 'rows,', updates.updatedCells, 'cells');
rows.forEach(r => console.log(`  ${r[3]} → ${r[26]}`));
