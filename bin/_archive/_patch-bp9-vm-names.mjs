#!/usr/bin/env node
// Patch cols X + Y (EN/ZH promo names) for P019-P082 in June 2026 sheet.
import { getGoogleAuth } from '../src/google-auth.js';

const SHEET_ID  = '1dqvCM9SoPLJ2iYNCQRe450wBk3S7HSHtbayuAJguodM';
const TAB       = 'June 2026';
const START_ROW = 20;   // sheet row 20 = P019
const END_ROW   = 83;   // sheet row 83 = P082
const COUNT     = END_ROW - START_ROW + 1; // 64 rows

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

const enName = 'VIP Exclusive Gift';
const zhName = 'VIP尊享礼遇';

// Build one value row per sheet row: [EN, ZH]
const values = Array.from({ length: COUNT }, () => [enName, zhName]);

const range = `'${TAB}'!X${START_ROW}:Y${END_ROW}`;
await sheetsApi(`/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, 'PUT', {
  range,
  majorDimension: 'ROWS',
  values,
});

console.log(`✓ Updated ${COUNT} rows → ${range}`);
console.log(`  EN: "${enName}"`);
console.log(`  ZH: "${zhName}"`);
