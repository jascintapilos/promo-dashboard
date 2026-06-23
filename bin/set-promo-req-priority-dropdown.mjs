#!/usr/bin/env node
/**
 * Apply Normal / High / Urgent dropdown to the Priority column on every
 * month tab of the operator's Promo Code Request sheet.
 *
 * Uses Sheets API batchUpdate with setDataValidation.
 */
import { getGoogleAuth } from '../src/google-auth.js';
const PROMO_REQ_SS_ID = '1dqvCM9SoPLJ2iYNCQRe450wBk3S7HSHtbayuAJguodM';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

async function sheetsApi(path, method = 'GET', body) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${PROMO_REQ_SS_ID}${path}`, {
    method,
    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

// 1. List tabs + find Priority column on each
const meta = await sheetsApi('');
const monthTabs = meta.sheets.filter(s => /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(s.properties.title));
console.log(`Found ${monthTabs.length} month tabs:`);
monthTabs.forEach(t => console.log(`  • ${t.properties.title} (gid=${t.properties.sheetId})`));

const requests = [];

for (const tab of monthTabs) {
  const title = tab.properties.title;
  const gid = tab.properties.sheetId;

  // Read header row
  const rows = await sheetsApi(`/values/${encodeURIComponent(title)}!A1:AZ1`);
  const headers = (rows.values || [[]])[0];
  const prioIdx = headers.findIndex(h => /^priority\b/i.test(String(h || '').trim()));
  if (prioIdx < 0) {
    console.log(`  ⚠ ${title}: no Priority column found — skipping`);
    continue;
  }
  console.log(`  ${title}: Priority at column ${String.fromCharCode(65 + prioIdx)} (idx ${prioIdx})`);

  // Build setDataValidation request — apply to row 2 down to row 1000
  requests.push({
    setDataValidation: {
      range: {
        sheetId: gid,
        startRowIndex: 1,
        endRowIndex: 1000,
        startColumnIndex: prioIdx,
        endColumnIndex: prioIdx + 1,
      },
      rule: {
        condition: {
          type: 'ONE_OF_LIST',
          values: [
            { userEnteredValue: 'Normal' },
            { userEnteredValue: 'High' },
            { userEnteredValue: 'Urgent' },
          ],
        },
        showCustomUi: true,
        strict: true,
        inputMessage: 'Pick: Normal / High / Urgent',
      },
    },
  });
}

if (!requests.length) {
  console.log('\n⚠ No requests to send.');
  process.exit(0);
}

console.log(`\nSending ${requests.length} setDataValidation requests…`);
const result = await sheetsApi(':batchUpdate', 'POST', { requests });
console.log('✓ Done — applied Priority dropdown (Normal/High/Urgent) to all month tabs.');
console.log(`  ${result.replies?.length || 0} replies received.`);
