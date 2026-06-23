#!/usr/bin/env node
/**
 * V65 — Calendar module wired to Google Calendar via CalendarApp
 *
 *  Adds three things:
 *    1. Calendar OAuth scope in appsscript manifest so the script can read
 *       events.
 *    2. serverGetUpcomingEvents() — reads the next 30 days from the
 *       executor's default Google Calendar (i.e. Jascinta's calendar under
 *       the current executeAs=USER_DEPLOYING setup; acts as the team
 *       calendar for all viewers).
 *    3. renderCalendar() — clean event list grouped by date, with type
 *       indicators (today / upcoming / all-day) + a Refresh button. Wired
 *       into renderView() so the Calendar sidebar item finally works.
 */
import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

async function api(method, url, body) {
  const r = await fetch(`https://script.googleapis.com/v1${url}`, {
    method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
  return r.json();
}

const proj = await api('GET', `/projects/${SCRIPT_ID}/content`);
const dashIdx = proj.files.findIndex(f => f.name === 'Dashboard');
const codeIdx = proj.files.findIndex(f => f.name === 'Code');
const mfIdx   = proj.files.findIndex(f => f.name === 'appsscript');
let dash = proj.files[dashIdx].source;
let code = proj.files[codeIdx].source;
let mf   = proj.files[mfIdx].source;

let pass = 0, fail = 0;
function patch(label, target, oldStr, newStr) {
  let src;
  if (target === 'dash') src = dash;
  else if (target === 'code') src = code;
  else                       src = mf;
  if (src.includes(oldStr)) {
    if (target === 'dash')      dash = src.replace(oldStr, newStr);
    else if (target === 'code') code = src.replace(oldStr, newStr);
    else                        mf   = src.replace(oldStr, newStr);
    console.log('✓ ' + label);
    pass++;
    return true;
  }
  console.error('✗ WARN: ' + label + ' — anchor not found');
  fail++;
  return false;
}

// ─── 1. Add Calendar scope to manifest ──────────────────────────────────────
patch('Manifest — add CalendarApp scope',
  'manifest',
  `    "https://www.googleapis.com/auth/script.scriptapp"
  ]`,
  `    "https://www.googleapis.com/auth/script.scriptapp",
    "https://www.googleapis.com/auth/calendar.readonly"
  ]`);

// ─── 2. Add server function serverGetUpcomingEvents ─────────────────────────
patch('Server — add serverGetUpcomingEvents',
  'code',
  `function serverQuickUpdateTask(taskId, status) {
  return serverUpdateTask(taskId, { Status: status });
}`,
  `function serverQuickUpdateTask(taskId, status) {
  return serverUpdateTask(taskId, { Status: status });
}

// ─────────────────────────────────────────────────────────────────────────────
// CALENDAR
// ─────────────────────────────────────────────────────────────────────────────

function serverGetUpcomingEvents() {
  try {
    var cal = CalendarApp.getDefaultCalendar();
    if (!cal) return { ok: false, error: 'No default calendar' };
    var start = new Date(); start.setHours(0, 0, 0, 0);
    var end   = new Date(); end.setDate(end.getDate() + 30);
    var events = cal.getEvents(start, end);
    var rows = events.slice(0, 100).map(function(e){
      var s = e.getStartTime();
      var t = e.getEndTime();
      var allDay = e.isAllDayEvent();
      return {
        id:        e.getId(),
        title:     e.getTitle() || '(no title)',
        start:     s.toISOString(),
        end:       t.toISOString(),
        allDay:    allDay,
        location:  e.getLocation() || '',
        description: (e.getDescription() || '').slice(0, 240),
        creators:  (e.getCreators() || []).join(', '),
        guests:    (e.getGuestList() || []).length,
        color:     e.getColor ? e.getColor() : '',
      };
    });
    return {
      ok: true,
      calendarName: cal.getName(),
      calendarId:   cal.getId(),
      from:         start.toISOString(),
      to:           end.toISOString(),
      events:       rows,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}`);

// ─── 3. Wire Calendar case in renderView ────────────────────────────────────
patch('renderView — add calendar case',
  'dash',
  `  switch(v) {
    case 'overview':    renderOverview(); break;
    case 'tasks':       renderTasks(); break;
    case 'promos':      renderPromos(); break;
    case 'banners':     renderBanners(); break;
    case 'reports':     renderReports(); break;
    case 'settings':    renderSettings(); break;
    default:            renderComingSoon(titles[v] || v);
  }`,
  `  switch(v) {
    case 'overview':    renderOverview(); break;
    case 'tasks':       renderTasks(); break;
    case 'promos':      renderPromos(); break;
    case 'banners':     renderBanners(); break;
    case 'calendar':    renderCalendar(); break;
    case 'reports':     renderReports(); break;
    case 'settings':    renderSettings(); break;
    default:            renderComingSoon(titles[v] || v);
  }`);

// ─── 4. Add renderCalendar client function ─────────────────────────────────
patch('Add renderCalendar function',
  'dash',
  `// =============================================================================
// PROMO CODES VIEW
// =============================================================================`,
  `// =============================================================================
// CALENDAR VIEW
// =============================================================================
function renderCalendar() {
  content('<div class="loading"><div class="spinner"></div>Syncing your Google Calendar…</div>');
  if (typeof google === 'undefined') {
    renderCalendarData_({ ok: false, error: 'Calendar API unavailable in preview mode' });
    return;
  }
  google.script.run
    .withSuccessHandler(renderCalendarData_)
    .withFailureHandler(function(e){ renderCalendarData_({ ok: false, error: (e && e.message) || 'Unknown error' }); })
    .serverGetUpcomingEvents();
}

function renderCalendarData_(data) {
  if (!data || !data.ok) {
    content(
      '<div class="card"><div class="card-body" style="text-align:center;padding:40px">' +
        '<div style="font-size:32px;margin-bottom:8px">📅</div>' +
        '<div style="font-size:14px;color:var(--text);font-weight:600;margin-bottom:6px">Calendar not available</div>' +
        '<div style="font-size:12px;color:var(--muted);max-width:420px;margin:0 auto;line-height:1.5">' +
          esc((data && data.error) || 'Could not read your Google Calendar.') +
          '<br>The Apps Script needs the Calendar scope authorised — visit the project once and accept the new permissions prompt.' +
        '</div>' +
      '</div></div>'
    );
    return;
  }
  var events = data.events || [];
  // Group by ISO date
  var byDay = {};
  events.forEach(function(e){
    var k = String(e.start).slice(0, 10);
    if (!byDay[k]) byDay[k] = [];
    byDay[k].push(e);
  });
  var dayKeys = Object.keys(byDay).sort();
  var today = new Date().toISOString().slice(0, 10);

  var totalCount = events.length;
  var todayCount = (byDay[today] || []).length;
  var weekCount  = events.filter(function(e){
    var d = new Date(e.start).getTime();
    return d >= Date.now() && d <= Date.now() + 7 * 86400000;
  }).length;

  var listHtml = dayKeys.length ? dayKeys.map(function(k){
    var d = new Date(k + 'T12:00:00');
    var isToday = (k === today);
    var dayLabel = isToday ? 'Today' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    var rows = byDay[k].map(function(e){
      var s = new Date(e.start);
      var t = new Date(e.end);
      var time = e.allDay ? 'All day' :
        s.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' – ' +
        t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      return '<div class="cal-event" style="display:grid;grid-template-columns:120px 1fr auto;gap:14px;align-items:start;padding:12px 16px;border-bottom:1px solid var(--border)">' +
        '<div style="font-size:11px;color:var(--muted);font-weight:600;font-family:\\'SF Mono\\',monospace">' + time + '</div>' +
        '<div>' +
          '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px">' + esc(e.title) + '</div>' +
          (e.location ? '<div style="font-size:11px;color:var(--muted)">📍 ' + esc(e.location) + '</div>' : '') +
          (e.description ? '<div style="font-size:11px;color:var(--muted);margin-top:3px;line-height:1.4">' + esc(e.description) + '</div>' : '') +
        '</div>' +
        '<div style="font-size:10px;color:var(--muted)">' + (e.guests ? '👥 ' + e.guests : '') + '</div>' +
      '</div>';
    }).join('');
    return '<div class="cal-day" style="margin-bottom:14px">' +
      '<div style="display:flex;align-items:center;gap:10px;padding:10px 16px;background:' + (isToday ? 'linear-gradient(90deg,rgba(124,58,237,.15),transparent)' : 'var(--card2)') + ';border-top:1px solid var(--border)">' +
        '<div style="font-size:12px;font-weight:700;color:' + (isToday ? 'var(--accent)' : 'var(--text)') + ';text-transform:uppercase;letter-spacing:.04em">' + dayLabel + '</div>' +
        '<div style="font-size:11px;color:var(--muted)">' + byDay[k].length + ' event' + (byDay[k].length !== 1 ? 's' : '') + '</div>' +
      '</div>' + rows +
    '</div>';
  }).join('') : '<div class="empty"><div class="empty-icon">📅</div><div>No upcoming events in the next 30 days</div></div>';

  content(
    '<div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">' +
      '<div class="kpi-card" style="border-top-color:#7c3aed"><div class="kpi-icon">📅</div><div class="kpi-value">' + totalCount + '</div><div class="kpi-label">Upcoming (30d)</div></div>' +
      '<div class="kpi-card" style="border-top-color:#ef4444"><div class="kpi-icon">⏰</div><div class="kpi-value">' + todayCount + '</div><div class="kpi-label">Today</div></div>' +
      '<div class="kpi-card" style="border-top-color:#0ea5e9"><div class="kpi-icon">📊</div><div class="kpi-value">' + weekCount + '</div><div class="kpi-label">This Week</div></div>' +
      '<div class="kpi-card" style="border-top-color:#10b981"><div class="kpi-icon">📆</div><div class="kpi-value" style="font-size:13px;line-height:1.3">' + esc(data.calendarName || '—') + '</div><div class="kpi-label">Calendar</div></div>' +
    '</div>' +
    '<div class="card">' +
      '<div class="card-hdr"><h3>🗓 Upcoming Events</h3>' +
        '<button class="btn btn-ghost btn-sm" onclick="renderCalendar()" style="margin-left:auto">↻ Refresh</button>' +
      '</div>' +
      '<div class="card-body" style="padding:0">' + listHtml + '</div>' +
    '</div>'
  );
}

// =============================================================================
// PROMO CODES VIEW
// =============================================================================`);

// Badge bump
patch('Badge V64 → V65', 'dash', `>V64 ✓</span>`, `>V65 ✓</span>`);

proj.files[dashIdx].source = dash;
proj.files[codeIdx].source = code;
proj.files[mfIdx].source = mf;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied, ' + fail + ' warnings');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V65 — Calendar sync via CalendarApp — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
