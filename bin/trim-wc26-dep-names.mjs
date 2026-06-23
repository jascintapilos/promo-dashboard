#!/usr/bin/env node
// Trim PromotionName for P108 (3719) and P109 (3720) via /PM/UpdatePromotionDetails.
// Then sync all 5 WC26 names back to the promo request sheet column X.

import { igmpPost } from '../src/igmp-client.js';
import { getSheetsClient, getSpreadsheetId, listTabs } from '../src/sheets-client.js';

const SITE = 'ws1-v3-my';

const DEP_ENTRIES = [
  { rn: 'P108', id: 3719, newName: 'FIFA World Cup Kickstart - 30% Deposit Bonus CAP1000', row: 109 },
  { rn: 'P109', id: 3720, newName: 'FIFA World Cup Kickstart - 30% Deposit Bonus CAP2000', row: 110 },
];

// Convert "DD/MM/YYYY" → Date.toDateString() ("Thu Jun 18 2026")
function igmpDateToDateString(s) {
  if (!s) return s;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).toDateString();
  return new Date(s).toDateString();
}

// ── Step 1: update PromotionName via UpdatePromotionDetails ─────────────────
for (const e of DEP_ENTRIES) {
  const detRes = await igmpPost(SITE, '/PM/GetBonusInfo', { PromotionId: e.id });
  const promo = detRes?.data?.Promotion || detRes?.data;
  if (!promo) { console.error(`${e.rn}: could not fetch detail`); continue; }

  console.log(`${e.rn} current name: ${promo.PromotionName}`);

  // UpdatePromotionDetails handles the name/dates tab
  const updateBody = {
    PromotionId: promo.PromotionId,
    PromotionName: e.newName,
    PromotionDescription: promo.PromotionDescription || '',
    PromotionStartDate: igmpDateToDateString(promo.PromotionStartDate),
    PromotionEndDate: igmpDateToDateString(promo.PromotionEndDate),
  };
  const upRes = await igmpPost(SITE, '/PM/UpdatePromotionDetails', updateBody);
  console.log(`${e.rn} updated → ${e.newName}`, JSON.stringify(upRes?.data || upRes));
}

// ── Step 2: verify final names for all 5 ────────────────────────────────────
const finalNames = {};
const checks = [
  { rn: 'P105', id: 3716, type: 'fc',  row: 106 },
  { rn: 'P106', id: 3717, type: 'fc',  row: 107 },
  { rn: 'P107', id: 3718, type: 'fc',  row: 108 },
  { rn: 'P108', id: 3719, type: 'dep', row: 109 },
  { rn: 'P109', id: 3720, type: 'dep', row: 110 },
];

console.log('\n── Current BO names ────────────────────────────────────');
for (const e of checks) {
  const ep = e.type === 'fc' ? '/PM/GetFreeCreditInfo' : '/PM/GetBonusInfo';
  const res = await igmpPost(SITE, ep, { PromotionId: e.id });
  const promo = res?.data?.Promotion || res?.data;
  finalNames[e.rn] = { name: promo?.PromotionName, row: e.row };
  console.log(`${e.rn} (${e.id}) | ${promo?.PromotionName}`);
}

// ── Step 3: write back to sheet column X ────────────────────────────────────
const client = await getSheetsClient();
const { sheets } = client;
const sid = getSpreadsheetId();
const tabs = await listTabs(client);
const tab = tabs.find((t) => /june\s*2026/i.test(t.name))?.name;

console.log('\n── Syncing to sheet column X ───────────────────────────');
for (const [rn, { name, row }] of Object.entries(finalNames)) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: sid,
    range: `${tab}!X${row}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[name]] },
  });
  console.log(`X${row} (${rn}) → ${name}`);
}
console.log('\nDone.');
