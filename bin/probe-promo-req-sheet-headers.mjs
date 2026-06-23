#!/usr/bin/env node
/**
 * Probe the operator's Promo Code Request sheet headers + sample last row
 * to find why Banner / Deadline / Column M aren't writing back.
 */
import { getGoogleAuth } from '../src/google-auth.js';
const PROMO_REQ_SS_ID = '1dqvCM9SoPLJ2iYNCQRe450wBk3S7HSHtbayuAJguodM';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

async function sheetsApi(path) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${PROMO_REQ_SS_ID}${path}`, {
    headers: { Authorization: 'Bearer ' + tok },
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

const meta = await sheetsApi('');
console.log('Tabs:');
meta.sheets.forEach(s => console.log('  • ' + s.properties.title + ' (gid=' + s.properties.sheetId + ')'));

const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const now = new Date();
const mon = monthNames[now.getMonth()];
const year = String(now.getFullYear());
const yr2 = year.slice(2);
const tab = meta.sheets.find(s => {
  const n = s.properties.title;
  return n.includes(mon) && (n.includes(year) || n.includes(yr2));
}) || meta.sheets.find(s => s.properties.title.toLowerCase().includes(mon.toLowerCase()))
   || meta.sheets[0];

console.log('\nUsing tab:', tab.properties.title);

const rows = await sheetsApi(`/values/${encodeURIComponent(tab.properties.title)}!A1:AZ3?majorDimension=ROWS`);
const headers = rows.values[0];
console.log('\nHeaders (' + headers.length + ' columns):');
headers.forEach((h, i) => console.log('  ' + String.fromCharCode(65 + i) + ' (' + i + '): ' + JSON.stringify(h)));

console.log('\n── Regex match test ──');
const tests = [
  { name: 'deadline',   re: /^deadline\b/i },
  { name: 'name/m',     re: /^name.*details|^details|^column\s*m/i },
  { name: 'banner',     re: /^banner(?!.*approval)/i },
  { name: 'date',       re: /^date\b/i },
  { name: 'bonus_type', re: /^bonus\s*type/i },
  { name: 'priority',   re: /^priority\b/i },
];
tests.forEach(t => {
  const matches = [];
  headers.forEach((h, i) => {
    const s = String(h || '').replace(/\s+/g, ' ').trim();
    if (t.re.test(s)) matches.push(`  col ${String.fromCharCode(65 + i)} (${i}): ${JSON.stringify(s)}`);
  });
  console.log(`\n  ${t.name}  ${t.re}`);
  if (matches.length) matches.forEach(m => console.log(m));
  else console.log('    ✗ NO MATCH');
});

// Last data row sample to see what's been written
const lastRow = await sheetsApi(`/values/${encodeURIComponent(tab.properties.title)}!A1:AZ1000?majorDimension=ROWS`);
const dataRows = lastRow.values || [];
console.log('\n── Sample last 2 rows of data ──');
dataRows.slice(-2).forEach((row, ri) => {
  console.log('Row ' + (dataRows.length - 1 + ri) + ':');
  headers.forEach((h, i) => {
    const v = row[i];
    if (v != null && v !== '') console.log('  ' + h + ': ' + JSON.stringify(v));
  });
});
