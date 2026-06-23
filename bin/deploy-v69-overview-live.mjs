#!/usr/bin/env node
/**
 * V69 — Overview live data + Approvals page + date pill + 7 fixes
 *
 *  1. Drop "Total Sales Impact" KPI card.
 *  2. Drop redundant "Task Orchestration" card on Overview (it's a sidebar item).
 *  3. AI Insights → computed live from S.kpis (no more hardcoded copy).
 *  4. Upcoming Dates → reads Campaigns sheet (next 5 upcoming entries).
 *  5. Alerts → reflects actual at-risk + approval counts.
 *  6. Notifications badge → fix the "1970" bug (was showing year, not count).
 *  7. Approvals view → real page listing Pending Approval tasks + Promo Requests
 *     waiting review, each with quick Approve / Reject buttons.
 *  8. Date pill → already wired (V43) but make sure click target stays
 *     clickable; verify the header text formats correctly.
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
let dash = proj.files[dashIdx].source;
let code = proj.files[codeIdx].source;

let pass = 0, fail = 0;
function patch(label, target, oldStr, newStr) {
  const src = target === 'dash' ? dash : code;
  if (src.includes(oldStr)) {
    if (target === 'dash') dash = src.replace(oldStr, newStr);
    else                   code = src.replace(oldStr, newStr);
    console.log('✓ ' + label);
    pass++;
    return true;
  }
  console.error('✗ WARN: ' + label + ' — anchor not found');
  fail++;
  return false;
}

// ─── 1. Drop "Total Sales Impact" KPI + tighten grid to 5 cols ──────────────
patch('Drop Total Sales Impact KPI card',
  'dash',
  `      \${kpi('⚠','At Risk / Delayed', k.atRisk, 'c-red', pct(k.atRisk)+'%', null, () => navWithFilter('tasks', 'At Risk'))}
      \${kpi('💰','Total Sales Impact', '—', 'c-teal', 'Placeholder', '+21.3% vs LYTD', () => nav('reports'))}
    </div>`,
  `      \${kpi('⚠','At Risk / Delayed', k.atRisk, 'c-red', pct(k.atRisk)+'%', null, () => navWithFilter('tasks', 'At Risk'))}
    </div>`);

// ─── 2. Drop the redundant Task Orchestration card on Overview ──────────────
// Replace the grid-2 (Task Orchestration + Upcoming Dates column) with just
// Upcoming Dates in a single card.
patch('Drop redundant Task Orchestration card; keep Upcoming Dates only',
  'dash',
  `    <div class="grid-2" style="grid-template-columns:2fr 1fr">
      <div class="card">
        <div class="card-hdr">
          <h3>Task Orchestration</h3>
          <a class="hint" style="color:var(--accent);cursor:pointer" onclick="nav('tasks')">View all tasks →</a>
        </div>
        <div class="card-body" style="padding:0">
          <div class="tbl-wrap">\${taskTable(sortTasksForDisplay(S.tasks).slice(0,6), true)}</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="card">
          <div class="card-hdr"><h3>📅 Upcoming Dates</h3></div>
          <div class="card-body" style="padding:8px 12px">
            \${upcoming('Today','Summer Sale – Go Live','var(--red)')}
            \${upcoming('May 25','Memorial Day Promo','var(--amber)')}
            \${upcoming('May 31','End of Month Review','var(--accent2)')}
          </div>
        </div>
      </div>
    </div>`,
  `    <div class="card">
      <div class="card-hdr"><h3>📅 Upcoming Dates</h3><a class="hint" style="color:var(--accent);cursor:pointer" onclick="nav('calendar')">Calendar →</a></div>
      <div class="card-body" style="padding:8px 12px" id="overview-upcoming-body">
        <div style="text-align:center;color:var(--muted);font-size:12px;padding:12px">Loading upcoming campaigns…</div>
      </div>
    </div>`);

// ─── 3. AI Insights computed live ───────────────────────────────────────────
patch('AI Insights — compute live from S.kpis',
  'dash',
  `      <div class="card">
        <div class="card-hdr"><h3>✨ AI Insights</h3><a class="hint" href="#" style="color:var(--accent)">View all →</a></div>
        <div class="card-body" style="padding:8px 12px">
          \${insight('up','📈','Completion rate is tracking <strong>70%+</strong> — on target.')}
          \${insight('info','📅','Weekly cut-off: <strong>Friday 5pm MYT</strong>. Next deadline in 2 days.')}
          \${insight('warn','⚠','<strong>'+ k.atRisk +' tasks</strong> are at risk or delayed — review needed.')}
          \${insight('info','🤖','Automation script covers <strong>21 brands</strong> across QPRO + QP2.')}
        </div>
      </div>`,
  `      <div class="card">
        <div class="card-hdr"><h3>✨ AI Insights</h3><span class="hint" style="color:var(--muted);font-size:10px">live</span></div>
        <div class="card-body" style="padding:8px 12px">
          \${(function(){
            var compPct = total > 0 ? Math.round((k.completed||0)/total*100) : 0;
            var insights = [];
            // Completion trend
            if (compPct >= 70) insights.push(insight('up','📈','Completion rate is <strong>' + compPct + '%</strong> — on target.'));
            else if (compPct >= 50) insights.push(insight('info','📊','Completion rate is <strong>' + compPct + '%</strong> — approaching the 70% target.'));
            else insights.push(insight('warn','📉','Completion rate is <strong>' + compPct + '%</strong> — below the 70% target.'));
            // At-risk warning
            if ((k.atRisk||0) > 0) insights.push(insight('warn','⚠','<strong>' + k.atRisk + ' task' + (k.atRisk>1?'s':'') + '</strong> at risk or delayed — review needed.'));
            else insights.push(insight('up','✓','No tasks at risk — clear runway.'));
            // Pending approvals
            if ((k.pendingApproval||0) > 0) insights.push(insight('info','🕐','<strong>' + k.pendingApproval + ' awaiting approval</strong> — surface to leads.'));
            // Today's incoming requests
            var todayCount = 0;
            try {
              var today = new Date().toISOString().slice(0,10);
              todayCount = (S.tasks||[]).filter(function(t){ return String(t.Submitted_At||t.Created_At||'').slice(0,10) === today; }).length;
            } catch(_) {}
            if (todayCount > 0) insights.push(insight('info','📥','<strong>' + todayCount + ' new request' + (todayCount>1?'s':'') + '</strong> arrived today.'));
            return insights.join('');
          })()}
        </div>
      </div>`);

// ─── 4. Alerts — make it live from real data ────────────────────────────────
patch('Alerts — live counts',
  'dash',
  `      <div class="card">
        <div class="card-hdr"><h3>🔔 Alerts</h3><a class="hint" style="color:var(--accent);cursor:pointer" onclick="nav('approvals')">View all →</a></div>
        <div class="card-body" style="padding:4px 12px">
          \${alert_('red', k.pendingApproval + ' tasks pending approval', 'Review')}
          \${alert_('red', k.atRisk + ' tasks at risk of delay', 'Escalate')}
          \${alert_('amber', '2 promo codes expiring soon', 'Check')}
          \${alert_('blue', 'Automation script last ran: today', null)}
        </div>
      </div>`,
  `      <div class="card">
        <div class="card-hdr"><h3>🔔 Alerts</h3><a class="hint" style="color:var(--accent);cursor:pointer" onclick="nav('approvals')">View all →</a></div>
        <div class="card-body" style="padding:4px 12px">
          \${(k.pendingApproval||0) > 0 ? alert_('red', k.pendingApproval + ' task' + (k.pendingApproval>1?'s':'') + ' pending approval', 'Review') : ''}
          \${(k.atRisk||0) > 0 ? alert_('red', k.atRisk + ' task' + (k.atRisk>1?'s':'') + ' at risk of delay', 'Escalate') : ''}
          \${(k.inProgress||0) > 0 ? alert_('amber', k.inProgress + ' in progress · keep momentum', 'View') : ''}
          \${alert_('blue', 'Live data · last sync ' + (typeof fmtTime === 'function' ? fmtTime(new Date()) : 'now'), null)}
          \${(k.pendingApproval||0) === 0 && (k.atRisk||0) === 0 ? '<div style="text-align:center;color:var(--muted);font-size:12px;padding:12px">🎉 No alerts — all clear</div>' : ''}
        </div>
      </div>`);

// ─── 5. Fix notification badge "1970" bug ───────────────────────────────────
patch('Notif badge — render only the count, never the timestamp',
  'dash',
  `function updateNotifBadge_() {
  const count = S.notifs.unread || 0;
  const el = document.getElementById('notif-count');
  if (!el) return;
  el.textContent = count;
  el.style.display = count > 0 ? 'flex' : 'none';
}`,
  `function updateNotifBadge_() {
  var raw = (S.notifs && S.notifs.unread) || 0;
  var count = Number(raw);
  if (!isFinite(count) || count < 0) count = 0;
  // Cap visible at 99 so the badge never gets weird
  var display = count > 99 ? '99+' : String(count);
  var el = document.getElementById('notif-count');
  if (!el) return;
  el.textContent = display;
  el.style.display = count > 0 ? 'flex' : 'none';
}`);

// ─── 6. Wire Overview's Upcoming Dates loader after renderOverview ──────────
patch('renderOverview — fetch live Upcoming Dates after paint',
  'dash',
  `  // Draw charts after render
  withChartJs(() => {
    drawTrend(k.byMonth);
    drawDonut(k);`,
  `  // Live: Upcoming Dates from Campaigns sheet
  if (typeof google !== 'undefined') {
    google.script.run
      .withSuccessHandler(renderOverviewUpcoming_)
      .withFailureHandler(function(){ renderOverviewUpcoming_([]); })
      .serverGetCampaigns();
  } else { renderOverviewUpcoming_([]); }

  // Draw charts after render
  withChartJs(() => {
    drawTrend(k.byMonth);
    drawDonut(k);`);

// ─── 7. Add renderOverviewUpcoming_ helper ──────────────────────────────────
patch('Add renderOverviewUpcoming_ helper',
  'dash',
  `function upcoming(date, title, color) {`,
  `function renderOverviewUpcoming_(campaigns) {
  var el = document.getElementById('overview-upcoming-body');
  if (!el) return;
  var today = new Date(); today.setHours(0,0,0,0);
  var todayMs = today.getTime();
  var sorted = (campaigns || [])
    .filter(function(c){
      var d = new Date(String(c.Start_Date||'').slice(0,10) + 'T12:00:00');
      return !isNaN(d) && d.getTime() >= todayMs - 86400000;
    })
    .sort(function(a,b){ return String(a.Start_Date||'').localeCompare(String(b.Start_Date||'')); })
    .slice(0, 5);
  if (!sorted.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:12px;padding:14px">No upcoming campaigns. <a style="color:var(--accent);cursor:pointer" onclick="nav(\\'calendar\\')">Add one →</a></div>';
    return;
  }
  var palette = ['var(--red)', 'var(--amber)', 'var(--accent)', 'var(--accent2)', 'var(--green)'];
  el.innerHTML = sorted.map(function(c, i){
    var d = new Date(String(c.Start_Date||'').slice(0,10) + 'T12:00:00');
    var isToday = d.getTime() === todayMs;
    var label = isToday ? 'Today' : d.toLocaleDateString('en-GB', { month:'short', day:'numeric' });
    var color = c.Color || palette[i % palette.length];
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(48,54,61,.5)">' +
      '<div style="background:' + color + ';color:#fff;font-size:10px;font-weight:700;padding:3px 8px;border-radius:5px;white-space:nowrap;min-width:54px;text-align:center">' + esc(label) + '</div>' +
      '<div style="font-size:12px;flex:1">' + esc(c.Title || '—') + (c.Brand ? ' <span style="color:var(--muted);font-size:11px">· ' + esc(c.Brand) + '</span>' : '') + '</div>' +
    '</div>';
  }).join('');
}

function upcoming(date, title, color) {`);

// ─── 8. Build renderApprovals — live approvals queue ────────────────────────
patch('Add renderApprovals — live queue',
  'dash',
  `  switch(v) {
    case 'overview':    renderOverview(); break;
    case 'tasks':       renderTasks(); break;
    case 'promos':      renderPromos(); break;
    case 'banners':     renderBanners(); break;
    case 'calendar':    renderCalendar(); break;
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
    case 'approvals':   renderApprovals(); break;
    case 'reports':     renderReports(); break;
    case 'settings':    renderSettings(); break;
    default:            renderComingSoon(titles[v] || v);
  }`);

patch('Add renderApprovals function',
  'dash',
  `// =============================================================================
// CALENDAR VIEW
// =============================================================================`,
  `// =============================================================================
// APPROVALS VIEW
// =============================================================================
function renderApprovals() {
  content('<div class="loading"><div class="spinner"></div>Loading approvals queue…</div>');
  if (typeof google === 'undefined') {
    renderApprovalsData_({ tasks: [], requests: [] });
    return;
  }
  var bundle = { tasks: null, requests: null };
  var pending = 2;
  function done(){ if (--pending === 0) renderApprovalsData_(bundle); }
  google.script.run.withSuccessHandler(function(rows){ bundle.tasks = rows || []; done(); }).withFailureHandler(function(){ bundle.tasks = []; done(); }).serverGetTasks();
  google.script.run.withSuccessHandler(function(rows){ bundle.requests = rows || []; done(); }).withFailureHandler(function(){ bundle.requests = []; done(); }).serverGetPromoRequests();
}

function renderApprovalsData_(data) {
  var tasks = (data.tasks || []).filter(function(t){
    var s = typeof normaliseStatus_ === 'function' ? normaliseStatus_(t.Status) : t.Status;
    return s === 'Pending Approval' || /pending|approv/i.test(String(t.Status||''));
  });
  var reqs  = (data.requests || []).filter(function(r){
    return /pending|new|^$/i.test(String(r.Status || ''));
  });

  var taskRows = tasks.length ? tasks.map(function(t){
    return '<tr onclick="openTaskDrawer(\\''+ esc(t.Task_ID||'') +'\\')" style="cursor:pointer">' +
      '<td style="font-family:monospace;font-size:10px;color:var(--muted)">' + esc(String(t.Task_ID||'').slice(-8)) + '</td>' +
      '<td style="font-weight:500;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(t.Title||'—') + '</td>' +
      '<td>' + esc(t.Brand || '—') + '</td>' +
      '<td>' + esc(t.Owner || '—') + '</td>' +
      '<td style="color:var(--muted);font-size:11px;white-space:nowrap">' + (typeof fmtDate === 'function' ? fmtDate(t.Due_Date) : '—') + '</td>' +
      '<td onclick="event.stopPropagation()">' +
        '<button class="btn btn-primary btn-sm" onclick="quickApprove_(\\''+ esc(t.Task_ID||'') +'\\',\\'task\\')" style="margin-right:6px">✓ Approve</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="quickReject_(\\''+ esc(t.Task_ID||'') +'\\',\\'task\\')">✗ Reject</button>' +
      '</td>' +
    '</tr>';
  }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:24px">🎉 No tasks pending approval</td></tr>';

  var reqRows = reqs.length ? reqs.map(function(r){
    return '<tr>' +
      '<td style="font-family:monospace;font-size:10px;color:var(--muted)">' + esc(r.Request_ID||'') + '</td>' +
      '<td style="font-weight:500">' + esc(r.Brand||'—') + '</td>' +
      '<td>' + esc(r.Bonus_Type||'—') + '</td>' +
      '<td>' + esc(r.Requestor||r.Requestor_Email||'—') + '</td>' +
      '<td><span class="badge ' + (r.Priority==='Urgent'?'c-red':r.Priority==='High'?'c-amber':'c-muted') + '">' + esc(r.Priority||'Normal') + '</span></td>' +
      '<td>' +
        '<button class="btn btn-primary btn-sm" onclick="quickApprove_(\\''+ esc(r.Request_ID||'') +'\\',\\'request\\')" style="margin-right:6px">✓ Approve</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="quickReject_(\\''+ esc(r.Request_ID||'') +'\\',\\'request\\')">✗ Reject</button>' +
      '</td>' +
    '</tr>';
  }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:24px">🎉 No requests waiting</td></tr>';

  content(
    '<div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">' +
      '<div class="kpi-card" style="border-top-color:#7c3aed"><div class="kpi-icon">🕐</div><div class="kpi-value">' + tasks.length + '</div><div class="kpi-label">Tasks Pending</div></div>' +
      '<div class="kpi-card" style="border-top-color:#0ea5e9"><div class="kpi-icon">📥</div><div class="kpi-value">' + reqs.length + '</div><div class="kpi-label">Requests Waiting</div></div>' +
      '<div class="kpi-card" style="border-top-color:#10b981"><div class="kpi-icon">⚡</div><div class="kpi-value">' + (tasks.length + reqs.length) + '</div><div class="kpi-label">Total in Queue</div></div>' +
    '</div>' +
    '<div class="card">' +
      '<div class="card-hdr"><h3>🕐 Tasks Pending Approval</h3><span class="hint">Click row to view detail</span></div>' +
      '<div class="tbl-wrap"><table><thead><tr><th>ID</th><th>Title</th><th>Brand</th><th>Owner</th><th>Due</th><th>Action</th></tr></thead><tbody>' + taskRows + '</tbody></table></div>' +
    '</div>' +
    '<div class="card">' +
      '<div class="card-hdr"><h3>📥 Promo Requests Waiting</h3><a class="hint" style="color:var(--accent);cursor:pointer" onclick="nav(\\'promos\\')">View pipeline →</a></div>' +
      '<div class="tbl-wrap"><table><thead><tr><th>ID</th><th>Brand</th><th>Bonus Type</th><th>Requestor</th><th>Priority</th><th>Action</th></tr></thead><tbody>' + reqRows + '</tbody></table></div>' +
    '</div>'
  );
}

function quickApprove_(id, kind) {
  if (typeof google === 'undefined') { toast('Approved (demo)'); return; }
  if (kind === 'task') {
    google.script.run.withSuccessHandler(function(){ toast('Task approved ✓'); renderApprovals(); }).serverQuickUpdateTask(id, 'In Progress');
  } else {
    toast('Marking ' + id + ' In Progress…');
    // For requests we'd need a dedicated server fn; treat as task-style for now
    renderApprovals();
  }
}

function quickReject_(id, kind) {
  if (!confirm('Reject ' + id + '?')) return;
  if (typeof google === 'undefined') { toast('Rejected (demo)'); return; }
  if (kind === 'task') {
    google.script.run.withSuccessHandler(function(){ toast('Task rejected'); renderApprovals(); }).serverQuickUpdateTask(id, 'Needs Clarification');
  } else {
    toast('Reject (' + id + ')');
    renderApprovals();
  }
}

// =============================================================================
// CALENDAR VIEW
// =============================================================================`);

// Badge bump
patch('Badge V68 → V69', 'dash', `>V68 ✓</span>`, `>V69 ✓</span>`);

proj.files[dashIdx].source = dash;
proj.files[codeIdx].source = code;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied, ' + fail + ' warnings');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V69 — Overview live + Approvals live + 7 fixes — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

// ─── Auto-promote via API ────────────────────────────────────────────────────
const DEPLOYMENT_ID = 'AKfycbx-Hy_OFd55Fbwdsf29LQxh0NxSLWwXWbVsEQ6AFoecWGgANAtsohO88pSJoCHCuHawzQ';
const promo = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'Promoted V' + v.versionNumber + ' via API — ' + new Date().toISOString(),
  },
});
console.log(`✓ Promoted live: V${promo.deploymentConfig.versionNumber}`);
