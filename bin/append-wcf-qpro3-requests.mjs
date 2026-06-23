#!/usr/bin/env node
// Append 9 WCF promo request rows to the June 2026 tab for QPRO3 (BX99).
// Codes were replicated from QPRO4 (YE55) and are already live.
// P110–P118 — next after existing P109.

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

// Column order A–Y:
// A=Status, B=Remark, C=Banner Needed, D=Request Number (RN), E=Requestor,
// F=Date, G=Priority, H=Deadline, I=Brand, J=Region, K=Campaign,
// L=Bonus Type, M=Name/Details, N=Inbox Message, O=Pop Up Dialog,
// P=Validity (After Claim), Q=Rewards Validity (Before Claim), R=Expiry Minutes (WS1),
// S=Recurring/One Time, T=Max per Player, U=Change Type, V=Details to Change,
// W=Promo Code, X=Promotion Names (EN), Y=Promotion Names (ZH/ID)

const TODAY    = '6/19/2026';
const CAMPAIGN = 'World Cup Final 2026';
const BRAND    = 'QPRO3';
const REGION   = 'MY, SG';
const REMARK   = 'Replicated from QPRO4 (YE55)';

// validity=7 (after claim), reward_validity=30 (before claim) — confirmed live on all 9.
const VAL  = '7';
const RVAL = '30';

const rows = [
  // P110 — Free Spin, Low tier
  [
    /* A Status      */ 'Done',
    /* B Remark      */ REMARK,
    /* C Banner      */ 'No',
    /* D RN          */ 'P110',
    /* E Requestor   */ 'Jascinta',
    /* F Date        */ TODAY,
    /* G Priority    */ '',
    /* H Deadline    */ '',
    /* I Brand       */ BRAND,
    /* J Region      */ REGION,
    /* K Campaign    */ CAMPAIGN,
    /* L Bonus Type  */ 'Free Spin',
    /* M Name/Detail */ 'WCF Low - 50 Free Spins (Gates of Olympus)\nDep Req: RM100\nSpin Denomination: 0.01\nTO: x5',
    /* N Inbox       */ 'Yes',
    /* O Popup       */ 'No',
    /* P Validity    */ VAL,
    /* Q RwdValidity */ RVAL,
    /* R ExpiryWS1   */ '',
    /* S Recurring   */ 'One Time',
    /* T MaxPlayer   */ '',
    /* U ChangeType  */ '',
    /* V ChangeDetail*/ '',
    /* W Promo Code  */ '50FS_5X_001_GOO_WCF',
    /* X Name EN     */ '50 Free Spins on Gates of Olympus',
    /* Y Name ZH     */ '50 次免费旋转 — Gates of Olympus',
  ],

  // P111 — Reload 20%, Low tier
  [
    /* A */ 'Done',
    /* B */ REMARK,
    /* C */ 'No',
    /* D */ 'P111',
    /* E */ 'Jascinta',
    /* F */ TODAY,
    /* G */ '',
    /* H */ '',
    /* I */ BRAND,
    /* J */ REGION,
    /* K */ CAMPAIGN,
    /* L */ 'Deposit',
    /* M */ 'WCF Low - 20% Reload Bonus (All Games)\nTO: x15',
    /* N */ 'Yes',
    /* O */ 'No',
    /* P */ VAL,
    /* Q */ RVAL,
    /* R */ '',
    /* S */ 'One Time',
    /* T */ '',
    /* U */ '',
    /* V */ '',
    /* W */ 'REL_20PCT_15X_WCF',
    /* X */ '20% Reload Bonus',
    /* Y */ '20% 充值奖励',
  ],

  // P112 — Free Credit RM10, Low tier
  [
    /* A */ 'Done',
    /* B */ REMARK,
    /* C */ 'No',
    /* D */ 'P112',
    /* E */ 'Jascinta',
    /* F */ TODAY,
    /* G */ '',
    /* H */ '',
    /* I */ BRAND,
    /* J */ REGION,
    /* K */ CAMPAIGN,
    /* L */ 'Free Credit',
    /* M */ 'WCF Low - RM10 Free Credit\nTO: x12',
    /* N */ 'Yes',
    /* O */ 'No',
    /* P */ VAL,
    /* Q */ RVAL,
    /* R */ '',
    /* S */ 'One Time',
    /* T */ '',
    /* U */ '',
    /* V */ '',
    /* W */ '10FC_12X_WCF',
    /* X */ 'Exclusive Offer - 10 Free Credit',
    /* Y */ '独家优惠 - 10 免费体验金',
  ],

  // P113 — Free Spin, Mid tier
  [
    /* A */ 'Done',
    /* B */ REMARK,
    /* C */ 'No',
    /* D */ 'P113',
    /* E */ 'Jascinta',
    /* F */ TODAY,
    /* G */ '',
    /* H */ '',
    /* I */ BRAND,
    /* J */ REGION,
    /* K */ CAMPAIGN,
    /* L */ 'Free Spin',
    /* M */ 'WCF Mid - 50 Free Spins (Gates of Olympus)\nDep Req: RM300\nSpin Denomination: 0.02\nTO: x8',
    /* N */ 'Yes',
    /* O */ 'No',
    /* P */ VAL,
    /* Q */ RVAL,
    /* R */ '',
    /* S */ 'One Time',
    /* T */ '',
    /* U */ '',
    /* V */ '',
    /* W */ '50FS_8X_002_GOO_WCF',
    /* X */ '50 Free Spins on Gates of Olympus',
    /* Y */ '50 次免费旋转 — Gates of Olympus',
  ],

  // P114 — Reload 25%, Mid tier
  [
    /* A */ 'Done',
    /* B */ REMARK,
    /* C */ 'No',
    /* D */ 'P114',
    /* E */ 'Jascinta',
    /* F */ TODAY,
    /* G */ '',
    /* H */ '',
    /* I */ BRAND,
    /* J */ REGION,
    /* K */ CAMPAIGN,
    /* L */ 'Deposit',
    /* M */ 'WCF Mid - 25% Reload Bonus (All Games)\nTO: x15',
    /* N */ 'Yes',
    /* O */ 'No',
    /* P */ VAL,
    /* Q */ RVAL,
    /* R */ '',
    /* S */ 'One Time',
    /* T */ '',
    /* U */ '',
    /* V */ '',
    /* W */ 'REL_25PCT_15X_WCF',
    /* X */ '25% Reload Bonus',
    /* Y */ '25% 充值奖励',
  ],

  // P115 — Free Credit RM50, Mid tier
  [
    /* A */ 'Done',
    /* B */ REMARK,
    /* C */ 'No',
    /* D */ 'P115',
    /* E */ 'Jascinta',
    /* F */ TODAY,
    /* G */ '',
    /* H */ '',
    /* I */ BRAND,
    /* J */ REGION,
    /* K */ CAMPAIGN,
    /* L */ 'Free Credit',
    /* M */ 'WCF Mid - RM50 Free Credit\nTO: x12',
    /* N */ 'Yes',
    /* O */ 'No',
    /* P */ VAL,
    /* Q */ RVAL,
    /* R */ '',
    /* S */ 'One Time',
    /* T */ '',
    /* U */ '',
    /* V */ '',
    /* W */ '50FC_12X_WCF',
    /* X */ 'Exclusive Offer - 50 Free Credit',
    /* Y */ '独家优惠 - 50 免费体验金',
  ],

  // P116 — Free Spin, High tier
  [
    /* A */ 'Done',
    /* B */ REMARK,
    /* C */ 'No',
    /* D */ 'P116',
    /* E */ 'Jascinta',
    /* F */ TODAY,
    /* G */ '',
    /* H */ '',
    /* I */ BRAND,
    /* J */ REGION,
    /* K */ CAMPAIGN,
    /* L */ 'Free Spin',
    /* M */ 'WCF High - 100 Free Spins (Gates of Olympus)\nDep Req: RM800\nSpin Denomination: 0.02\nTO: x8',
    /* N */ 'Yes',
    /* O */ 'No',
    /* P */ VAL,
    /* Q */ RVAL,
    /* R */ '',
    /* S */ 'One Time',
    /* T */ '',
    /* U */ '',
    /* V */ '',
    /* W */ '100FS_8X_002_GOO_WCF',
    /* X */ '100 Free Spins on Gates of Olympus',
    /* Y */ '100 次免费旋转 — Gates of Olympus',
  ],

  // P117 — Reload 50%, High tier
  [
    /* A */ 'Done',
    /* B */ REMARK,
    /* C */ 'No',
    /* D */ 'P117',
    /* E */ 'Jascinta',
    /* F */ TODAY,
    /* G */ '',
    /* H */ '',
    /* I */ BRAND,
    /* J */ REGION,
    /* K */ CAMPAIGN,
    /* L */ 'Deposit',
    /* M */ 'WCF High - 50% Reload Bonus (All Games)\nTO: x15',
    /* N */ 'Yes',
    /* O */ 'No',
    /* P */ VAL,
    /* Q */ RVAL,
    /* R */ '',
    /* S */ 'One Time',
    /* T */ '',
    /* U */ '',
    /* V */ '',
    /* W */ 'REL_50PCT_15X_WCF',
    /* X */ '50% Reload Bonus',
    /* Y */ '50% 充值奖励',
  ],

  // P118 — Free Credit RM88, High tier
  [
    /* A */ 'Done',
    /* B */ REMARK,
    /* C */ 'No',
    /* D */ 'P118',
    /* E */ 'Jascinta',
    /* F */ TODAY,
    /* G */ '',
    /* H */ '',
    /* I */ BRAND,
    /* J */ REGION,
    /* K */ CAMPAIGN,
    /* L */ 'Free Credit',
    /* M */ 'WCF High - RM88 Free Credit\nTO: x12',
    /* N */ 'Yes',
    /* O */ 'No',
    /* P */ VAL,
    /* Q */ RVAL,
    /* R */ '',
    /* S */ 'One Time',
    /* T */ '',
    /* U */ '',
    /* V */ '',
    /* W */ '88FC_12X_WCF',
    /* X */ 'Exclusive Offer - 88 Free Credit',
    /* Y */ '独家优惠 - 88 免费体验金',
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
rows.forEach(r => console.log(`  ${r[3].padEnd(5)} ${r[26].padEnd(34)} ${r[11]}`));
