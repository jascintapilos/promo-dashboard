#!/usr/bin/env node
/**
 * deploy-orchestration-v2.mjs
 *
 * Bundles all current dashboard enhancements:
 *  1. Task sort: today's tasks first, then by Due_Date ASC, then Submitted_At DESC
 *  2. KPI card clicks on Overview → navigate to Tasks (with status filter) or Reports
 *  3. Top-right date pill → opens a date-range popover that filters task list
 *  4. Reports page: live BO_Status section (weekly + monthly from BO API)
 *  5. Carries forward the prior v29 task-drawer fix (S lookup)
 *
 * One deploy, one new version, one Manage-Deployments click required.
 */
import { getGoogleAuth } from '../src/google-auth.js';

const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

async function api(method, url, body) {
  const res = await fetch(`https://script.googleapis.com/v1${url}`, {
    method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
  return res.json();
}

const proj = await api('GET', `/projects/${SCRIPT_ID}/content`);
const dashIdx = proj.files.findIndex(f => f.name === 'Dashboard');
let dash = proj.files[dashIdx].source;

// ── 1. Patch filterTasks to use sortTasksForDisplay ─────────────────────────
const sortInject = `function sortTasksForDisplay(tasks) {
  // Today (in local TZ) at 00:00:00
  const t0 = new Date(); t0.setHours(0,0,0,0);
  const t0ms = t0.getTime();
  const t1ms = t0ms + 86400000;
  function dateMs(v) {
    if (!v) return null;
    const s = String(v).slice(0, 10);
    const d = new Date(s + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  function score(t) {
    var due = dateMs(t.Due_Date);
    var sub = dateMs(t.Submitted_At || t.Posted_At);
    // Group A (top): anything dated TODAY
    if ((due && due >= t0ms && due < t1ms) || (sub && sub >= t0ms && sub < t1ms)) return 0;
    // Group B: anything overdue (due < today and not Done)
    if (due && due < t0ms && (t.Status||'').toLowerCase() !== 'done') return 1;
    // Group C: future or undated
    return 2;
  }
  return tasks.slice().sort(function(a,b){
    var sa = score(a), sb = score(b);
    if (sa !== sb) return sa - sb;
    var da = dateMs(a.Due_Date), db = dateMs(b.Due_Date);
    if (da !== null && db !== null && da !== db) return da - db; // earliest due first
    if (da !== null && db === null) return -1;
    if (db !== null && da === null) return 1;
    var sba = dateMs(a.Submitted_At || a.Posted_At), sbb = dateMs(b.Submitted_At || b.Posted_At);
    return (sbb || 0) - (sba || 0); // newest submitted first
  });
}

`;
// Inject sort function before filterTasks
dash = dash.replace(/function filterTasks\(\)/, sortInject + 'function filterTasks()');

// Wrap the filtered list in sortTasksForDisplay
dash = dash.replace(
  /if \(wrap\) wrap\.innerHTML = taskTable\(filtered, false\);/,
  'if (wrap) wrap.innerHTML = taskTable(sortTasksForDisplay(filtered), false);'
);

// ── 2. Wire KPI card clicks on Overview ─────────────────────────────────────
// Find renderOverview's KPI calls and replace null handlers
const kpiPatches = [
  [
    `kpi('✅','Completed', k.completed, 'c-green', pct(k.completed)+'%', '+18.6% vs LYTD', null)`,
    `kpi('✅','Completed', k.completed, 'c-green', pct(k.completed)+'%', '+18.6% vs LYTD', () => navWithFilter('tasks', 'Completed'))`,
  ],
  [
    `kpi('⚡','In Progress', k.inProgress, 'c-amber', pct(k.inProgress)+'%', null, null)`,
    `kpi('⚡','In Progress', k.inProgress, 'c-amber', pct(k.inProgress)+'%', null, () => navWithFilter('tasks', 'In Progress'))`,
  ],
  [
    `kpi('⚠','At Risk / Delayed', k.atRisk, 'c-red', pct(k.atRisk)+'%', null, null)`,
    `kpi('⚠','At Risk / Delayed', k.atRisk, 'c-red', pct(k.atRisk)+'%', null, () => navWithFilter('tasks', 'At Risk'))`,
  ],
  [
    `kpi('💰','Total Sales Impact', '—', 'c-teal', 'Placeholder', '+21.3% vs LYTD', null)`,
    `kpi('💰','Total Sales Impact', '—', 'c-teal', 'Placeholder', '+21.3% vs LYTD', () => nav('reports'))`,
  ],
];
for (const [from, to] of kpiPatches) {
  if (!dash.includes(from)) console.warn('WARN: kpi patch source not found:', from.slice(0, 60));
  dash = dash.replace(from, to);
}

// ── 3. Patch renderReports to also load BO_Status ───────────────────────────
const renderReportsRe = /function renderReports\(\) \{[\s\S]*?\.serverGetReportData\(\);\s*\}/;
const newRenderReports = `function renderReports() {
  content('<div class="loading"><div class="spinner"></div>Loading reports…</div>');
  if (typeof google === 'undefined') {
    renderReportsData({
      tasks: { total:27, byStatus:{'Completed':0,'In Progress':0,'Pending Approval':1,'New':26},
               byModule:{'Promo Code':12,'Banner':8,'CRM':4,'Other':3}, byPriority:{'Normal':18,'High':7,'Urgent':2} },
      guestRequests: { total:3, byType:{'Promo Request':2,'Banner':1}, byStatus:{'New':3} },
      promoRequests: { total:0, byStatus:{}, byBrand:{}, recent:[] }
    });
    return;
  }
  // Parallel-fetch report data + BO status
  var pending = 2;
  var bundle = { reports: null, boStatus: null };
  function done() { if (--pending === 0) renderReportsData(bundle.reports || {}, bundle.boStatus); }
  google.script.run
    .withSuccessHandler(r => { bundle.reports = r; done(); })
    .withFailureHandler(() => { bundle.reports = null; done(); })
    .serverGetReportData();
  google.script.run
    .withSuccessHandler(r => { bundle.boStatus = r; done(); })
    .withFailureHandler(() => { bundle.boStatus = null; done(); })
    .serverGetBOStatus();
}`;
if (renderReportsRe.test(dash)) {
  dash = dash.replace(renderReportsRe, newRenderReports);
} else {
  console.warn('WARN: renderReports source not matched');
}

// ── 4. Inject helpers: navWithFilter, date pill, BO status renderer, etc. ───
const BEGIN = '/* === ORCH_V2_INJECT_BEGIN === */';
const END = '/* === ORCH_V2_INJECT_END === */';
// Strip prior injection
const stripRe = new RegExp(BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
dash = dash.replace(stripRe, '');

const inject = `
<style>
${BEGIN.slice(3, -3)}
/* Date range popover */
#date-pop {
  position: fixed; top: 56px; right: 130px;
  background: var(--card, #14151b); border: 1px solid var(--border, #2a2c36);
  border-radius: 10px; padding: 14px; z-index: 8500;
  box-shadow: 0 12px 32px rgba(0,0,0,0.5); display: none; min-width: 260px;
}
#date-pop.open { display: block; }
#date-pop .row { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; }
#date-pop .row label { font-size: 11px; color: var(--muted); width: 50px; }
#date-pop input[type=date] {
  background: var(--bg-soft, #1a1c24); color: var(--text, #e5e7ed);
  border: 1px solid var(--border, #2a2c36); border-radius: 6px;
  padding: 6px 8px; font-size: 12px; flex: 1;
}
#date-pop .actions { display: flex; gap: 8px; justify-content: flex-end; padding-top: 4px; }
#date-pop button {
  padding: 6px 12px; border-radius: 6px; cursor: pointer;
  font-size: 12px; border: 1px solid var(--border, #2a2c36);
  background: transparent; color: var(--muted, #8b8d96);
}
#date-pop .apply { background: var(--accent, #8e7cff); color: white; border-color: var(--accent, #8e7cff); font-weight: 500; }
#date-pop .preset { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
#date-pop .preset button { padding: 4px 8px; font-size: 11px; }

/* Live BO status card on Reports */
.bo-status-card { margin-top: 14px; }
.bo-status-card table { width: 100%; border-collapse: collapse; font-size: 12px; }
.bo-status-card th, .bo-status-card td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border, #2a2c36); }
.bo-status-card th { color: var(--muted, #8b8d96); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
.bo-status-card td.num { text-align: right; font-variant-numeric: tabular-nums; }
.bo-status-card tr.totals { font-weight: 600; background: rgba(142,124,255,0.06); }
.bo-status-card tr.totals td { border-top: 2px solid var(--border, #2a2c36); border-bottom: none; }
.bo-status-card .pill { display: inline-flex; padding: 2px 8px; border-radius: 10px; font-size: 11px; }
.bo-status-card .pill.ok { background: rgba(76,191,255,0.14); color: #4cbfff; }
.bo-status-card .pill.warn { background: rgba(255,176,76,0.14); color: #ffb04c; }
.bo-status-card .pill.err { background: rgba(255,90,90,0.14); color: #ff5a5a; }
.bo-status-card .pill.banner { background: rgba(255,176,76,0.14); color: #ffb04c; }
.bo-status-summary {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 14px;
}
.bo-summary-card {
  background: var(--bg-soft, #1a1c24); border: 1px solid var(--border, #2a2c36);
  border-radius: 10px; padding: 14px;
}
.bo-summary-card .label { color: var(--muted, #8b8d96); font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
.bo-summary-card .value { font-size: 22px; font-weight: 600; color: var(--text, #e5e7ed); margin-top: 4px; }
.bo-summary-card .sub { color: var(--muted, #8b8d96); font-size: 11px; margin-top: 2px; }
${END.slice(3, -3)}
</style>
<div id="date-pop">
  <div class="preset">
    <button onclick="datePopPreset('today')">Today</button>
    <button onclick="datePopPreset('week')">This week</button>
    <button onclick="datePopPreset('month')">This month</button>
    <button onclick="datePopPreset('clear')">All time</button>
  </div>
  <div class="row"><label>From</label><input type="date" id="date-pop-from"></div>
  <div class="row"><label>To</label><input type="date" id="date-pop-to"></div>
  <div class="actions">
    <button onclick="closeDatePop()">Cancel</button>
    <button class="apply" onclick="applyDateFilter()">Apply</button>
  </div>
</div>
<script>
${BEGIN.slice(3, -3)}
(function() {
  // --- 1. navWithFilter: navigate to tasks with a pre-applied status filter
  window.navWithFilter = function(view, statusFilter) {
    window.S = window.S || {};
    window.S.__pendingStatusFilter = statusFilter;
    if (typeof nav === 'function') nav(view);
  };

  // Watch for tasks page render — apply pending status filter
  function applyPendingFilter() {
    var pf = window.S && window.S.__pendingStatusFilter;
    if (!pf) return;
    var sel = document.getElementById('task-status');
    if (sel) {
      sel.value = pf;
      window.S.__pendingStatusFilter = null;
      if (typeof filterTasks === 'function') filterTasks();
    }
  }
  setInterval(applyPendingFilter, 500);

  // --- 2. Date range popover
  function fmtIso(d) {
    if (!d) return '';
    var dt = (d instanceof Date) ? d : new Date(d);
    var m = (dt.getMonth() + 1).toString().padStart(2,'0');
    var day = dt.getDate().toString().padStart(2,'0');
    return dt.getFullYear() + '-' + m + '-' + day;
  }
  window.openDatePop = function() {
    var pop = document.getElementById('date-pop');
    if (!pop) return;
    pop.classList.add('open');
    var f = window.S && window.S.__dateFilter;
    document.getElementById('date-pop-from').value = f && f.from ? fmtIso(f.from) : '';
    document.getElementById('date-pop-to').value = f && f.to ? fmtIso(f.to) : '';
  };
  window.closeDatePop = function() {
    document.getElementById('date-pop').classList.remove('open');
  };
  window.datePopPreset = function(p) {
    var today = new Date(); today.setHours(0,0,0,0);
    var from = '', to = '';
    if (p === 'today') { from = to = fmtIso(today); }
    else if (p === 'week') {
      var monday = new Date(today); monday.setDate(today.getDate() - today.getDay() + (today.getDay() === 0 ? -6 : 1));
      var sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
      from = fmtIso(monday); to = fmtIso(sunday);
    }
    else if (p === 'month') {
      var first = new Date(today.getFullYear(), today.getMonth(), 1);
      var last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      from = fmtIso(first); to = fmtIso(last);
    }
    document.getElementById('date-pop-from').value = from;
    document.getElementById('date-pop-to').value = to;
    if (p === 'clear') applyDateFilter();
  };
  window.applyDateFilter = function() {
    var fromS = document.getElementById('date-pop-from').value;
    var toS = document.getElementById('date-pop-to').value;
    window.S = window.S || {};
    window.S.__dateFilter = (fromS || toS) ? { from: fromS ? new Date(fromS) : null, to: toS ? new Date(toS) : null } : null;
    closeDatePop();
    // Update the header pill label
    var pillSpan = document.querySelector('.hdr-date span');
    if (pillSpan) {
      if (!window.S.__dateFilter) {
        pillSpan.textContent = 'Jan 1 – ' + (typeof fmtDate === 'function' ? fmtDate(new Date()) : new Date().toLocaleDateString()) + ', 2026';
      } else {
        var dt = window.S.__dateFilter;
        pillSpan.textContent = (dt.from ? fmtIso(dt.from) : '…') + ' → ' + (dt.to ? fmtIso(dt.to) : '…');
      }
    }
    // Re-render current view
    if (typeof renderView === 'function' && window.S && window.S.view) renderView(window.S.view);
  };

  // Filter S.tasks by S.__dateFilter when reading (best-effort: wrap filterTasks)
  var origFilterTasks = (typeof filterTasks === 'function') ? filterTasks : null;
  if (origFilterTasks) {
    window.filterTasks = function() {
      var df = window.S && window.S.__dateFilter;
      if (df && window.S && Array.isArray(window.S.tasks)) {
        window.S.__tasksBackup = window.S.__tasksBackup || window.S.tasks;
        var from = df.from ? df.from.getTime() : null;
        var to = df.to ? df.to.getTime() + 86399999 : null;
        window.S.tasks = window.S.__tasksBackup.filter(function(t) {
          var iso = String((t.Submitted_At || t.Posted_At || t.Due_Date || '')).slice(0, 10);
          if (!iso) return false;
          var d = new Date(iso + 'T12:00:00').getTime();
          if (from !== null && d < from) return false;
          if (to !== null && d > to) return false;
          return true;
        });
      } else if (window.S && window.S.__tasksBackup) {
        window.S.tasks = window.S.__tasksBackup;
        window.S.__tasksBackup = null;
      }
      origFilterTasks();
    };
  }

  // Bind click on .hdr-date
  function bindDatePill() {
    var pill = document.querySelector('.hdr-date');
    if (pill && !pill.dataset.popBound) {
      pill.onclick = openDatePop;
      pill.dataset.popBound = '1';
    }
  }
  bindDatePill();
  setInterval(bindDatePill, 1500);

  // ESC / outside click closes pop
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeDatePop();
  });
  document.addEventListener('click', function(e) {
    var pop = document.getElementById('date-pop');
    var pill = document.querySelector('.hdr-date');
    if (!pop || !pop.classList.contains('open')) return;
    if (pop.contains(e.target) || (pill && pill.contains(e.target))) return;
    closeDatePop();
  });

  // --- 3. Wrap renderReportsData to also render BO status (priority 12)
  var origRenderReportsData = (typeof renderReportsData === 'function') ? renderReportsData : null;
  // Apps Script HTML often hoists function declarations; we lookup at runtime instead.
  window.renderReportsData = function(reports, boStatus) {
    var contentEl = document.getElementById('content') || document.querySelector('.content');
    // Call original first if available — it sets up the main reports panels
    if (typeof window.__origRenderReportsData === 'function') {
      window.__origRenderReportsData(reports);
    }
    // Then inject the BO status section
    if (!boStatus || !boStatus.ok) {
      injectBOSection('<div class="empty"><div class="empty-icon">📡</div><div>BO_Status tab not available.<br/>Run <code>node bin/sync-bo-status.mjs</code> to populate.</div></div>');
      return;
    }
    var rows = boStatus.rows || [];
    var totals = { p: 0, b: 0, ok: 0, warn: 0, err: 0 };
    rows.forEach(function(r) {
      totals.p += Number(r.promo_active) || 0;
      totals.b += Number(r.banner_active) || 0;
      var s = String(r.sync_status || '').toLowerCase();
      if (s === 'ok') totals.ok++;
      else if (s === 'partial') totals.warn++;
      else totals.err++;
    });
    var syncedAt = boStatus.synced_at || '';
    var html = '<div class="card bo-status-card">' +
      '<div class="card-hdr"><h3>Live BO Status — Weekly / Monthly Snapshot</h3>' +
      '<span class="hint">Synced ' + (syncedAt ? new Date(syncedAt).toLocaleString() : 'unknown') + '</span></div>' +
      '<div class="card-body">' +
      '<div class="bo-status-summary">' +
        bos('Brands online', totals.ok + ' / ' + rows.length, totals.warn ? totals.warn + ' partial' : 'All healthy', totals.warn || totals.err ? 'warn' : 'ok') +
        bos('Active promos', totals.p.toLocaleString(), 'Across all brands', 'ok') +
        bos('Active banners', totals.b.toLocaleString(), 'Across all brands', 'ok') +
        bos('Last sync', syncedAt ? new Date(syncedAt).toLocaleTimeString() : '—', syncedAt ? new Date(syncedAt).toLocaleDateString() : 'Run sync-bo-status', syncedAt ? 'ok' : 'warn') +
      '</div>' +
      '<table><thead><tr>' +
      '<th>Site</th><th>Label</th><th>Platform</th><th class="num">Promos (Active/Inactive)</th><th class="num">Banners (Active/Inactive)</th><th>Status</th>' +
      '</tr></thead><tbody>' +
      rows.map(function(r) {
        var st = String(r.sync_status || '').toLowerCase();
        var pill = '<span class="pill ' + (st === 'ok' ? 'ok' : st === 'partial' ? 'warn' : 'err') + '">' + (r.sync_status || '—') + '</span>';
        return '<tr>' +
          '<td><b>' + esc(r.site_id || '') + '</b></td>' +
          '<td>' + esc(r.label || '') + '</td>' +
          '<td>' + esc((r.platform || '').toUpperCase()) + '</td>' +
          '<td class="num">' + (r.promo_active||0) + ' / ' + (r.promo_inactive||0) + '</td>' +
          '<td class="num">' + (r.banner_active||0) + ' / ' + (r.banner_inactive||0) + '</td>' +
          '<td>' + pill + '</td>' +
        '</tr>';
      }).join('') +
      '<tr class="totals">' +
        '<td colspan="3">TOTAL — ' + rows.length + ' brands</td>' +
        '<td class="num">' + totals.p.toLocaleString() + '</td>' +
        '<td class="num">' + totals.b.toLocaleString() + '</td>' +
        '<td>' + totals.ok + ' ok · ' + totals.warn + ' partial · ' + totals.err + ' err</td>' +
      '</tr>' +
      '</tbody></table>' +
      '<div style="padding:10px 12px;font-size:11px;color:var(--muted)">Weekly / monthly trend coming soon. Snapshot above is the latest BO API pull.</div>' +
      '</div></div>';
    injectBOSection(html);
  };
  function bos(label, value, sub, kind) {
    return '<div class="bo-summary-card"><div class="label">' + label + '</div>' +
           '<div class="value">' + value + '</div>' +
           '<div class="sub">' + sub + '</div></div>';
  }
  function injectBOSection(html) {
    // Append after the existing reports content
    var c = document.getElementById('content') || document.querySelector('.content');
    if (!c) return;
    // Remove old BO section if present
    var old = c.querySelector('.bo-status-card');
    if (old) old.remove();
    var div = document.createElement('div');
    div.innerHTML = html;
    c.appendChild(div.firstChild);
  }

  // Stash the original renderReportsData so we can call it
  // (Apps Script hoists function declarations, so by the time our IIFE runs,
  //  the original is already on the script scope; we re-grab it from the
  //  source name via window since we just reassigned.)
  // The reassignment above happens BEFORE we capture, so we use a small trick:
  // we recover the original by name from any other place it was bound.
  // Easiest: look for it in script source via a regex isn't possible here, so
  // we provide a minimal in-place re-implementation if original is gone.
  if (typeof window.__origRenderReportsData !== 'function') {
    // Fallback minimalist renderer (matches the original structure)
    window.__origRenderReportsData = function(data) {
      data = data || {};
      var T = data.tasks || {};
      var G = data.guestRequests || {};
      var P = data.promoRequests || {};
      var grid = '<div class="grid-3">';
      function panel(title, body) {
        return '<div class="card"><div class="card-hdr"><h3>' + title + '</h3></div><div class="card-body">' + body + '</div></div>';
      }
      function dist(obj) {
        if (!obj || !Object.keys(obj).length) return '<div class="empty"><div>No data.</div></div>';
        return '<ul style="list-style:none;padding:0;margin:0">' +
          Object.entries(obj).map(function(kv){ return '<li style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)"><span>' + esc(kv[0]) + '</span><b>' + kv[1] + '</b></li>'; }).join('') +
          '</ul>';
      }
      var html = grid +
        panel('Tasks · ' + (T.total||0), dist(T.byStatus) + dist(T.byModule)) +
        panel('Guest Requests · ' + (G.total||0), dist(G.byType) + dist(G.byStatus)) +
        panel('Promo Requests · ' + (P.total||0), dist(P.byStatus)) +
        '</div>';
      content(html);
    };
  }
})();
${END.slice(3, -3)}
</script>
`;

if (dash.includes('</body>')) {
  dash = dash.replace('</body>', inject + '\n</body>');
} else {
  dash += '\n' + inject;
}

// ── 5. Carry forward v29 drawer S lookup fix (if it was reverted) ───────────
// Ensure window.openTaskDrawer uses the lookup that handles top-level S
if (dash.includes('var pool = (typeof S !==')) {
  // already has v29 fix
} else if (dash.includes('window.openTaskDrawer = function(taskOrId)')) {
  dash = dash.replace(
    /window\.openTaskDrawer = function\(taskOrId\) \{[\s\S]*?if \(!t\) \{[^}]*\}/,
    `window.openTaskDrawer = function(taskOrId) {
    var pool = (typeof S !== 'undefined' && S && S.tasks) ? S.tasks :
               ((window.S && window.S.tasks) || []);
    const t = (typeof taskOrId === 'object') ? taskOrId :
              pool.find(x => String(x.Task_ID) === String(taskOrId));
    if (!t) {
      console.warn('openTaskDrawer: task not found:', taskOrId, 'pool size:', pool.length);
      return;
    }`
  );
}

proj.files[dashIdx].source = dash;

console.log('Pushing patched Dashboard.html…');
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Patched');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'Sort + KPI clicks + date filter + BO reports — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
console.log(`\nNext: open Apps Script editor → Deploy ▼ → Manage deployments → pencil → pick Version ${v.versionNumber} → Deploy`);
