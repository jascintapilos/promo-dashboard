/**
 * Check Gaby + Bangun's Work Hours Trackers for activity on candidate ID PH dates.
 * No rows logged on a date → likely PH (or at minimum not a working day).
 */
import { getSheetsClient } from '../src/sheets-client.js';

const TRACKERS = [
  { name: 'Gaby',   id: '1s9Pw3nretdNlsRoMRnBC5SLUa_wpxIQoQuGjsNGxKFU' },
  { name: 'Bangun', id: '1EPtu6NUWj-rKBGdHQy8CafzpNbFP1Zca5z6n5G2EoQk' },
];

// Candidate ID PH dates to verify (confirmed ones included for cross-check)
const CANDIDATE_PH = [
  { date: '2026-01-01', label: 'New Year (universal)' },
  { date: '2026-01-16', label: 'Isra Miraj' },
  { date: '2026-02-17', label: 'Chinese New Year' },
  { date: '2026-03-19', label: 'Nyepi' },
  { date: '2026-03-21', label: 'Eid al-Fitr Day1 (Sat)' },
  { date: '2026-03-22', label: 'Eid al-Fitr Day2 (Sun)' },
  { date: '2026-03-23', label: 'Eid replacement (Mon) — TG confirmed' },
  { date: '2026-04-03', label: 'Good Friday' },
  { date: '2026-04-05', label: 'Easter Sunday' },
  { date: '2026-05-01', label: 'Labour Day (universal)' },
  { date: '2026-05-14', label: 'Ascension Day — Gaby confirmed' },
  { date: '2026-05-27', label: 'Eid al-Adha' },
  { date: '2026-05-31', label: 'Vesak (Sun)' },
  { date: '2026-06-01', label: 'Pancasila Day — IDN group was active?' },
  { date: '2026-06-16', label: 'Islamic New Year' },
];

function parseDMY(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` : null;
}

const MONTH_ABBR = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const today = new Date();
const YEAR = today.getFullYear();
const CUR_MONTH = today.getMonth();

function isCurrentYearTab(title) {
  const t = title.toLowerCase().trim();
  if (t.includes(String(YEAR))) return true;
  if (/\b20\d{2}\b/.test(t)) return false;
  return MONTH_ABBR.some((m, i) => i <= CUR_MONTH && t.startsWith(m));
}

const { sheets } = await getSheetsClient();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Build dateKey → total hours map for each person
async function buildDateMap(tracker) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: tracker.id, fields: 'sheets.properties' });
  const tabs = meta.data.sheets.map(s => s.properties.title).filter(isCurrentYearTab);

  const dateMap = {}; // dateKey → { hours, rows }

  for (const tab of tabs) {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: tracker.id, range: `'${tab}'!A:H` });
    const rows = res.data.values || [];
    let curDate = null;
    for (const row of rows) {
      const dk = parseDMY(row[0]);
      if (dk) curDate = dk;
      if (!curDate) continue;
      const n = parseFloat(row[3]);
      if (!isNaN(n) && n > 0 && n < 24) {
        if (!dateMap[curDate]) dateMap[curDate] = { hours: 0, tasks: [] };
        dateMap[curDate].hours += n;
        const task = String(row[1] || '').trim();
        if (task) dateMap[curDate].tasks.push(task);
      }
    }
    await sleep(300);
  }
  return dateMap;
}

console.log('\nID Public Holiday verification — checking tracker activity\n');
console.log(`${'Date'.padEnd(12)} ${'Holiday'.padEnd(42)} ${'Gaby'.padEnd(22)} ${'Bangun'.padEnd(22)}`);
console.log('─'.repeat(100));

const [gabyMap, bangunMap] = await Promise.all([
  buildDateMap(TRACKERS[0]),
  buildDateMap(TRACKERS[1]),
]);

for (const { date, label } of CANDIDATE_PH) {
  const g = gabyMap[date];
  const b = bangunMap[date];
  const gStr = g ? `${g.hours.toFixed(1)}h worked` : 'NO ACTIVITY ✓';
  const bStr = b ? `${b.hours.toFixed(1)}h worked` : 'NO ACTIVITY ✓';
  const phFlag = !g && !b ? ' ← PH' : (g || b) ? ' ← WORKED' : '';
  console.log(`${date}  ${label.padEnd(42)} ${gStr.padEnd(22)} ${bStr.padEnd(22)}${phFlag}`);
}

console.log('\nDone.');
