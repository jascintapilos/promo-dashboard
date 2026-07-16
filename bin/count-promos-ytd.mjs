/**
 * Count 2026 YTD promo codes directly from BO APIs.
 * Queries every QPRO + QP2 brand, filters by created_at, groups by week.
 * This is the authoritative source — same data the dashboard uses.
 *
 * WS1 / WS2 use a different platform (BIA) and are not covered here.
 *
 * Usage:
 *   node bin/count-promos-ytd.mjs
 *   node bin/count-promos-ytd.mjs --brand QPRO1
 *   node bin/count-promos-ytd.mjs --json
 */
import { getAllPromotions } from '../src/api-client.js';
import { QP2_BRAND_TO_IDS } from '../src/api-mapper-qp2.js';
import { parseArgs } from './_args.js';

const { flags, positional } = parseArgs(process.argv.slice(2));
const jsonMode    = flags.json  === true;
const brandArg    = flags.brand === true ? positional[0] : flags.brand;
const brandFilter = brandArg ? String(brandArg).toUpperCase() : null;
const SLEEP_MS    = 400;
const YEAR        = '2026';
const EXCLUDE_TEST = flags['include-test'] !== true; // --include-test to count TEST_* codes

const MONTH_NAMES = {
  '01': 'Jan',
  '02': 'Feb',
  '03': 'Mar',
  '04': 'Apr',
  '05': 'May',
  '06': 'Jun',
  '07': 'Jul',
  '08': 'Aug',
  '09': 'Sep',
  '10': 'Oct',
  '11': 'Nov',
  '12': 'Dec',
};

function generateRemainingWeeks(startDateStr, startWeekNum) {
  const weeks = [];
  const year = Number(YEAR);
  const fmt = (s) => `${s.slice(8)}/${s.slice(5, 7)}`;
  let d = new Date(`${startDateStr}T00:00:00Z`);
  let weekNum = startWeekNum;

  while (d.getUTCFullYear() === year) {
    const from = d.toISOString().slice(0, 10);
    const toDate = new Date(d);
    toDate.setUTCDate(toDate.getUTCDate() + 4);
    if (toDate.getUTCFullYear() > year) {
      toDate.setUTCFullYear(year, 11, 31);
    }
    const to = toDate.toISOString().slice(0, 10);
    const label = `W${String(weekNum).padStart(2, '0')} ${fmt(from)}–${fmt(to)}`;
    weeks.push({ label, from, to });

    d.setUTCDate(d.getUTCDate() + 7);
    weekNum++;
  }

  return weeks;
}

// ── Weekly report date windows (Mon–Fri or Mon–Mon) ───────────────────────
const WEEKS = [
  { label: 'W01 02/01–09/01', from: '2026-01-02', to: '2026-01-09' },
  { label: 'W02 12/01–16/01', from: '2026-01-12', to: '2026-01-16' },
  { label: 'W03 19/01–23/01', from: '2026-01-19', to: '2026-01-23' },
  { label: 'W04 26/01–30/01', from: '2026-01-26', to: '2026-01-30' },
  { label: 'W05 02/02–06/02', from: '2026-02-02', to: '2026-02-06' },
  { label: 'W06 09/02–13/02', from: '2026-02-09', to: '2026-02-13' },
  { label: 'W07 16/02–20/02', from: '2026-02-16', to: '2026-02-20' },
  { label: 'W08 23/02–27/02', from: '2026-02-23', to: '2026-02-27' },
  { label: 'W09 02/03–06/03', from: '2026-03-02', to: '2026-03-06' },
  { label: 'W10 09/03–13/03', from: '2026-03-09', to: '2026-03-13' },
  { label: 'W11 16/03–20/03', from: '2026-03-16', to: '2026-03-20' },
  { label: 'W12 23/03–27/03', from: '2026-03-23', to: '2026-03-27' },
  { label: 'W13 30/03–03/04', from: '2026-03-30', to: '2026-04-03' },
  { label: 'W14 06/04–10/04', from: '2026-04-06', to: '2026-04-10' },
  { label: 'W15 13/04–17/04', from: '2026-04-13', to: '2026-04-17' },
  { label: 'W16 20/04–24/04', from: '2026-04-20', to: '2026-04-24' },
  { label: 'W17 27/04–01/05', from: '2026-04-27', to: '2026-05-01' },
  { label: 'W18 04/05–08/05', from: '2026-05-04', to: '2026-05-08' },
  { label: 'W19 11/05–18/05', from: '2026-05-11', to: '2026-05-18' },
  ...generateRemainingWeeks('2026-05-18', 20),
];

// Buckets: one per week + an "other" bucket for dates that fall in gaps
const WEEK_LABELS   = WEEKS.map(w => w.label);
const WEEK_FROM_MS  = WEEKS.map(w => new Date(w.from + 'T00:00:00Z').getTime());
const WEEK_TO_MS    = WEEKS.map(w => new Date(w.to   + 'T23:59:59Z').getTime());

function assignWeek(createdAt) {
  const t = new Date(createdAt).getTime();
  for (let i = 0; i < WEEKS.length; i++) {
    if (t >= WEEK_FROM_MS[i] && t <= WEEK_TO_MS[i]) return WEEK_LABELS[i];
  }
  return 'other';
}

// Month derived from created_at for monthly subtotals
function createdMonth(createdAt) {
  const m = new Date(createdAt).toISOString().slice(5, 7);
  return MONTH_NAMES[m] ?? m;
}

// ── Brand list ────────────────────────────────────────────────────────────

const QPRO_BRANDS = Array.from({ length: 17 }, (_, i) => ({
  brand: `QPRO${i + 1}`,
  siteId: `qpro${i + 1}`,
  merchantId: null,
  platform: 'qpro',
}));

// QP2 is treated as one logical unit: fetch all 4 merchants, de-dupe by code
const QP2_MERCHANTS = Object.entries(QP2_BRAND_TO_IDS).map(([brand, ids]) => ({
  brand,
  siteId: 'ibc22',
  merchantId: ids.merchantId,
}));

const QPRO_ONLY = QPRO_BRANDS.filter(b => !brandFilter || b.brand === brandFilter);
const INCLUDE_QP2 = !brandFilter || brandFilter.startsWith('QP2');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ─────────────────────────────────────────────────────────────────

const weekCounts  = Object.fromEntries([...WEEK_LABELS, 'other'].map(l => [l, 0]));
const monthTotals = {};
const brandTotals = {};
let grand = 0;
let testSkipped = 0;

const totalBrands = QPRO_ONLY.length + (INCLUDE_QP2 ? 1 : 0); // QP2 counts as one
console.log(`Querying ${totalBrands} brand BOs${brandFilter ? ` (${brandFilter})` : ''}...\n`);

// ── QPRO brands (each has its own BO) ────────────────────────────────────
for (const { brand, siteId } of QPRO_ONLY) {
  process.stdout.write(`  ${brand.padEnd(8)} `);
  try {
    const { rows } = await getAllPromotions(siteId, {
      perPage: 500, status: 1, sortBy: 'id', sortOrder: 'desc',
    });

    const ytd = rows.filter(r => r.created_at?.startsWith(YEAR));
    let brandCount = 0;

    for (const r of ytd) {
      if (EXCLUDE_TEST && /^TEST_/i.test(r.code)) { testSkipped++; continue; }
      const week  = assignWeek(r.created_at);
      const month = createdMonth(r.created_at);
      weekCounts[week]++;
      monthTotals[month] = (monthTotals[month] || 0) + 1;
      brandCount++;
    }

    brandTotals[brand] = brandCount;
    grand += brandCount;
    const skipped = ytd.length - brandCount;
    process.stdout.write(`→ ${String(brandCount).padStart(4)} real${skipped > 0 ? ` (${skipped} TEST_ skipped)` : ''}\n`);
  } catch (err) {
    process.stdout.write(`→ ERROR: ${err.message.substring(0, 70)}\n`);
    brandTotals[brand] = 0;
  }
  await sleep(SLEEP_MS);
}

// ── QP2 — one BO, 4 merchants, de-dupe by code ───────────────────────────
if (INCLUDE_QP2) {
  process.stdout.write(`  QP2      `);
  try {
    const seenCodes = new Map(); // code → { created_at, brand }

    for (const { brand, merchantId } of QP2_MERCHANTS) {
      const { rows } = await getAllPromotions('ibc22', {
        perPage: 500, status: 1, merchantId, sortBy: 'id', sortOrder: 'desc',
      });
      for (const r of rows) {
        if (!r.created_at?.startsWith(YEAR)) continue;
        if (!seenCodes.has(r.code)) seenCodes.set(r.code, { created_at: r.created_at, brand });
      }
      await sleep(SLEEP_MS);
    }

    let qp2Count = 0;
    let qp2Test = 0;
    for (const [code, { created_at }] of seenCodes) {
      if (EXCLUDE_TEST && /^TEST_/i.test(code)) { qp2Test++; testSkipped++; continue; }
      const week  = assignWeek(created_at);
      const month = createdMonth(created_at);
      weekCounts[week]++;
      monthTotals[month] = (monthTotals[month] || 0) + 1;
      qp2Count++;
    }

    brandTotals['QP2 (de-duped)'] = qp2Count;
    grand += qp2Count;
    process.stdout.write(`→ ${String(qp2Count).padStart(4)} real unique codes (${seenCodes.size} total${qp2Test > 0 ? `, ${qp2Test} TEST_ skipped` : ''})\n`);
  } catch (err) {
    process.stdout.write(`→ ERROR: ${err.message.substring(0, 70)}\n`);
    brandTotals['QP2 (de-duped)'] = 0;
  }
}

if (jsonMode) {
  console.log(JSON.stringify({ grand, byWeek: weekCounts, byMonth: monthTotals, byBrand: brandTotals }, null, 2));
  process.exit(0);
}

// ── Weekly table ──────────────────────────────────────────────────────────
console.log('\n');
const weeksByMonth = {};
for (const w of WEEKS) {
  const m = MONTH_NAMES[w.from.slice(5, 7)] ?? '?';
  (weeksByMonth[m] = weeksByMonth[m] || []).push(w.label);
}
const MONTH_ORDER = [...new Set(WEEKS.map(w => MONTH_NAMES[w.from.slice(5, 7)] ?? w.from.slice(5, 7)))];

console.log('┌──────────────────────────────────┬──────────┐');
console.log('│ Week                             │  Promos  │');
console.log('├──────────────────────────────────┼──────────┤');

for (const month of MONTH_ORDER) {
  const weeks = weeksByMonth[month] || [];
  for (const wl of weeks) {
    console.log(`│ ${wl.padEnd(32)} │ ${String(weekCounts[wl] || 0).padStart(8)} │`);
  }
  const mCount = monthTotals[month] || 0;
  console.log(`│ ${'  ↳ ' + month + ' subtotal'.padEnd(30)} │ ${String(mCount).padStart(8)} │`);
  console.log('├──────────────────────────────────┼──────────┤');
}

if (weekCounts.other > 0) {
  console.log(`│ ${'  (between-week dates)'.padEnd(32)} │ ${String(weekCounts.other).padStart(8)} │`);
  console.log('├──────────────────────────────────┼──────────┤');
}

console.log(`│ ${'TOTAL'.padEnd(32)} │ ${String(grand).padStart(8)} │`);
console.log('└──────────────────────────────────┴──────────┘');

console.log('\nPer-brand breakdown:');
for (const [b, n] of Object.entries(brandTotals)) {
  console.log(`  ${b.padEnd(8)} ${String(n).padStart(5)}`);
}

if (testSkipped > 0) {
  console.log(`\n  (${testSkipped} TEST_* codes excluded — run with --include-test to count them)`);
}
const firstWeek = WEEKS[0].from;
const lastWeek = WEEKS[WEEKS.length - 1].to;
console.log(`\nDate range covered: ${firstWeek} → ${lastWeek}`);
console.log('Note: WS1 (MB8) and WS2 (RWS77) use BIA platform — not queried here.');
console.log('      Remaining gap ≈ WS1 + WS2 promos created in 2026.');
