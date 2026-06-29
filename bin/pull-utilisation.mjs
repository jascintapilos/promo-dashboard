/**
 * Pull YTD utilisation % from each team member's Work Hours Tracker
 * into the Weekly Report 'Utilisation' tab (Staff | % Utilisation | Notes).
 *
 * YTD % = work hours ÷ effective weekday hours × 100
 *
 * Numerator  — actual work hours only (AL/MC rows excluded)
 * Denominator — Mon–Fri weekday hours from Jan 1 to today
 *               minus hardcoded region PH weekdays × 8
 *               minus personal leave weekdays (AL/MC from tracker) × 8
 *               weekend hours logged go into numerator but NOT denominator
 *
 * PH lists confirmed via HR memo (MY), official SKB (ID), Slack + Telegram activity checks.
 * PH tagged rows in trackers are intentionally ignored — PH is handled via the hardcoded lists.
 *
 * Sources: individual Google Sheets in the Team Utilisation Drive folder.
 * Each sheet has monthly tabs (e.g. "JUNE", "Jun 2026", "June 2026").
 * Each tab: Date | Task/Name | BO | Duration (hrs) | Cumulative | Remaining | % | Remarks
 *
 * DRY RUN by default; --write commits.
 *
 * Usage:
 *   node bin/pull-utilisation.mjs
 *   node bin/pull-utilisation.mjs --write
 */
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';
import { parseArgs } from './_args.js';
import { getGoogleAuth, loadGoogleapis } from '../src/google-auth.js';

const { flags } = parseArgs(process.argv.slice(2));
const WRITE = flags.write === true;
const OPS_ID = getOpsSheetId();

const TRACKERS = [
  { name: 'Jascinta', id: '1z5IUbq4XwvihtyHH2jXU9lngh9FLvmvy-fAYbAcig00', region: 'MY' },
  { name: 'Wen',      id: '19EgP1nS3FRsOkTWjX6-LvcP0in3ZNWg17M7mQhd4YLU', region: 'MY' },
  { name: 'Alysa',    id: '1zbNGLJE4i0uGybLCTAalo5Ze0gLRe-iZmLUIEnySh8g', region: 'MY' },
  { name: 'Elyssa',   id: '1ml0O0kTaHfk9JdWuc9zGbhr1KKEEIeRQFWM-dPzBkos', region: 'MY', matLeaveFrom: '2026-06-22' },
  { name: 'Gaby',     id: '1s9Pw3nretdNlsRoMRnBC5SLUa_wpxIQoQuGjsNGxKFU', region: 'ID' },
  { name: 'Bangun',   id: '1EPtu6NUWj-rKBGdHQy8CafzpNbFP1Zca5z6n5G2EoQk', region: 'ID' },
  { name: 'Michelle', id: '1tBdE9qJO77_VckO-FU2DYIF-jaHnMig6H8KWgOyImjw', region: 'MY', resigned: true },
];

// Unrecorded personal leave days confirmed via TG morning-chain absence + Slack cross-check.
// These are weekdays where the person was absent but never logged AL/MC in their tracker.
// Each date reduces the effective-hours denominator by 8h, same as a tracked leave row.
const leaveOverrides = {
  Jascinta: ['2026-03-06', '2026-05-25', '2026-05-29', '2026-06-03', '2026-06-04'],
  Wen:      ['2026-03-06'],
  Alysa:    ['2026-05-04'],
  Elyssa:   ['2026-01-29', '2026-02-16', '2026-04-13', '2026-05-25', '2026-05-29'],
};

// Warn if leaveOverrides hasn't been reviewed in > 14 days — silently drifting overrides
// inflate the effective-hours denominator for absent members.
{
  const allDates = Object.values(leaveOverrides).flat();
  if (allDates.length) {
    const latest = allDates.reduce((a, b) => (a > b ? a : b));
    const daysSince = Math.floor((Date.now() - new Date(latest).getTime()) / 864e5);
    if (daysSince > 14) {
      console.warn(`⚠️  leaveOverrides last updated ${latest} (${daysSince} days ago). Review for unrecorded absences before pull.`);
    }
  }
}

// Hardcoded public holidays — weekdays only (Sat/Sun falls excluded; replacements included).
// MY: confirmed via HR memo + Slack (Mudita, Wai Yip announcements).
// ID: confirmed via official SKB + tracker zero-activity cross-check (Jun 2026).
const PH_WEEKDAYS = {
  MY: new Set([
    '2026-01-01', // New Year (Thu)
    '2026-02-02', // Thaipusam replacement (Mon; original 1 Feb Sun)
    '2026-02-17', // CNY Day 1 (Tue)
    '2026-02-18', // CNY Day 2 (Wed)
    '2026-03-20', // Hari Raya extra PH declared by PM (Fri)
    '2026-03-23', // Hari Raya replacement (Mon; original 22 Mar Sun)
    '2026-05-01', // Labour Day (Fri)
    '2026-05-27', // Hari Raya Haji (Wed)
    '2026-06-01', // Agong's Birthday (Mon)
    '2026-06-02', // Wesak replacement (Tue; Agong occupied Mon)
    '2026-06-17', // Awal Muharram (Wed)
    '2026-08-31', // Merdeka Day (Mon)
    '2026-09-16', // Malaysia Day (Wed)
    '2026-11-09', // Deepavali replacement (Mon; original 8 Nov Sun)
    '2026-12-11', // Sultan of Selangor's Birthday (Fri)
    '2026-12-25', // Christmas (Fri)
  ]),
  ID: new Set([
    '2026-01-01', // New Year (Thu)
    '2026-01-16', // Isra Miraj (Fri)
    '2026-02-17', // Chinese New Year (Tue)
    '2026-03-19', // Nyepi (Thu)
    '2026-03-23', // Eid al-Fitr replacement (Mon; original 21–22 Mar weekend)
    '2026-04-03', // Good Friday (Fri)
    '2026-05-01', // Labour Day (Fri)
    '2026-05-14', // Ascension Day (Thu)
    '2026-05-27', // Eid al-Adha (Wed)
    '2026-06-01', // Pancasila Day (Mon)
    '2026-06-16', // Islamic New Year (Tue)
    '2026-08-17', // Independence Day (Mon)
    '2026-08-25', // Prophet's Birthday (Tue)
    '2026-12-25', // Christmas (Fri)
  ]),
};

// Count Mon–Fri weekdays from startDate to endDate (inclusive) × 8hrs.
// endDate defaults to today.
function weekdayHoursSince(startDate, endDate) {
  const end = new Date(endDate || new Date()); end.setHours(0,0,0,0);
  const start = new Date(startDate); start.setHours(0,0,0,0);
  let days = 0;
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) days++;
  }
  return days * 8;
}

// Count PH dates in this region between startKey and endKey (defaults to today).
function phDaysTaken(region, startKey, endKey) {
  const limitKey = endKey || dateKey(new Date());
  const set = PH_WEEKDAYS[region] || new Set();
  return [...set].filter(d => d >= startKey && d <= limitKey).length;
}

const today = new Date();
const YEAR = today.getFullYear();

// Month tab matching: returns all tab names that belong to the current year
const MONTH_ABBR = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const CUR_MONTH = today.getMonth(); // 0-based
function isCurrentYearTab(title) {
  const t = title.toLowerCase().trim();
  // Has current year → include
  if (t.includes(String(YEAR))) return true;
  // Has any other 4-digit year → exclude (e.g. "May 2025")
  if (/\b20\d{2}\b/.test(t)) return false;
  // No year: include only if month index ≤ current month.
  // This excludes DEC/NOV etc. which are prior-year carryover tabs in the same sheet,
  // and future months that haven't happened yet.
  return MONTH_ABBR.some((m, i) => i <= CUR_MONTH && t.startsWith(m));
}

// Parse DD/MM/YYYY → Date (returns null if unparseable)
function parseDMY(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}

// Matches personal leave only (AL / MC). PH is now handled via hardcoded PH_WEEKDAYS —
// do NOT match PH here to avoid double-subtracting if anyone ever logs a PH row.
const LEAVE_RE = /\b(AL|annual\s*leave|MC|medical(\s*(leave|cert(ificate)?))?\s*$)\b/i;

function isLeaveRow(row) {
  const task    = String(row[1] || '').trim();
  const remarks = String(row[7] || '').trim();
  return LEAVE_RE.test(task) || LEAVE_RE.test(remarks);
}

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Returns ISO week Monday (YYYY-MM-DD) for a given date
function weekMon(d) {
  const copy = new Date(d);
  const dow = copy.getDay(); // 0=Sun
  copy.setDate(copy.getDate() - (dow === 0 ? 6 : dow - 1));
  copy.setHours(0, 0, 0, 0);
  return dateKey(copy);
}

// Build a Map of weekMon (YYYY-MM-DD) → expected work hours for a person.
// Starts at their first logged date, ends at today (or endDate if resigned).
// Subtracts region PHs and personal leave/AL/override days.
// matLeaveFrom (YYYY-MM-DD): weeks starting on/after this date get 0 expected hours.
function weeklyExpectedMap(region, allLeaveDays, startDate, endDate, matLeaveFrom) {
  const result = new Map();
  const phSet = PH_WEEKDAYS[region] || new Set();
  const start = new Date(startDate); start.setHours(0, 0, 0, 0);
  const end = endDate ? new Date(endDate) : new Date(today); end.setHours(0, 0, 0, 0);
  // Start from the Monday of the week that contains startDate
  const cur = new Date(start);
  const dow0 = cur.getDay();
  cur.setDate(cur.getDate() - (dow0 === 0 ? 6 : dow0 - 1));
  while (cur <= end) {
    const wk = dateKey(cur);
    // Weeks on/after maternity leave start have 0 expected hours
    if (matLeaveFrom && wk >= matLeaveFrom) {
      result.set(wk, 0);
    } else {
      let exp = 0;
      for (let i = 0; i < 5; i++) {
        const day = new Date(cur); day.setDate(cur.getDate() + i);
        if (day < start || day > end) continue;
        const dk = dateKey(day);
        if (!phSet.has(dk) && !allLeaveDays.has(dk)) exp += 8;
      }
      result.set(wk, exp);
    }
    cur.setDate(cur.getDate() + 7);
  }
  return result;
}

// Sum Duration (col D) values in a tab.
// - Leave rows (AL/PH/MC) are excluded from hours total.
// - Leave weekday dates are tracked to reduce the denominator.
// - Weekend work dates are tracked (hours count in numerator, not denominator).
// - Also tracks earliest + latest dates a non-leave hour was logged (start/end detection).
// Returns { hours, weekendDays: Set<dateKey>, leaveDays: Set<dateKey>, minDate: Date|null, maxDate: Date|null }
async function sumTabHours(spreadsheetId, tabTitle) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabTitle}'!A:H`,
  });
  const rows = res.data.values || [];
  let total = 0;
  const weekendDays = new Set();
  const leaveDays   = new Set();
  const weeklyH     = new Map();
  let curDate = null;
  let minDate = null;
  let maxDate = null;

  for (const r of rows) {
    const parsed = parseDMY(r[0]);
    if (parsed) curDate = parsed;

    const n = parseFloat(r[3]);
    if (!isNaN(n) && n > 0 && n < 24) {
      if (isLeaveRow(r)) {
        if (curDate) {
          const dow = curDate.getDay();
          if (dow !== 0 && dow !== 6) leaveDays.add(dateKey(curDate));
        }
      } else {
        total += n;
        if (curDate) {
          const dow = curDate.getDay();
          if (dow === 0 || dow === 6) weekendDays.add(dateKey(curDate));
          if (!minDate || curDate < minDate) minDate = new Date(curDate);
          if (!maxDate || curDate > maxDate) maxDate = new Date(curDate);
          const wk = weekMon(curDate);
          weeklyH.set(wk, (weeklyH.get(wk) || 0) + n);
        }
      }
    }
  }
  return { hours: total, weekendDays, leaveDays, weeklyH, minDate, maxDate };
}

// Root Drive folder that contains all monthly "Weekly Report (Mmm YYYY)" subfolders.
const WEEKLY_REPORTS_ROOT = '1SvTyOPxDCVnPjmYU-XjMlOupQ2M1T_8P';

// Parse "D/M/YY" from "Weekly Report 11/5/26-15/5/26" → ISO date of that Monday.
function parseTitleWeek(title) {
  const m = title.match(/(\d{1,2})\/(\d{1,2})\/(\d{2})/);
  if (!m) return null;
  return dateKey(new Date(2000 + +m[3], +m[2] - 1, +m[1]));
}

// Read every Weekly Report across all monthly subfolders, extract actual + expected
// hours for `staffName` from the Utilisation tab, and return per-week maps.
// Falls back to this when the individual tracker sheet is inaccessible.
async function pullWeeklyReportFallback(staffName) {
  const { client: auth } = await getGoogleAuth();
  const { google } = await loadGoogleapis();
  const drive = google.drive({ version: 'v3', auth });

  // Drive API requires supportsAllDrives+includeItemsFromAllDrives for shared org folders.
  const driveList = opts => drive.files.list({ ...opts, supportsAllDrives: true, includeItemsFromAllDrives: true });

  // List all monthly subfolders under the root
  const foldersRes = await driveList({
    q: `'${WEEKLY_REPORTS_ROOT}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
    pageSize: 30,
  });
  const folders = foldersRes.data.files || [];

  const weeklyH   = new Map(); // weekMon YYYY-MM-DD → actual hours
  const weeklyExp = new Map(); // weekMon YYYY-MM-DD → expected hours

  for (const folder of folders) {
    const listRes = await driveList({
      q: `'${folder.id}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
      fields: 'files(id,name)',
      pageSize: 20,
    });
    for (const file of (listRes.data.files || [])) {
      const weekStart = parseTitleWeek(file.name);
      if (!weekStart || !weekStart.startsWith(String(YEAR))) continue; // skip non-current-year
      try {
        // Directly read the Utilisation tab — skip file if tab doesn't exist
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: file.id,
          range: "'Utilisation'!A:F",
        });
        const rows = (res.data.values || []).slice(1); // drop header
        const row  = rows.find(r => String(r[0] || '').trim().toLowerCase() === staffName.toLowerCase());
        if (!row) continue;
        const expH = parseFloat(row[2]) || 0; // col C: Expected Hours
        const actH = parseFloat(row[3]) || 0; // col D: Actual Hours Logged
        if (expH > 0) {
          weeklyH.set(weekStart, actH);
          weeklyExp.set(weekStart, expH);
        }
      } catch (_) {
        // Tab missing or file unreadable — skip silently
      }
      await sleep(150);
    }
  }
  return { weeklyH, weeklyExp };
}

const { sheets } = await getSheetsClient();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getUtilisation(tracker) {
  if (!tracker.id) return { hours: null, pct: null, effectiveHours: null, startKey: null, endKey: null, notes: 'No tracker' };
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: tracker.id, fields: 'sheets.properties' });
    const allTabs = meta.data.sheets.map(s => s.properties.title);
    const yearTabs = allTabs.filter(isCurrentYearTab);

    if (!yearTabs.length) return { hours: 0, pct: 0, effectiveHours: 0, startKey: null, endKey: null, notes: 'No data' };

    let totalHours = 0;
    const allWeekendDays = new Set();
    const allLeaveDays   = new Set();
    const allWeeklyH     = new Map();
    let personMinDate = null;
    let personMaxDate = null;
    for (const tab of yearTabs) {
      const { hours, weekendDays, leaveDays, weeklyH, minDate, maxDate } = await sumTabHours(tracker.id, tab);
      totalHours += hours;
      for (const d of weekendDays) allWeekendDays.add(d);
      for (const d of leaveDays)   allLeaveDays.add(d);
      for (const [wk, h] of weeklyH) allWeeklyH.set(wk, (allWeeklyH.get(wk) || 0) + h);
      if (minDate && (!personMinDate || minDate < personMinDate)) personMinDate = minDate;
      if (maxDate && (!personMaxDate || maxDate > personMaxDate)) personMaxDate = maxDate;
      await sleep(300); // stay within Sheets API read quota
    }

    // Denominator = weekday hours from person's first logged date to:
    //   - their last logged date (if resigned)
    //   - today (if active)
    // PHs and AL are only counted within that window.
    const startDate = personMinDate || new Date(today.getFullYear(), 0, 1);
    const endDate   = tracker.resigned && personMaxDate ? personMaxDate : null; // null = today
    const startKey  = dateKey(startDate);
    const endKey    = endDate ? dateKey(endDate) : null;
    const personWeekdayHours = weekdayHoursSince(startDate, endDate);
    const phDays = phDaysTaken(tracker.region || 'MY', startKey, endKey);
    // Merge unrecorded leave overrides into allLeaveDays (only if within the person's date window)
    const overrides = leaveOverrides[tracker.name] || [];
    for (const d of overrides) {
      if (d >= startKey && (!endKey || d <= endKey)) allLeaveDays.add(d);
    }
    // Maternity leave: subtract weekdays from ML start to today from the denominator.
    // pct is set to null (excluded from team average) while ML is active.
    const matLeaveFrom = tracker.matLeaveFrom || null;
    const onMatLeave = matLeaveFrom && dateKey(new Date()) >= matLeaveFrom;
    const mlDays = matLeaveFrom ? weekdayHoursSince(
      new Date(matLeaveFrom),
      endDate || new Date(),
    ) / 8 : 0;
    const effectiveHours = Math.max(0, personWeekdayHours - phDays * 8 - allLeaveDays.size * 8 - mlDays * 8);
    const pct = onMatLeave ? null : (effectiveHours > 0 ? (totalHours / effectiveHours) * 100 : 0);
    const weeklyExp = weeklyExpectedMap(tracker.region, allLeaveDays, startDate, endDate, matLeaveFrom);
    return { hours: totalHours, pct, weekendDays: allWeekendDays.size, leaveDays: allLeaveDays.size, phDays, effectiveHours, startKey, endKey, weeklyH: Object.fromEntries(allWeeklyH), weeklyExp: Object.fromEntries(weeklyExp), notes: onMatLeave ? 'Maternity leave' : '' };
  } catch (e) {
    const errSnip = e.message.slice(0, 60);
    process.stdout.write(`\n    ↳ tracker error (${errSnip}) — trying Weekly Report fallback… `);
    try {
      const fb = await pullWeeklyReportFallback(tracker.name);
      if (fb.weeklyH.size === 0) {
        return { hours: null, pct: null, weekendDays: 0, leaveDays: 0, effectiveHours: null, startKey: null, endKey: null, notes: `Error: ${errSnip}` };
      }
      const hours = [...fb.weeklyH.values()].reduce((s, h) => s + h, 0);
      const effectiveHours = [...fb.weeklyExp.values()].reduce((s, h) => s + h, 0);
      const pct = effectiveHours > 0 ? hours / effectiveHours * 100 : 0;
      const allWeeks = [...fb.weeklyExp.keys()].sort();
      const startKey = allWeeks[0] || null;
      const endKey   = tracker.resigned && allWeeks.length ? allWeeks[allWeeks.length - 1] : null;
      process.stdout.write(`OK (${fb.weeklyH.size} weeks)\n    `);
      return {
        hours, pct, weekendDays: 0, leaveDays: 0, phDays: 0, effectiveHours,
        startKey, endKey,
        weeklyH:   Object.fromEntries(fb.weeklyH),
        weeklyExp: Object.fromEntries(fb.weeklyExp),
        notes: '', fallback: true,
      };
    } catch (e2) {
      return { hours: null, pct: null, weekendDays: 0, leaveDays: 0, effectiveHours: null, startKey: null, endKey: null, notes: `Error: ${errSnip}` };
    }
  }
}

console.log(`\nUtilisation pull — start-date aware  (${WRITE ? 'WRITE' : 'DRY RUN'})`);
console.log(`  +we = weekend days worked (numerator only)`);
console.log(`  -PH = region public holidays from start date (hardcoded)`);
console.log(`  -AL = personal leave taken (AL/MC from tracker)\n`);

const results = [];
for (const t of TRACKERS) {
  process.stdout.write(`  ${t.name.padEnd(12)} `);
  const { hours, pct, weekendDays, leaveDays, phDays, effectiveHours, startKey, endKey, weeklyH, weeklyExp, notes: baseNotes, fallback } = await getUtilisation(t);
  const notes = t.leave || baseNotes;
  const display = pct === null ? '—' : pct.toFixed(1) + '%';
  const hrsLabel = hours !== null
    ? `(${hours.toFixed(1)}h / ${effectiveHours}h`
      + (startKey ? ` from ${startKey}` : '')
      + (endKey   ? ` to ${endKey}`     : '')
      + (weekendDays ? ` +${weekendDays}we` : '')
      + (phDays      ? ` -${phDays}PH`      : '')
      + (leaveDays   ? ` -${leaveDays}AL`   : '')
      + ')'
    : '';
  console.log(`${display.padEnd(8)} ${hrsLabel.padEnd(50)} ${notes}`);
  results.push({ staff: t.name, pct, hours, weekendDays, leaveDays, phDays, effectiveHours, startKey, endKey, weeklyH: weeklyH || {}, weeklyExp: weeklyExp || {}, notes, fallback: !!fallback });
}

// Team average: only active members with data (excludes error rows; WR fallback counts as data)
const withData = results.filter(r => r.pct !== null && (!r.notes || r.fallback));
const avg = withData.length ? withData.reduce((s, r) => s + r.pct, 0) / withData.length : null;
console.log(`\n  ${'Total'.padEnd(12)} ${avg === null ? '—' : avg.toFixed(1) + '%'}`);

if (WRITE) {
  const rows = [
    ['Staff', '% Utilisation', 'Notes'],
    ...results.map(r => {
      const breakdown = (r.notes && !r.fallback) ? r.notes
        : r.hours !== null
          ? `${r.hours.toFixed(1)}h / ${r.effectiveHours}h`
            + (r.weekendDays ? ` +${r.weekendDays}we` : '')
            + (r.phDays      ? ` -${r.phDays}PH`      : '')
            + (r.leaveDays   ? ` -${r.leaveDays}AL`   : '')
            + (r.fallback    ? ' (WR)'                 : '')
          : '';
      return [r.staff, r.pct === null ? '' : r.pct.toFixed(1) + '%', breakdown];
    }),
    ['Total', avg === null ? '' : avg.toFixed(1) + '%', ''],
  ];
  await sheets.spreadsheets.values.clear({ spreadsheetId: OPS_ID, range: "'Utilisation'!A:C" });
  await sheets.spreadsheets.values.update({
    spreadsheetId: OPS_ID, range: "'Utilisation'!A1",
    valueInputOption: 'RAW', requestBody: { values: rows },
  });
  console.log(`\n✅ Wrote ${results.length} members + Total to 'Utilisation'.`);

  // ── Weekly breakdown tab ──────────────────────────────────────────────────
  const WEEKLY_TAB = 'Utilisation Weekly';
  const allWeeks = [...new Set([
    ...results.flatMap(r => Object.keys(r.weeklyH || {})),
    ...results.flatMap(r => Object.keys(r.weeklyExp || {})),
  ])].sort();
  const weeklyRows = [
    ['Week', 'Staff', 'Hours', 'Expected'],
    ...allWeeks.flatMap(wk =>
      results
        .filter(r => !r.notes || r.fallback) // skip error rows; WR fallback has real weekly data
        .filter(r => r.weeklyExp?.[wk] !== undefined) // only write rows within employment window
        .map(r => [wk, r.staff, Number((r.weeklyH?.[wk] || 0).toFixed(1)), r.weeklyExp[wk]])
    ),
  ];
  const metaW = await sheets.spreadsheets.get({ spreadsheetId: OPS_ID, fields: 'sheets.properties.title' });
  const weeklyTabExists = metaW.data.sheets.some(s => s.properties.title === WEEKLY_TAB);
  if (!weeklyTabExists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: OPS_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: WEEKLY_TAB } } }] },
    });
    console.log(`Created '${WEEKLY_TAB}' tab`);
  }
  await sheets.spreadsheets.values.clear({ spreadsheetId: OPS_ID, range: `'${WEEKLY_TAB}'!A:D` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: OPS_ID, range: `'${WEEKLY_TAB}'!A1`,
    valueInputOption: 'RAW', requestBody: { values: weeklyRows },
  });
  console.log(`✅ Wrote ${weeklyRows.length - 1} weekly rows to '${WEEKLY_TAB}'.`);
} else {
  console.log(`\n(DRY RUN — re-run with --write to commit.)`);
}
