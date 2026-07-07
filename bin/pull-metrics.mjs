/**
 * Pull real promo metrics for Townhall 2026 slides 5-7.
 *
 * Reads all 2026 monthly tabs from the Promo Request Sheet.
 * For each row with a promo code + request date + deadline:
 *   - turnaround = (BO created_at) - (sheet Date)
 *   - on_time    = (BO created_at) <= (sheet Deadline)
 *
 * Also queries BO APIs per promo code to get created_at.
 *
 * Usage:
 *   node pull-metrics.mjs
 */

import { getSheetsClient, listTabs, readHeader, detectColumnMapFromHeader, colIndexToLetter } from '../src/sheets-client.js';
import { getAllPromotions } from '../src/api-client.js';
import { QP2_BRAND_TO_IDS } from '../src/api-mapper-qp2.js';

const YEAR = '2026';
const TABS = ['Jan 2026', 'Feb 2026', 'March 2026', 'Apr 2026', 'May 2026', 'June 2026', 'July 2026'];

// Read all rows from a tab
async function readAllRows(client, tabName, colMap) {
  const { google } = await import('googleapis');
  const sheets = google.sheets('v4');
  const spreadsheetId = (await import('../src/sheets-client.js')).getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    auth: client.auth,
    spreadsheetId,
    range: `'${tabName}'!A:Z`,
  });

  const rows = res.data.values || [];
  return rows.slice(1); // skip header
}

const MONTH_NAMES = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };

// Parse the many date formats used in the promo request sheet:
//   "8 Jan 2026", "16 Jun 2026", "14 Jan", "8/1, 3:00 PM", "2026-03-01"
function parseDate(s, fallbackYear = 2026) {
  if (!s) return null;
  s = String(s).trim().replace(/\s+/g, ' ');
  if (!s) return null;

  // "8 Jan 2026", "16 Jun 2026", "14 Jan" (no year)
  const wordMatch = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s*(\d{4})?/);
  if (wordMatch) {
    const day = parseInt(wordMatch[1], 10);
    const mon = MONTH_NAMES[wordMatch[2].toLowerCase().slice(0, 3)];
    const year = wordMatch[3] ? parseInt(wordMatch[3], 10) : fallbackYear;
    if (mon) return new Date(Date.UTC(year, mon - 1, day));
  }

  // "8/1, 3:00 PM" or "8/1" — D/M Malaysian format
  const slashShort = s.match(/^(\d{1,2})\/(\d{1,2})(?:[,\s]|$)/);
  if (slashShort) {
    const day = parseInt(slashShort[1], 10);
    const mon = parseInt(slashShort[2], 10);
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31)
      return new Date(Date.UTC(fallbackYear, mon - 1, day));
  }

  // "DD/MM/YYYY"
  const slashFull = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashFull) {
    return new Date(Date.UTC(parseInt(slashFull[3]), parseInt(slashFull[2]) - 1, parseInt(slashFull[1])));
  }

  // ISO "2026-03-01"
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return new Date(Date.UTC(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3])));

  return null;
}

function daysBetween(d1, d2) {
  if (!d1 || !d2) return null;
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

// ── Main ──────────────────────────────────────────────────────────────────

const client = await getSheetsClient();
console.log(`✓ Auth OK — reading ${TABS.length} monthly tabs\n`);

const tabs = await listTabs(client);
const tabNames = tabs.map(t => t.name);

// Read sheet data
const sheetRows = []; // { rn, date, deadline, code, status, tab }

for (const tabName of TABS) {
  if (!tabNames.includes(tabName)) {
    console.log(`  ⚠ Tab "${tabName}" not found — skipping`);
    continue;
  }

  const header = await readHeader(client, tabName);
  const colMap = detectColumnMapFromHeader(header);

  // Read all data rows
  const { google } = await import('googleapis');
  const sheets = google.sheets('v4');
  const { getSpreadsheetId } = await import('../src/sheets-client.js');
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    auth: client.auth,
    spreadsheetId,
    range: `'${tabName}'!A:Z`,
  });

  const rows = (res.data.values || []).slice(1); // skip header
  let tabCount = 0;

  for (const row of rows) {
    const get = (field) => {
      const idx = colMap[field];
      return idx != null ? (row[idx] || '').toString().trim() : '';
    };

    const rn = get('request_number');
    if (!rn || !/^P\d{3}/.test(rn)) continue; // skip non-P### rows

    const dateStr = get('date');
    const deadlineStr = get('deadline');
    const code = get('promo_code');
    const status = get('status');

    const tabYear = parseInt(tabName.match(/\d{4}/)?.[0] || '2026', 10);
    const date = parseDate(dateStr, tabYear);
    const deadline = parseDate(deadlineStr, tabYear);

    sheetRows.push({ rn, date, dateStr, deadline, deadlineStr, code, status, tab: tabName });
    tabCount++;
  }

  console.log(`  ${tabName}: ${tabCount} request rows`);
}

console.log(`\nTotal sheet rows: ${sheetRows.length}`);

// Show date range sample
const withDates = sheetRows.filter(r => r.date);
const withDeadlines = sheetRows.filter(r => r.deadline);
const withCodes = sheetRows.filter(r => r.code);
console.log(`  → with parsed date:     ${withDates.length}`);
console.log(`  → with parsed deadline: ${withDeadlines.length}`);
console.log(`  → with promo code:      ${withCodes.length}`);

// Show a sample
console.log('\nSample rows (first 10 with date + code):');
const sample = sheetRows.filter(r => r.date && r.code).slice(0, 10);
for (const r of sample) {
  console.log(`  ${r.rn.padEnd(8)} ${r.dateStr.padEnd(12)} deadline=${r.deadlineStr.padEnd(12)} code=${r.code.padEnd(30)} status=${r.status}`);
}

// ── Build a code→requestDate lookup ──────────────────────────────────────

const codeToRow = {};
for (const r of sheetRows) {
  if (r.code) {
    // A promo code can appear in multiple rows (multi-brand requests)
    // Use the first occurrence
    if (!codeToRow[r.code]) codeToRow[r.code] = r;
  }
}

console.log(`\nUnique promo codes from sheet: ${Object.keys(codeToRow).length}`);

// ── Query BO for created_at per code ─────────────────────────────────────

console.log('\nQuerying QPRO BO APIs for created_at...');

const codeCreatedAt = {}; // code → created_at ISO string

// Query QPRO1-17
const QPRO_BRANDS = Array.from({ length: 17 }, (_, i) => `qpro${i + 1}`);
for (const siteId of QPRO_BRANDS) {
  try {
    const { rows } = await getAllPromotions(siteId, {
      perPage: 500, status: 1, sortBy: 'id', sortOrder: 'desc',
    });
    for (const r of rows) {
      if (r.created_at?.startsWith(YEAR) && !codeCreatedAt[r.code]) {
        codeCreatedAt[r.code] = r.created_at;
      }
    }
    process.stdout.write('.');
  } catch (e) {
    process.stdout.write('x');
  }
  await new Promise(r => setTimeout(r, 300));
}

// Query QP2
const QP2_MERCHANTS = Object.entries(QP2_BRAND_TO_IDS).map(([brand, ids]) => ({
  brand,
  merchantId: ids.merchantId,
}));

for (const { merchantId } of QP2_MERCHANTS) {
  try {
    const { rows } = await getAllPromotions('ibc22', {
      perPage: 500, status: 1, merchantId, sortBy: 'id', sortOrder: 'desc',
    });
    for (const r of rows) {
      if (r.created_at?.startsWith(YEAR) && !codeCreatedAt[r.code]) {
        codeCreatedAt[r.code] = r.created_at;
      }
    }
    process.stdout.write('.');
  } catch (e) {
    process.stdout.write('x');
  }
  await new Promise(r => setTimeout(r, 300));
}

console.log(`\n✓ BO created_at fetched for ${Object.keys(codeCreatedAt).length} unique codes\n`);

// ── Calculate turnaround metrics ──────────────────────────────────────────

const turnarounds = []; // days from request date to BO created_at
const onTimeResults = []; // boolean per promo (created_at <= deadline)

for (const [code, row] of Object.entries(codeToRow)) {
  const createdAtStr = codeCreatedAt[code];
  if (!createdAtStr) continue;

  const createdAt = new Date(createdAtStr);

  if (row.date) {
    const days = daysBetween(row.date, createdAt);
    if (days !== null && days >= 0 && days <= 30) { // sanity filter
      turnarounds.push({ code, days, requestDate: row.dateStr, createdAt: createdAtStr, rn: row.rn });
    }
  }

  if (row.deadline) {
    // Use end of deadline day (23:59:59 UTC) — avoids false-late from midnight comparison
    const deadlineEndOfDay = new Date(row.deadline.getTime() + 24 * 60 * 60 * 1000 - 1);
    const isOnTime = createdAt <= deadlineEndOfDay;
    onTimeResults.push({ code, isOnTime, deadline: row.deadlineStr, createdAt: createdAtStr, rn: row.rn });
  }
}

console.log(`Turnaround pairs (request date + BO created_at): ${turnarounds.length}`);
console.log(`On-time pairs (deadline + BO created_at):        ${onTimeResults.length}`);

if (turnarounds.length > 0) {
  const avg = turnarounds.reduce((s, t) => s + t.days, 0) / turnarounds.length;
  const sorted = [...turnarounds].sort((a, b) => a.days - b.days);
  const median = sorted[Math.floor(sorted.length / 2)].days;
  const min = sorted[0].days;
  const max = sorted[sorted.length - 1].days;
  const within1Day = turnarounds.filter(t => t.days <= 1).length;
  const within3Days = turnarounds.filter(t => t.days <= 3).length;

  console.log(`\nTurnaround (request → BO creation):`);
  console.log(`  Average:      ${avg.toFixed(1)} days`);
  console.log(`  Median:       ${median} days`);
  console.log(`  Min/Max:      ${min} / ${max} days`);
  console.log(`  Within 1 day: ${within1Day} / ${turnarounds.length} = ${(within1Day/turnarounds.length*100).toFixed(0)}%`);
  console.log(`  Within 3 days: ${within3Days} / ${turnarounds.length} = ${(within3Days/turnarounds.length*100).toFixed(0)}%`);

  // Distribution
  const dist = { '0': 0, '1': 0, '2-3': 0, '4-7': 0, '8+': 0 };
  for (const t of turnarounds) {
    if (t.days === 0) dist['0']++;
    else if (t.days === 1) dist['1']++;
    else if (t.days <= 3) dist['2-3']++;
    else if (t.days <= 7) dist['4-7']++;
    else dist['8+']++;
  }
  console.log('\n  Distribution:');
  for (const [k, v] of Object.entries(dist)) {
    const pct = (v / turnarounds.length * 100).toFixed(0);
    console.log(`    ${k.padEnd(6)} days: ${String(v).padStart(4)} (${pct}%)`);
  }
}

if (onTimeResults.length > 0) {
  const onTime = onTimeResults.filter(r => r.isOnTime).length;
  const pct = (onTime / onTimeResults.length * 100).toFixed(0);
  console.log(`\nOn-time delivery (created before deadline):`);
  console.log(`  ${onTime} / ${onTimeResults.length} = ${pct}%`);
}

// ── Summary for slides ────────────────────────────────────────────────────

console.log('\n\n════════════════════════════════════════');
console.log('SLIDE PLACEHOLDER DATA SUMMARY');
console.log('════════════════════════════════════════');

if (turnarounds.length > 0) {
  const avg = turnarounds.reduce((s, t) => s + t.days, 0) / turnarounds.length;
  console.log(`\nSlide 5 / Slide 6 — Turnaround:`);
  console.log(`  Avg days request→live: ${avg.toFixed(1)}`);
  console.log(`  Samples: ${turnarounds.length} promos`);
}

if (onTimeResults.length > 0) {
  const onTime = onTimeResults.filter(r => r.isOnTime).length;
  const pct = Math.round(onTime / onTimeResults.length * 100);
  console.log(`\nSlide 5 / Slide 6 — On-time:`);
  console.log(`  ${pct}% delivered by deadline`);
  console.log(`  Samples: ${onTimeResults.length} promos`);
}

// Brand count
const ACTIVE_BRANDS = ['QPRO1','QPRO2','QPRO3','QPRO4','QPRO5','QPRO6','QPRO7',
  'QPRO8','QPRO9','QPRO10','QPRO12','QPRO15','QPRO16','QP2A','QP2B','QP2C','QP2D'];
console.log(`\nSlide 5 / Slide 6 — Brand coverage:`);
console.log(`  Active brands (QPRO+QP2): ${ACTIVE_BRANDS.length}`);
console.log(`  (+ WS1/WS2 MB8 = not in BO count)`);

console.log('\n════════════════════════════════════════\n');
