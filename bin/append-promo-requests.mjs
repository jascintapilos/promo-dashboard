#!/usr/bin/env node
// One-off: append two Welcome Bonus promo requests to the June 2026 sheet tab.
// Rows P083 + P084.

import {
  getSheetsClient,
  getSpreadsheetId,
  resolveCurrentMonthTab,
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

// Column order A–Y (0-based, 25 cols) matching COLUMN_INDEX_MAR2026:
// A=status, B=remark, C=banner_needed, D=request_number, E=requestor,
// F=date, G=priority, H=deadline, I=brand, J=region, K=campaign,
// L=bonus_type, M=name_details, N=inbox_message, O=popup_dialog,
// P=validity, Q=rewards_validity, R=expiry_minutes_ws1, S=recurring,
// T=max_per_player, U=change_type, V=change_details, W=promo_code,
// X=promotion_name_en, Y=promotion_name_zh_id

const row1 = [
  /* A status            */ 'Requested',
  /* B remark            */ 'Info Ready',
  /* C banner_needed     */ 'No',
  /* D request_number    */ 'P083',
  /* E requestor         */ 'Joel',
  /* F date              */ '6/16/2026',
  /* G priority          */ '',
  /* H deadline          */ '',
  /* I brand             */ 'QPRO1, WS1, QP2C',
  /* J region            */ 'MY, SG',
  /* K campaign          */ 'WC26',
  /* L bonus_type        */ 'Deposit - Welcome',
  /* M name_details      */ 'Welcome Bonus - Sports and Slots only\nMin Dep: RM50 / SGD50\nBonus: 100%\nMax Bonus: 300\nTO: 20x\nValidity: 15 days\nQP2C: Switch on only',
  /* N inbox_message     */ '',
  /* O popup_dialog      */ '',
  /* P validity          */ '15',
  /* Q rewards_validity  */ '',
  /* R expiry_ws1        */ '',
  /* S recurring         */ 'One Time',
  /* T max_per_player    */ '',
  /* U change_type       */ '',
  /* V change_details    */ '',
  /* W promo_code        */ 'WEL_WC26_100PCT_50_25x',
  /* X promotion_name_en */ '',
  /* Y promotion_name_zh */ '',
];

const row2 = [
  /* A status            */ 'Requested',
  /* B remark            */ 'Info Ready',
  /* C banner_needed     */ 'No',
  /* D request_number    */ 'P084',
  /* E requestor         */ '',
  /* F date              */ '6/16/2026',
  /* G priority          */ '',
  /* H deadline          */ '',
  /* I brand             */ 'QPRO1, WS1, QP2C',
  /* J region            */ 'MY, SG',
  /* K campaign          */ '',
  /* L bonus_type        */ 'Deposit - Welcome',
  /* M name_details      */ 'Welcome Bonus - Sports and Slots only\nMin Dep: RM100 / SGD100\nBonus: 188%\nMax Bonus: 188\nTO: 20x\nValidity: 15 days\nQP2C: Switch on only',
  /* N inbox_message     */ '',
  /* O popup_dialog      */ '',
  /* P validity          */ '15',
  /* Q rewards_validity  */ '',
  /* R expiry_ws1        */ '',
  /* S recurring         */ 'One Time',
  /* T max_per_player    */ '',
  /* U change_type       */ '',
  /* V change_details    */ '',
  /* W promo_code        */ 'WELC_188PCT_25X',
  /* X promotion_name_en */ '',
  /* Y promotion_name_zh */ '',
];

const res = await sheets.spreadsheets.values.append({
  spreadsheetId: sid,
  range: a1Range(tab, 'A:Y'),
  valueInputOption: 'USER_ENTERED',
  insertDataOption: 'INSERT_ROWS',
  requestBody: { values: [row1, row2] },
});

const updates = res.data.updates;
console.log('✓ Appended:', updates.updatedRange, '|', updates.updatedRows, 'rows,', updates.updatedCells, 'cells');
console.log('P083 → WEL_WC26_100PCT_50_25x');
console.log('P084 → WELC_188PCT_25X');
