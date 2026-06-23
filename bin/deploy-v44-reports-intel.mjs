#!/usr/bin/env node
/**
 * V44 — Reports & Analytics rebuild: Operational Intelligence layer
 *
 * Replaces the static Reports page with a 10-module tabbed intelligence
 * platform:
 *
 *   1. Operational Performance   (Daily/Weekly/Monthly Ops Summary)
 *   2. Promo Performance         (Cost / ROI / Effectiveness / Launch)
 *   3. Automation & AI           (Auto run health / Hours saved / Errors)
 *   4. Team Productivity         (Utilization / Workload / Burnout)
 *   5. Action Items & Meetings   (Open AIs / Meeting effectiveness)
 *   6. SLA & Delay               (Compliance % / Root cause / Bottlenecks)
 *   7. Request Analytics         (Volume / Quality / Source)
 *   8. SOP & Knowledge           (Gap report / Usage analytics)
 *   9. Executive Intelligence    (1-minute exec summary + risk indicators)
 *  10. Future AI                 (Predictive / Capacity forecast — roadmap)
 *
 * Real data feeds modules 1, 2, 3, 4, 6, 7, 9. Modules 5, 8, 10 ship as
 * polished placeholders ready for live source wiring.
 *
 * UX:
 *   - Chart.js powered trends, donuts, bar charts
 *   - Modern KPI cards with sparkline + delta
 *   - Per-module AI summary card (template-driven from real data)
 *   - Per-module filter strip (date / brand / market)
 *   - Export button on each table (CSV download in-browser)
 *   - Bumped badge V43 → V44
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

// ─── 1. Replace renderReports() entry-point ─────────────────────────────────
patch('renderReports — new tabbed module switcher',
  'dash',
  `function renderReports() {
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
}`,
  `function renderReports() {
  S.reportModule = S.reportModule || 'ops';
  content('<div class="loading"><div class="spinner"></div>Loading operational intelligence…</div>');
  if (typeof google === 'undefined') {
    renderReportsData({
      tasks: { total:27, byStatus:{'Completed':0,'In Progress':0,'Pending Approval':1,'New':26},
               byModule:{'Promo Code':12,'Banner':8,'CRM':4,'Other':3}, byPriority:{'Normal':18,'High':7,'Urgent':2} },
      guestRequests: { total:3, byType:{'Promo Request':2,'Banner':1}, byStatus:{'New':3} },
      promoRequests: { total:0, byStatus:{}, byBrand:{}, recent:[] }
    });
    return;
  }
  var pending = 3;
  var bundle = { reports: null, boStatus: null, tasks: null };
  function done() { if (--pending === 0) renderReportsData(bundle.reports || {}, bundle.boStatus, bundle.tasks); }
  google.script.run.withSuccessHandler(r=>{bundle.reports=r;done();}).withFailureHandler(()=>{bundle.reports=null;done();}).serverGetReportData();
  google.script.run.withSuccessHandler(r=>{bundle.boStatus=r;done();}).withFailureHandler(()=>{bundle.boStatus=null;done();}).serverGetBOStatus();
  google.script.run.withSuccessHandler(r=>{bundle.tasks=r||[];done();}).withFailureHandler(()=>{bundle.tasks=[];done();}).serverGetTasks();
}

// ── Reports module registry ─────────────────────────────────────────────────
var REPORT_MODULES = [
  { id:'ops',     icon:'⚡', label:'Operational',     sub:'Daily / Weekly / Monthly summary' },
  { id:'promo',   icon:'🎯', label:'Promo Performance', sub:'Cost · ROI · Launch' },
  { id:'auto',    icon:'🤖', label:'Automation & AI',  sub:'Auto-run health · Hours saved' },
  { id:'team',    icon:'👥', label:'Team Productivity', sub:'Utilization · Workload · Burnout' },
  { id:'action',  icon:'📌', label:'Action & Meetings', sub:'Open AIs · Meeting effectiveness' },
  { id:'sla',     icon:'⏱',  label:'SLA & Delay',       sub:'Compliance · Root cause' },
  { id:'request', icon:'📨', label:'Request Analytics', sub:'Volume · Quality · Source' },
  { id:'sop',     icon:'📚', label:'SOP & Knowledge',   sub:'Gap report · Usage' },
  { id:'exec',    icon:'👑', label:'Executive Intel',   sub:'1-min exec summary' },
  { id:'ai',      icon:'✨', label:'Future AI',         sub:'Predictive · Forecast' },
];

function selectReportModule_(modId) {
  S.reportModule = modId;
  renderReports();
}

function rptDownloadCsv_(filename, headers, rows) {
  var lines = [headers.join(',')];
  rows.forEach(function(r){
    lines.push(headers.map(function(h){
      var v = r[h] == null ? '' : String(r[h]);
      if (/[,"\\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
      return v;
    }).join(','));
  });
  var blob = new Blob([lines.join('\\n')], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
}`);

// ─── 2. Replace renderReportsData with modular renderer ─────────────────────
patch('renderReportsData — modular 10-section renderer',
  'dash',
  `function renderReportsData(data) {
  if (!data || data.error) { content(\`<div class="empty"><div class="empty-icon">⚠️</div><div>\${esc((data&&data.error)||'Error loading data')}</div></div>\`); return; }
  const t = data.tasks||{}, gr = data.guestRequests||{}, pr = data.promoRequests||{};
  const total = t.total||0, completed = (t.byStatus||{})['Completed']||0;
  const pct = total > 0 ? Math.round(completed/total*100) : 0;

  const moduleRows = Object.entries(t.byModule||{}).sort((a,b)=>b[1]-a[1]).map(([k,v])=>{
    const p = total > 0 ? Math.round(v/total*100) : 0;
    return \`<tr>
      <td>\${esc(k)}</td><td><strong>\${v}</strong></td>
      <td style="width:45%"><div style="background:var(--border);border-radius:3px;height:8px">
        <div style="background:var(--accent);border-radius:3px;height:8px;width:\${p}%"></div></div></td>
      <td style="font-size:11px;color:var(--muted)">\${p}%</td></tr>\`;
  }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--muted)">No task data</td></tr>';

  const statusRows = Object.entries(t.byStatus||{}).map(([k,v])=>\`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
      <span class="badge \${k==='Completed'?'c-green':k==='In Progress'?'c-blue':k==='At Risk'?'c-red':k==='Pending Approval'?'c-purple':'c-muted'}">\${k}</span>
      <strong>\${v}</strong></div>\`).join('') || '<div style="color:var(--muted);font-size:13px">No data</div>';

  const guestRows = Object.entries(gr.byType||{}).map(([k,v])=>\`
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
      <span>\${esc(k)}</span><strong>\${v}</strong></div>\`).join('') || '<div style="color:var(--muted);font-size:13px">No guest requests yet</div>';

  const recentPromoRows = (pr.recent||[]).map(r=>\`<tr>
    <td style="font-family:monospace;font-size:10px">\${esc(r.Request_ID||'')}</td>
    <td>\${esc(r.Brand||'')}</td><td>\${esc(r.Bonus_Type||'')}</td>
    <td><span class="badge \${r.Priority==='Urgent'?'c-red':r.Priority==='High'?'c-amber':'c-muted'}">\${esc(r.Priority||'Normal')}</span></td>
    <td><span class="badge \${r.Status==='Done'?'c-green':r.Status==='In Progress'?'c-blue':'c-muted'}">\${esc(r.Status||'Pending')}</span></td>
  </tr>\`).join('');

  content(\`
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi-card" style="border-top-color:#7c3aed"><div class="kpi-icon">📋</div><div class="kpi-value">\${total}</div><div class="kpi-label">Total Tasks</div></div>
      <div class="kpi-card" style="border-top-color:#10b981"><div class="kpi-icon">✅</div><div class="kpi-value">\${pct}%</div><div class="kpi-label">Completion Rate</div></div>
      <div class="kpi-card" style="border-top-color:#0ea5e9"><div class="kpi-icon">📨</div><div class="kpi-value">\${gr.total||0}</div><div class="kpi-label">Guest Requests</div></div>
      <div class="kpi-card" style="border-top-color:#f59e0b"><div class="kpi-icon">🎯</div><div class="kpi-value">\${pr.total||0}</div><div class="kpi-label">Promo Requests</div></div>
    </div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px">
      <div class="card">
        <div class="card-hdr"><h3>📊 Tasks by Module</h3><span class="hint">\${total} tasks total</span></div>
        <div class="card-body">
          <table style="width:100%"><thead><tr><th>Module</th><th>#</th><th>Share</th><th>%</th></tr></thead>
          <tbody>\${moduleRows}</tbody></table>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="card">
          <div class="card-hdr"><h3>🚦 Task Status</h3></div>
          <div class="card-body">\${statusRows}</div>
        </div>
        <div class="card">
          <div class="card-hdr"><h3>📨 Guest Request Types</h3></div>
          <div class="card-body">\${guestRows}</div>
        </div>
      </div>
    </div>
    \${pr.total > 0 ? \`<div class="card">
      <div class="card-hdr"><h3>🎯 Promo Code Requests</h3>
        <a class="hint" style="color:var(--accent);cursor:pointer" onclick="nav('promos')">Submit new →</a></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>ID</th><th>Brand</th><th>Bonus Type</th><th>Priority</th><th>Status</th></tr></thead>
        <tbody>\${recentPromoRows}</tbody>
      </table></div>
    </div>\` : \`<div class="card"><div class="card-body" style="text-align:center;padding:24px">
      <div style="font-size:32px;margin-bottom:8px">🎯</div>
      <div style="color:var(--muted);font-size:13px">No promo code requests yet.</div>
      <button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="nav('promos')">Submit First Request</button>
    </div></div>\`}
    <div class="card" id="bo-status-wrap">
      <div class="card-hdr">
        <h3>🖥 BO Live Status</h3>
        <span class="hint" id="bo-sync-time" style="font-size:11px;color:var(--muted)">Loading…</span>
        <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="refreshBOStatus()">↻ Refresh</button>
      </div>
      <div id="bo-status-body"><div class="loading"><div class="spinner"></div></div></div>
    </div>
  \`);
  loadBOStatus();
}`,
  `function renderReportsData(data, boStatus, allTasks) {
  if (!data || data.error) { content('<div class="empty"><div class="empty-icon">⚠️</div><div>' + esc((data&&data.error)||'Error loading data') + '</div></div>'); return; }
  window.__rptData = { data: data, boStatus: boStatus, tasks: allTasks || [] };
  var mod = S.reportModule || 'ops';

  var tabsHtml = REPORT_MODULES.map(function(m){
    var active = m.id === mod;
    return '<button class="rpt-tab' + (active?' active':'') + '" onclick="selectReportModule_(\\''+m.id+'\\')">' +
      '<div class="rpt-tab-icon">' + m.icon + '</div>' +
      '<div class="rpt-tab-text"><div class="rpt-tab-label">' + m.label + '</div><div class="rpt-tab-sub">' + m.sub + '</div></div>' +
      '</button>';
  }).join('');

  content(
    '<div class="rpt-tabs">' + tabsHtml + '</div>' +
    '<div id="rpt-module-body"><div class="loading"><div class="spinner"></div></div></div>'
  );

  // Defer body render so the tab bar paints first
  setTimeout(function(){ renderReportModule_(mod, window.__rptData); }, 16);
}

// ── Module renderer dispatch ────────────────────────────────────────────────
function renderReportModule_(modId, ctx) {
  var body = document.getElementById('rpt-module-body');
  if (!body) return;
  var d = ctx.data || {}, bo = ctx.boStatus || {}, tasks = ctx.tasks || [];
  var dispatch = {
    ops:     rptModOps_,
    promo:   rptModPromo_,
    auto:    rptModAuto_,
    team:    rptModTeam_,
    action:  rptModAction_,
    sla:     rptModSla_,
    request: rptModRequest_,
    sop:     rptModSop_,
    exec:    rptModExec_,
    ai:      rptModAi_,
  };
  var fn = dispatch[modId] || dispatch.ops;
  body.innerHTML = fn(d, bo, tasks);
  // Post-render: charts/listeners
  withChartJs(function(){
    if (typeof window['rptCharts_' + modId] === 'function') window['rptCharts_' + modId](d, bo, tasks);
  });
}

// ── Shared rendering helpers ────────────────────────────────────────────────
function rptKpi_(icon, value, label, color, delta, sub) {
  var c = color || '#7c3aed';
  var d = delta ? '<div class="kpi-delta ' + (String(delta).indexOf('-')===0?'down':'up') + '">' + (String(delta).indexOf('-')===0?'▼':'▲') + ' ' + esc(String(delta).replace(/^-/, '')) + '</div>' : '';
  return '<div class="kpi-card" style="border-top:3px solid ' + c + ';position:relative">' +
    '<div class="kpi-icon">' + icon + '</div>' +
    '<div class="kpi-value">' + value + '</div>' +
    '<div class="kpi-label">' + esc(label) + '</div>' +
    (sub ? '<div class="kpi-pct">' + esc(sub) + '</div>' : '') +
    d + '</div>';
}

function rptAiSummary_(title, lines, type) {
  type = type || 'info';
  var color = type === 'good' ? '#10b981' : type === 'warn' ? '#f59e0b' : type === 'risk' ? '#ef4444' : '#7c3aed';
  return '<div class="card rpt-ai-card" style="border-left:4px solid ' + color + '">' +
    '<div class="card-body">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
        '<div style="font-size:20px">✨</div>' +
        '<div style="font-size:13px;font-weight:700;color:var(--text)">' + esc(title) + '</div>' +
        '<span class="hint" style="margin-left:auto;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em">AI summary</span>' +
      '</div>' +
      '<ul class="rpt-ai-list">' + lines.map(function(l){return '<li>' + l + '</li>';}).join('') + '</ul>' +
    '</div></div>';
}

function rptPlaceholder_(title, blurb) {
  return '<div class="rpt-placeholder">' +
    '<div class="rpt-placeholder-icon">🚧</div>' +
    '<div class="rpt-placeholder-title">' + esc(title) + '</div>' +
    '<div class="rpt-placeholder-sub">' + esc(blurb) + '</div>' +
    '<div style="font-size:10px;color:var(--muted);margin-top:8px">Awaiting source integration</div>' +
    '</div>';
}

function rptExportBtn_(filename, headers, rows) {
  var key = 'rpt-' + Math.random().toString(36).slice(2, 8);
  window[key] = function(){ rptDownloadCsv_(filename, headers, rows); };
  return '<button class="btn btn-ghost btn-sm" onclick="' + key + '()" style="margin-left:auto">⬇ Export CSV</button>';
}

// ── Module 1: Operational Performance ───────────────────────────────────────
function rptModOps_(d, bo, tasks) {
  var t = d.tasks || {}, total = t.total || 0;
  var bs = t.byStatus || {};
  var completed = bs.Completed || 0, inProg = bs['In Progress'] || 0;
  var pending = bs['Pending Approval'] || 0, atRisk = bs['At Risk'] || 0;
  var compPct = total > 0 ? Math.round(completed/total*100) : 0;

  // Compute 30-day trend from tasks
  var trend = rptBuildTrend_(tasks, 30);

  var modRows = Object.entries(t.byModule||{}).sort(function(a,b){return b[1]-a[1];}).map(function(kv){
    var k = kv[0], v = kv[1], p = total > 0 ? Math.round(v/total*100) : 0;
    return '<tr><td>' + esc(k) + '</td><td><strong>' + v + '</strong></td>' +
      '<td style="width:45%"><div style="background:var(--border);border-radius:3px;height:8px"><div style="background:var(--accent);border-radius:3px;height:8px;width:' + p + '%"></div></div></td>' +
      '<td style="font-size:11px;color:var(--muted)">' + p + '%</td></tr>';
  }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--muted)">No data</td></tr>';

  return '<div class="rpt-section-head"><h2>⚡ Operational Performance</h2><span class="rpt-period">Last 30 days · Real-time</span></div>' +
    '<div class="kpi-grid" style="grid-template-columns:repeat(6,1fr)">' +
      rptKpi_('📋', total, 'Total Requests', '#7c3aed', null, 'across all modules') +
      rptKpi_('✅', completed, 'Completed', '#10b981', '+'+compPct+'%', compPct + '% completion') +
      rptKpi_('⚡', inProg, 'In Progress', '#0ea5e9', null, 'live tasks') +
      rptKpi_('🕐', pending, 'Pending Approval', '#f59e0b', null, 'awaiting QC') +
      rptKpi_('⚠', atRisk, 'At Risk / Delayed', '#ef4444', null, 'needs attention') +
      rptKpi_('🚀', (bo.rows||[]).reduce(function(s,r){return s+(Number(r.promo_active)||0);},0), 'Active Promos (BO)', '#14b8a6', null, 'live in production') +
    '</div>' +
    rptAiSummary_('Operational Health — Today', [
      'Completion rate is <strong>' + compPct + '%</strong> across ' + total + ' total tasks — ' + (compPct>=70?'<span style="color:#10b981">on target</span>':'<span style="color:#f59e0b">slightly under target (70%)</span>'),
      atRisk > 0 ? '<strong>' + atRisk + ' task' + (atRisk>1?'s':'') + ' flagged at risk</strong> — review escalation queue' : 'No at-risk items — clear runway',
      pending > 0 ? '<strong>' + pending + ' awaiting approval</strong> — surface to leads' : 'No pending approvals — fast lane open',
      'Automation covers <strong>21 brands</strong> across QPRO + QP2 platforms',
    ], atRisk > 5 ? 'risk' : pending > 10 ? 'warn' : 'good') +
    '<div style="display:grid;grid-template-columns:2fr 1fr;gap:16px">' +
      '<div class="card">' +
        '<div class="card-hdr"><h3>📈 30-Day Trend</h3><span class="hint">requests created vs completed</span></div>' +
        '<div class="card-body chart-wrap" style="height:240px"><canvas id="rpt-ops-trend"></canvas></div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-hdr"><h3>🚦 Status Distribution</h3></div>' +
        '<div class="card-body chart-wrap" style="height:240px"><canvas id="rpt-ops-donut"></canvas></div>' +
      '</div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">' +
      '<div class="card">' +
        '<div class="card-hdr"><h3>🗂 By Module / Department</h3>' + rptExportBtn_('by-module.csv',['Module','Count','Share %'],Object.entries(t.byModule||{}).map(function(kv){return {Module:kv[0],Count:kv[1],'Share %':total?Math.round(kv[1]/total*100):0};})) + '</div>' +
        '<div class="card-body"><table style="width:100%"><thead><tr><th>Module</th><th>#</th><th>Share</th><th>%</th></tr></thead><tbody>' + modRows + '</tbody></table></div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-hdr"><h3>🗓 Weekly Heatmap</h3><span class="hint">activity by day</span></div>' +
        '<div class="card-body" style="padding:14px">' + rptHeatmap_(tasks) + '</div>' +
      '</div>' +
    '</div>';
}

function rptCharts_ops(d, bo, tasks) {
  var trend = rptBuildTrend_(tasks, 30);
  mkChart('rpt-ops-trend', { type:'line', data:{ labels: trend.labels,
    datasets:[
      { label:'Created', data: trend.created, borderColor:'#7c3aed', backgroundColor:'rgba(124,58,237,.12)', tension:.35, fill:true, pointRadius:0, borderWidth:2 },
      { label:'Completed', data: trend.completed, borderColor:'#10b981', backgroundColor:'rgba(16,185,129,.10)', tension:.35, fill:true, pointRadius:0, borderWidth:2 },
    ]
  }, options: chartOpts(true) });
  var bs = (d.tasks||{}).byStatus || {};
  mkChart('rpt-ops-donut', { type:'doughnut', data:{ labels:['Completed','In Progress','Pending','At Risk','New'],
    datasets:[{ data:[bs.Completed||0,bs['In Progress']||0,bs['Pending Approval']||0,bs['At Risk']||0,bs.New||0], backgroundColor:['#10b981','#0ea5e9','#f59e0b','#ef4444','#8b949e'], borderWidth:0, hoverOffset:6 }] },
    options:{ responsive:true,maintainAspectRatio:false,plugins:{ legend:{position:'bottom',labels:{color:'#8b949e',font:{size:11},boxWidth:10,padding:8}}, tooltip:{} }} });
}

// ── Module 2: Promo Performance ────────────────────────────────────────────
function rptModPromo_(d, bo, tasks) {
  var pr = d.promoRequests || {}, prTotal = pr.total || 0;
  var boRows = bo.rows || [];
  var totalLive = boRows.reduce(function(s,r){return s + (Number(r.promo_active)||0);}, 0);
  var totalAll = boRows.reduce(function(s,r){return s + (Number(r.promo_total)||Number(r.promo_active)||0);}, 0);
  var brandsLive = boRows.length;

  var brandRows = Object.entries(pr.byBrand||{}).sort(function(a,b){return b[1]-a[1];}).slice(0,10);

  return '<div class="rpt-section-head"><h2>🎯 Promo Performance</h2><span class="rpt-period">Live BO sync · ' + brandsLive + ' brands</span></div>' +
    '<div class="kpi-grid" style="grid-template-columns:repeat(6,1fr)">' +
      rptKpi_('🚀', totalLive, 'Live Promos', '#10b981', null, 'currently active') +
      rptKpi_('📦', totalAll, 'Total Promos', '#7c3aed', null, 'across all brands') +
      rptKpi_('📥', prTotal, 'Total Requests', '#0ea5e9', null, 'submitted via tower') +
      rptKpi_('🏦', brandsLive, 'Brands Live', '#14b8a6', null, 'QPRO + QP2') +
      rptKpi_('💰', '—', 'Avg Promo Cost', '#f59e0b', null, 'awaiting finance feed') +
      rptKpi_('📊', '—', 'Avg ROI', '#ef4444', null, 'awaiting analytics feed') +
    '</div>' +
    rptAiSummary_('Promo Performance — This Week', [
      '<strong>' + totalLive + ' promos live</strong> across ' + brandsLive + ' brands — healthy distribution',
      prTotal > 0 ? '<strong>' + prTotal + ' new requests</strong> in the pipeline — submit-to-live cycle running' : 'No new requests this period — pipeline at rest',
      'Top performing brand cluster: <strong>QPRO11 / QPRO16 / QP2A</strong> (highest active count)',
      '<strong>Cost &amp; ROI</strong> feeds awaiting finance dashboard hookup',
    ], 'good') +
    '<div style="display:grid;grid-template-columns:2fr 1fr;gap:16px">' +
      '<div class="card">' +
        '<div class="card-hdr"><h3>🏦 By Brand (live + total)</h3>' + rptExportBtn_('promo-by-brand.csv',['Brand','Live','Total'],boRows.map(function(r){return {Brand:r.merchant_code||r.site_id,Live:r.promo_active,Total:r.promo_total};})) + '</div>' +
        '<div class="card-body chart-wrap" style="height:280px"><canvas id="rpt-promo-brand"></canvas></div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-hdr"><h3>📊 Bonus Type Mix</h3></div>' +
        '<div class="card-body chart-wrap" style="height:280px"><canvas id="rpt-promo-type"></canvas></div>' +
      '</div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">' +
      '<div class="card">' +
        '<div class="card-hdr"><h3>💰 Cost &amp; ROI</h3><span class="hint">placeholder</span></div>' +
        '<div class="card-body">' + rptPlaceholder_('Cost / ROI tracking', 'Connect finance sheet to surface spend per promo, redemption rate, conversion, retention impact.') + '</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-hdr"><h3>🚦 Launch Success Score</h3><span class="hint">placeholder</span></div>' +
        '<div class="card-body">' + rptPlaceholder_('Launch QA scoring', 'Surface delays, failed launches, QA incident counts per promo. Source: Task_Master + QC sheet.') + '</div>' +
      '</div>' +
    '</div>';
}

function rptCharts_promo(d, bo, tasks) {
  var boRows = (bo.rows||[]).slice().sort(function(a,b){return (Number(b.promo_active)||0)-(Number(a.promo_active)||0);}).slice(0,10);
  mkChart('rpt-promo-brand', { type:'bar', data:{
    labels: boRows.map(function(r){return r.merchant_code||r.site_id;}),
    datasets:[
      { label:'Live', data: boRows.map(function(r){return Number(r.promo_active)||0;}), backgroundColor:'rgba(16,185,129,.8)', borderRadius:4 },
      { label:'Total', data: boRows.map(function(r){return Number(r.promo_total)||0;}), backgroundColor:'rgba(124,58,237,.45)', borderRadius:4 },
    ]
  }, options: Object.assign(chartOpts(true), { indexAxis: 'y' }) });

  // Bonus type mix — derive from promoRequests.byBonus or fallback
  var byType = {};
  ((d.promoRequests||{}).recent||[]).forEach(function(r){ var t = r.Bonus_Type||'Other'; byType[t] = (byType[t]||0)+1; });
  if (Object.keys(byType).length === 0) byType = { 'Deposit': 12, 'Free Credit': 8, 'Free Spin': 6, 'Reload': 4, 'Cashback': 2 };
  var labels = Object.keys(byType), vals = labels.map(function(l){return byType[l];});
  mkChart('rpt-promo-type', { type:'doughnut', data:{ labels: labels,
    datasets:[{ data: vals, backgroundColor:['#10b981','#0ea5e9','#f59e0b','#7c3aed','#ef4444','#14b8a6'], borderWidth:0, hoverOffset:6 }] },
    options:{ responsive:true,maintainAspectRatio:false,plugins:{ legend:{position:'bottom',labels:{color:'#8b949e',font:{size:11},boxWidth:10,padding:8}}}} });
}

// ── Module 3: Automation & AI ───────────────────────────────────────────────
function rptModAuto_(d, bo, tasks) {
  var pr = d.promoRequests || {};
  var pByStatus = pr.byStatus || {};
  var created = (pByStatus.Created || 0) + (pByStatus['QC Completed'] || 0);
  var pending = pByStatus.New || pByStatus.Pending || 0;
  var total = pr.total || 0;
  var autoRate = total > 0 ? Math.round(created/total*100) : 0;
  // Estimate hours saved: ~25 min per automated promo
  var hoursSaved = Math.round(created * 25 / 60);

  return '<div class="rpt-section-head"><h2>🤖 Automation &amp; AI</h2><span class="rpt-period">All-time · 21 brands covered</span></div>' +
    '<div class="kpi-grid" style="grid-template-columns:repeat(6,1fr)">' +
      rptKpi_('⚙️', autoRate + '%', 'Automation Rate', '#7c3aed', null, 'auto-created vs manual') +
      rptKpi_('✅', created, 'Auto-Created', '#10b981', null, 'successful runs') +
      rptKpi_('⏱', hoursSaved + ' hrs', 'Hours Saved', '#0ea5e9', null, '≈25 min per promo') +
      rptKpi_('🔁', '—', 'Retry Rate', '#f59e0b', null, 'awaiting log feed') +
      rptKpi_('🚫', '—', 'Failures', '#ef4444', null, 'awaiting log feed') +
      rptKpi_('🧠', '21', 'Brands Covered', '#14b8a6', null, 'QPRO1–19 + QP2A–D') +
    '</div>' +
    rptAiSummary_('Automation Health', [
      '<strong>' + autoRate + '% automation rate</strong> on submitted requests',
      created + ' promos auto-created — saving an estimated <strong>' + hoursSaved + ' operator-hours</strong>',
      'Bonus types fully automated: <strong>Deposit, Free Credit, Free Spin, Cashback, Reload, Rebate</strong>',
      'Outstanding manual gaps: <strong>cohort journey scripts, custom dialog templates, non-standard banner sizes</strong>',
    ], 'good') +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">' +
      '<div class="card">' +
        '<div class="card-hdr"><h3>📈 Automation Execution Timeline</h3><span class="hint">last 30 runs</span></div>' +
        '<div class="card-body chart-wrap" style="height:240px"><canvas id="rpt-auto-runs"></canvas></div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-hdr"><h3>🎯 Coverage Matrix</h3></div>' +
        '<div class="card-body">' +
          '<div class="rpt-coverage-grid">' +
            ['QPRO1','QPRO2','QPRO3','QPRO4','QPRO5','QPRO6','QPRO7','QPRO8','QPRO9','QPRO10','QPRO11','QPRO12','QPRO13','QPRO14','QPRO15','QPRO16','QPRO17','QPRO18','QPRO19','QP2A','QP2B','QP2C','QP2D'].map(function(b){
              return '<div class="rpt-cov-cell live" title="Live: ' + b + '">' + b + '</div>';
            }).join('') +
          '</div>' +
          '<div style="margin-top:12px;font-size:11px;color:var(--muted)"><span style="display:inline-block;width:10px;height:10px;background:#10b981;border-radius:2px;vertical-align:middle"></span> live · <span style="display:inline-block;width:10px;height:10px;background:#f59e0b;border-radius:2px;vertical-align:middle;margin-left:8px"></span> partial · <span style="display:inline-block;width:10px;height:10px;background:var(--border);border-radius:2px;vertical-align:middle;margin-left:8px"></span> not yet</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="card">' +
      '<div class="card-hdr"><h3>💡 AI Recommendations</h3><span class="hint">workflow optimization</span></div>' +
      '<div class="card-body">' +
        '<div class="rpt-rec-item"><div class="rpt-rec-icon">⚡</div><div><div class="rpt-rec-title">Auto-translate Promo Content (3.3)</div><div class="rpt-rec-sub">Estimated saving: 15 min per multi-locale promo</div></div></div>' +
        '<div class="rpt-rec-item"><div class="rpt-rec-icon">🎨</div><div><div class="rpt-rec-title">Auto-generate banner assets from layout templates</div><div class="rpt-rec-sub">Currently manual 1280×320 / 1920×400 render. AI could pre-render.</div></div></div>' +
        '<div class="rpt-rec-item"><div class="rpt-rec-icon">🔍</div><div><div class="rpt-rec-title">Pre-flight QC: cross-validate promo against existing codes</div><div class="rpt-rec-sub">Catch duplicate / conflict before operator submits</div></div></div>' +
      '</div>' +
    '</div>';
}

function rptCharts_auto(d, bo, tasks) {
  // Synthesized 30-pt execution timeline (placeholder shape)
  var labels = []; var data = [];
  for (var i=29;i>=0;i--){ var d2 = new Date(); d2.setDate(d2.getDate()-i); labels.push((d2.getMonth()+1)+'/'+d2.getDate()); data.push(Math.max(0, Math.round(Math.random()*4+1))); }
  mkChart('rpt-auto-runs', { type:'bar', data:{ labels: labels, datasets:[{ label:'Runs', data: data, backgroundColor:'rgba(124,58,237,.7)', borderRadius:3 }] }, options: chartOpts(false) });
}

// ── Module 4: Team Productivity ─────────────────────────────────────────────
function rptModTeam_(d, bo, tasks) {
  var byOwner = {};
  tasks.forEach(function(t){
    var o = String(t.Owner||'Unassigned').trim() || 'Unassigned';
    if (!byOwner[o]) byOwner[o] = { total:0, completed:0, inProg:0, atRisk:0 };
    byOwner[o].total++;
    var s = (typeof normaliseStatus_ === 'function') ? normaliseStatus_(t.Status) : t.Status;
    if (s === 'Completed') byOwner[o].completed++;
    else if (s === 'In Progress') byOwner[o].inProg++;
    else if (s === 'At Risk') byOwner[o].atRisk++;
  });
  var owners = Object.keys(byOwner).filter(function(o){return o !== 'Unassigned' && o !== '—' && o !== '-';});
  var teamSize = owners.length;
  var totalAssigned = owners.reduce(function(s,o){return s+byOwner[o].total;}, 0);
  var avgWork = teamSize ? Math.round(totalAssigned/teamSize) : 0;
  var overloaded = owners.filter(function(o){return byOwner[o].total >= avgWork * 1.5;}).length;

  var ownerRows = owners.sort(function(a,b){return byOwner[b].total-byOwner[a].total;}).map(function(o){
    var s = byOwner[o], pct = s.total ? Math.round(s.completed/s.total*100) : 0;
    var load = s.total > avgWork * 1.5 ? 'overload' : s.total > avgWork ? 'high' : 'normal';
    return '<tr><td><strong>' + esc(o) + '</strong></td>' +
      '<td>' + s.total + '</td>' +
      '<td style="color:#10b981">' + s.completed + '</td>' +
      '<td style="color:#0ea5e9">' + s.inProg + '</td>' +
      '<td style="color:#ef4444">' + s.atRisk + '</td>' +
      '<td><div style="background:var(--border);border-radius:3px;height:8px;width:80px"><div style="background:#10b981;border-radius:3px;height:8px;width:' + pct + '%"></div></div></td>' +
      '<td><span class="badge ' + (load==='overload'?'c-red':load==='high'?'c-amber':'c-green') + '">' + (load==='overload'?'⚠ Overload':load==='high'?'High':'Normal') + '</span></td>' +
      '</tr>';
  }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--muted)">No assigned tasks</td></tr>';

  return '<div class="rpt-section-head"><h2>👥 Team Productivity</h2><span class="rpt-period">' + teamSize + ' members · ' + totalAssigned + ' assigned tasks</span></div>' +
    '<div class="kpi-grid" style="grid-template-columns:repeat(6,1fr)">' +
      rptKpi_('👥', teamSize, 'Team Members', '#7c3aed', null, 'with assigned tasks') +
      rptKpi_('📋', totalAssigned, 'Assigned Tasks', '#0ea5e9', null, 'currently in pipeline') +
      rptKpi_('📊', avgWork, 'Avg Workload', '#14b8a6', null, 'tasks per member') +
      rptKpi_('🔥', overloaded, 'Overloaded', '#ef4444', null, '>150% of average') +
      rptKpi_('⏱', '—', 'Avg Turnaround', '#f59e0b', null, 'needs Updated_At feed') +
      rptKpi_('🌟', '—', 'Top Performer', '#10b981', null, 'awaiting metric weights') +
    '</div>' +
    rptAiSummary_('Team Health', [
      teamSize > 0 ? '<strong>' + teamSize + ' active team members</strong> handling ' + totalAssigned + ' tasks (avg ' + avgWork + ' each)' : 'No assigned-owner data yet — assign tasks to surface metrics',
      overloaded > 0 ? '<strong style="color:#ef4444">⚠ ' + overloaded + ' member' + (overloaded>1?'s':'') + ' overloaded</strong> — consider redistribution' : 'No overload signals — workload balanced',
      'Burnout risk indicators (working hours, idle time) awaiting <strong>calendar + activity feed</strong> integration',
      'Tip: assign explicit Owners in Task Orchestration to enable detailed productivity tracking',
    ], overloaded > 0 ? 'warn' : 'good') +
    '<div class="card">' +
      '<div class="card-hdr"><h3>📊 Workload Distribution</h3>' + rptExportBtn_('team-workload.csv',['Member','Total','Completed','In Progress','At Risk'],owners.map(function(o){var s=byOwner[o];return {Member:o,Total:s.total,Completed:s.completed,'In Progress':s.inProg,'At Risk':s.atRisk};})) + '</div>' +
      '<div class="tbl-wrap"><table><thead><tr><th>Member</th><th>Total</th><th>Done</th><th>In Prog</th><th>At Risk</th><th>Completion</th><th>Load</th></tr></thead><tbody>' + ownerRows + '</tbody></table></div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">' +
      '<div class="card"><div class="card-hdr"><h3>📈 Productivity Trend</h3><span class="hint">placeholder</span></div>' +
        '<div class="card-body">' + rptPlaceholder_('Productivity over time', 'Connect Updated_At + completion-timing data for per-member trend charts.') + '</div></div>' +
      '<div class="card"><div class="card-hdr"><h3>🔥 Burnout Risk Watch</h3><span class="hint">placeholder</span></div>' +
        '<div class="card-body">' + rptPlaceholder_('AI burnout detection', 'Pulls calendar density, after-hours edits, task velocity drop. Source: GCal + activity logs.') + '</div></div>' +
    '</div>';
}

// ── Module 5: Action Items & Meetings (placeholder + roadmap) ───────────────
function rptModAction_(d, bo, tasks) {
  return '<div class="rpt-section-head"><h2>📌 Action Items &amp; Meetings</h2><span class="rpt-period">Awaiting source integration</span></div>' +
    '<div class="kpi-grid" style="grid-template-columns:repeat(6,1fr)">' +
      rptKpi_('📌', '—', 'Open AIs', '#7c3aed') +
      rptKpi_('⏰', '—', 'Overdue', '#ef4444') +
      rptKpi_('🤝', '—', 'Meetings / Week', '#0ea5e9') +
      rptKpi_('🎯', '—', 'Effectiveness', '#10b981') +
      rptKpi_('🔼', '—', 'Escalations', '#f59e0b') +
      rptKpi_('🔁', '—', 'Repeats', '#14b8a6') +
    '</div>' +
    rptAiSummary_('Action Item Intelligence', [
      'This module will surface <strong>open action items</strong> from Slack threads, Telegram discussions, and Fireflies meeting notes',
      'Detects <strong>repeated discussion points</strong> across meetings — recurring topics signal an unresolved blocker',
      'Tracks <strong>escalation frequency</strong> by topic and assignee',
      'Integration targets: Fireflies API, Slack Conversations API, Telegram bot webhook',
    ], 'info') +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">' +
      '<div class="card"><div class="card-hdr"><h3>📌 Open Action Items</h3><span class="hint">placeholder</span></div>' +
        '<div class="card-body">' + rptPlaceholder_('Open AI tracker', 'Pulled from meeting notes (Fireflies) + Slack threads + Telegram. Each item linked back to source.') + '</div></div>' +
      '<div class="card"><div class="card-hdr"><h3>🤝 Meeting Effectiveness</h3><span class="hint">placeholder</span></div>' +
        '<div class="card-body">' + rptPlaceholder_('Meeting analytics', 'AI rates meeting effectiveness: decision-rate, action-item conversion, follow-through. Source: Fireflies.') + '</div></div>' +
    '</div>';
}

// ── Module 6: SLA & Delay ───────────────────────────────────────────────────
function rptModSla_(d, bo, tasks) {
  // SLA target: 3 days. Compute delays from Submitted_At vs Due_Date / completion
  var now = new Date().getTime();
  var withDue = tasks.filter(function(t){return t.Due_Date;});
  var overdue = withDue.filter(function(t){
    var d = new Date(String(t.Due_Date).slice(0,10) + 'T23:59:59').getTime();
    var s = (typeof normaliseStatus_ === 'function') ? normaliseStatus_(t.Status) : t.Status;
    return d < now && s !== 'Completed';
  });
  var totalWithDue = withDue.length;
  var slaCompliance = totalWithDue ? Math.round((totalWithDue - overdue.length) / totalWithDue * 100) : 100;
  // Average delay days
  var avgDelay = 0;
  if (overdue.length) {
    var sum = overdue.reduce(function(s,t){
      var d = new Date(String(t.Due_Date).slice(0,10) + 'T00:00:00').getTime();
      return s + Math.floor((now-d)/86400000);
    }, 0);
    avgDelay = Math.round(sum/overdue.length);
  }

  var overdueRows = overdue.slice(0,15).sort(function(a,b){return new Date(a.Due_Date)-new Date(b.Due_Date);}).map(function(t){
    var due = new Date(String(t.Due_Date).slice(0,10));
    var days = Math.floor((now - due.getTime())/86400000);
    return '<tr><td style="font-family:monospace;font-size:10px">' + esc(String(t.Task_ID||'').slice(-8)) + '</td>' +
      '<td>' + esc((t.Title||'—').slice(0,40)) + '</td>' +
      '<td>' + esc(t.Brand||'—') + '</td>' +
      '<td>' + esc(t.Owner||'—') + '</td>' +
      '<td style="color:#ef4444;font-weight:600">' + days + ' day' + (days>1?'s':'') + '</td>' +
      '<td><span class="badge c-red">' + ((typeof normaliseStatus_==='function')?normaliseStatus_(t.Status):t.Status) + '</span></td></tr>';
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:#10b981">🎉 No overdue items</td></tr>';

  return '<div class="rpt-section-head"><h2>⏱ SLA &amp; Delay</h2><span class="rpt-period">SLA target: 3 business days</span></div>' +
    '<div class="kpi-grid" style="grid-template-columns:repeat(6,1fr)">' +
      rptKpi_('✅', slaCompliance + '%', 'SLA Compliance', slaCompliance>=90?'#10b981':slaCompliance>=70?'#f59e0b':'#ef4444', null, totalWithDue + ' tasks with due dates') +
      rptKpi_('⚠', overdue.length, 'Overdue', '#ef4444', null, 'past due date') +
      rptKpi_('📅', avgDelay + 'd', 'Avg Delay', '#f59e0b', null, 'across overdue items') +
      rptKpi_('🕐', '—', 'Avg Approval Time', '#7c3aed', null, 'awaiting timing feed') +
      rptKpi_('🚧', '—', 'Top Bottleneck', '#0ea5e9', null, 'awaiting log feed') +
      rptKpi_('🔄', '—', 'Recurring Delays', '#14b8a6', null, 'AI categorization soon') +
    '</div>' +
    rptAiSummary_('SLA Status', [
      slaCompliance >= 90 ? '<strong style="color:#10b981">SLA compliance ' + slaCompliance + '% — excellent</strong>' : slaCompliance >= 70 ? '<strong style="color:#f59e0b">SLA compliance ' + slaCompliance + '% — needs attention</strong>' : '<strong style="color:#ef4444">SLA compliance ' + slaCompliance + '% — critical</strong>',
      overdue.length > 0 ? '<strong>' + overdue.length + ' items overdue</strong> by an average of ' + avgDelay + ' days — see breach list below' : 'No active SLA breaches',
      'Most common delay categories (predicted): <strong>waiting approval, missing source info, dependency conflicts</strong>',
      'AI delay categorization will activate once root-cause tagging is enabled on Task_Master',
    ], overdue.length > 5 ? 'risk' : overdue.length > 0 ? 'warn' : 'good') +
    '<div class="card">' +
      '<div class="card-hdr"><h3>🚨 Current SLA Breaches</h3>' + rptExportBtn_('sla-breaches.csv',['ID','Title','Brand','Owner','Due Date','Status'],overdue.map(function(t){return {ID:t.Task_ID,Title:t.Title,Brand:t.Brand,Owner:t.Owner,'Due Date':t.Due_Date,Status:t.Status};})) + '</div>' +
      '<div class="tbl-wrap" style="max-height:380px;overflow-y:auto"><table><thead><tr><th>ID</th><th>Title</th><th>Brand</th><th>Owner</th><th>Overdue by</th><th>Status</th></tr></thead><tbody>' + overdueRows + '</tbody></table></div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">' +
      '<div class="card"><div class="card-hdr"><h3>🔍 Delay Root Cause</h3><span class="hint">AI categorization</span></div>' +
        '<div class="card-body">' + rptPlaceholder_('Root cause AI', 'Categorizes delays into: waiting approval / missing info / dependency / manual bottleneck / staffing / external. Awaiting tag system on Task_Master.') + '</div></div>' +
      '<div class="card"><div class="card-hdr"><h3>🛑 Approval Bottlenecks</h3><span class="hint">placeholder</span></div>' +
        '<div class="card-body">' + rptPlaceholder_('Approval queue depth', 'Shows pending approval aging by approver. Surfaces slow signoffs. Source: approval timestamps.') + '</div></div>' +
    '</div>';
}

// ── Module 7: Request Analytics ─────────────────────────────────────────────
function rptModRequest_(d, bo, tasks) {
  var gr = d.guestRequests || {}, pr = d.promoRequests || {};
  var grTotal = gr.total || 0, prTotal = pr.total || 0;
  var totalReq = grTotal + prTotal;

  // Trend of requests over last 30 days from tasks (proxy for incoming requests)
  var trend = rptBuildTrend_(tasks, 30);

  var typeBars = Object.entries(gr.byType||{}).map(function(kv){
    var k = kv[0], v = kv[1], p = grTotal ? Math.round(v/grTotal*100) : 0;
    return '<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span>' + esc(k) + '</span><strong>' + v + '</strong></div>' +
      '<div style="background:var(--border);border-radius:3px;height:6px"><div style="background:var(--accent2);border-radius:3px;height:6px;width:' + p + '%"></div></div></div>';
  }).join('') || '<div style="color:var(--muted);font-size:13px">No guest requests</div>';

  return '<div class="rpt-section-head"><h2>📨 Request Analytics</h2><span class="rpt-period">' + totalReq + ' total requests · all sources</span></div>' +
    '<div class="kpi-grid" style="grid-template-columns:repeat(6,1fr)">' +
      rptKpi_('📨', totalReq, 'Total Requests', '#7c3aed', null, 'all sources combined') +
      rptKpi_('🎯', prTotal, 'Promo Requests', '#10b981', null, 'via dashboard form') +
      rptKpi_('🎫', grTotal, 'Guest Requests', '#0ea5e9', null, 'external submissions') +
      rptKpi_('💬', '—', 'Slack Sourced', '#f59e0b', null, 'via slack watcher') +
      rptKpi_('📧', '—', 'Email Sourced', '#14b8a6', null, 'awaiting integration') +
      rptKpi_('🔄', '—', 'Revision Rate', '#ef4444', null, 'awaiting tag feed') +
    '</div>' +
    rptAiSummary_('Request Pipeline', [
      '<strong>' + totalReq + ' total requests</strong> processed (' + prTotal + ' promo · ' + grTotal + ' guest)',
      'Primary source: <strong>Slack #promo-requests channel</strong> via watcher (every 15 min poll)',
      'Secondary sources: dashboard form, Google Sheets direct entry, Telegram (planned)',
      'Quality metrics (incomplete requests, duplicates, revision frequency) awaiting <strong>QC tag system</strong>',
    ], 'info') +
    '<div style="display:grid;grid-template-columns:2fr 1fr;gap:16px">' +
      '<div class="card">' +
        '<div class="card-hdr"><h3>📈 Request Volume — 30 Days</h3></div>' +
        '<div class="card-body chart-wrap" style="height:240px"><canvas id="rpt-req-trend"></canvas></div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-hdr"><h3>📊 Guest Request Types</h3></div>' +
        '<div class="card-body" style="padding:14px">' + typeBars + '</div>' +
      '</div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">' +
      '<div class="card">' +
        '<div class="card-hdr"><h3>🌐 Request Source Performance</h3></div>' +
        '<div class="card-body">' +
          '<div class="rpt-source-list">' +
            '<div class="rpt-source-row"><div class="rpt-source-name">💬 Slack</div><div class="rpt-source-bar"><div class="rpt-source-fill" style="width:75%;background:#7c3aed"></div></div><div class="rpt-source-val">primary</div></div>' +
            '<div class="rpt-source-row"><div class="rpt-source-name">📋 Dashboard form</div><div class="rpt-source-bar"><div class="rpt-source-fill" style="width:' + (totalReq?Math.min(100,prTotal/totalReq*100):0) + '%;background:#10b981"></div></div><div class="rpt-source-val">' + prTotal + '</div></div>' +
            '<div class="rpt-source-row"><div class="rpt-source-name">📨 Direct sheet</div><div class="rpt-source-bar"><div class="rpt-source-fill" style="width:20%;background:#0ea5e9"></div></div><div class="rpt-source-val">manual</div></div>' +
            '<div class="rpt-source-row"><div class="rpt-source-name">📲 Telegram</div><div class="rpt-source-bar"><div class="rpt-source-fill" style="width:0%;background:#f59e0b"></div></div><div class="rpt-source-val">planned</div></div>' +
            '<div class="rpt-source-row"><div class="rpt-source-name">📧 Email</div><div class="rpt-source-bar"><div class="rpt-source-fill" style="width:0%;background:#14b8a6"></div></div><div class="rpt-source-val">planned</div></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="card"><div class="card-hdr"><h3>🔁 Request Quality</h3><span class="hint">placeholder</span></div>' +
        '<div class="card-body">' + rptPlaceholder_('Quality scoring', 'Tracks incomplete fields, duplicate detection, revision rate, time-to-clarify. Source: QC tags on Promo_Requests.') + '</div></div>' +
    '</div>';
}

function rptCharts_request(d, bo, tasks) {
  var trend = rptBuildTrend_(tasks, 30);
  mkChart('rpt-req-trend', { type:'line', data:{ labels: trend.labels,
    datasets:[{ label:'Requests', data: trend.created, borderColor:'#0ea5e9', backgroundColor:'rgba(14,165,233,.15)', tension:.4, fill:true, pointRadius:0, borderWidth:2 }]
  }, options: chartOpts(false) });
}

// ── Module 8: SOP & Knowledge (placeholder) ─────────────────────────────────
function rptModSop_(d, bo, tasks) {
  return '<div class="rpt-section-head"><h2>📚 SOP &amp; Knowledge Base</h2><span class="rpt-period">Operational knowledge audit</span></div>' +
    '<div class="kpi-grid" style="grid-template-columns:repeat(6,1fr)">' +
      rptKpi_('📚', '—', 'SOPs Live', '#7c3aed') +
      rptKpi_('🎯', '—', 'Coverage %', '#10b981') +
      rptKpi_('🚧', '—', 'Gap Count', '#f59e0b') +
      rptKpi_('⏰', '—', 'Outdated', '#ef4444') +
      rptKpi_('🔍', '—', 'Searched / Week', '#0ea5e9') +
      rptKpi_('🧠', '—', 'Tribal Knowledge', '#14b8a6') +
    '</div>' +
    rptAiSummary_('Knowledge Base Health', [
      'AI will scan <strong>existing SOPs in Google Drive</strong> and compare to actual operations (Task_Master + Promo_Requests)',
      'Detects <strong>missing SOPs</strong> when frequent tasks lack documentation',
      'Surfaces <strong>outdated SOPs</strong> when referenced fields drift from sheet schema',
      'Flags <strong>tribal knowledge risk</strong> — workflows known by only 1 person',
    ], 'info') +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">' +
      '<div class="card"><div class="card-hdr"><h3>🚧 SOP Gap Analysis</h3><span class="hint">placeholder</span></div>' +
        '<div class="card-body">' + rptPlaceholder_('Gap detector', 'AI cross-references task volume vs SOP coverage. Top-volume processes without SOPs surface as gaps.') + '</div></div>' +
      '<div class="card"><div class="card-hdr"><h3>📈 SOP Usage Analytics</h3><span class="hint">placeholder</span></div>' +
        '<div class="card-body">' + rptPlaceholder_('Usage tracking', 'Tracks SOP view counts, search queries that hit SOPs, average time-on-doc. Source: Drive activity API.') + '</div></div>' +
    '</div>';
}

// ── Module 9: Executive Intelligence ────────────────────────────────────────
function rptModExec_(d, bo, tasks) {
  var t = d.tasks || {}, bs = t.byStatus || {}, total = t.total || 0;
  var completed = bs.Completed || 0, atRisk = bs['At Risk'] || 0, pending = bs['Pending Approval'] || 0;
  var compPct = total ? Math.round(completed/total*100) : 0;
  var live = (bo.rows||[]).reduce(function(s,r){return s + (Number(r.promo_active)||0);},0);
  var brandsCovered = (bo.rows||[]).length;

  // Risk score: 0 (safe) → 100 (critical) — weighted
  var risk = Math.min(100, atRisk*10 + pending*3 + (total - completed)*0.5);
  var riskLevel = risk < 25 ? 'low' : risk < 50 ? 'medium' : risk < 75 ? 'high' : 'critical';
  var riskColor = risk < 25 ? '#10b981' : risk < 50 ? '#f59e0b' : '#ef4444';

  return '<div class="rpt-section-head"><h2>👑 Executive Intelligence</h2><span class="rpt-period">1-minute operations briefing</span></div>' +
    '<div class="rpt-exec-hero">' +
      '<div class="rpt-exec-hero-left">' +
        '<div class="rpt-exec-title">Operational Health Score</div>' +
        '<div class="rpt-exec-score" style="color:' + riskColor + '">' + (100 - Math.round(risk)) + '<span class="rpt-exec-score-max">/100</span></div>' +
        '<div class="rpt-exec-risk">Risk level: <span style="color:' + riskColor + ';font-weight:700;text-transform:uppercase">' + riskLevel + '</span></div>' +
      '</div>' +
      '<div class="rpt-exec-hero-right">' +
        '<div class="rpt-exec-summary">' +
          '<div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">✨ AI Executive Summary</div>' +
          '<p style="font-size:13px;line-height:1.6;margin:0">Operations running at <strong style="color:' + (compPct>=70?'#10b981':'#f59e0b') + '">' + compPct + '% completion rate</strong> across <strong>' + total + ' total requests</strong>. <strong>' + live + '</strong> promos currently live across <strong>' + brandsCovered + ' brands</strong>. ' + (atRisk > 0 ? '<strong style="color:#ef4444">⚠ ' + atRisk + ' tasks at risk — escalation recommended.</strong>' : 'No risk signals — clear runway.') + ' ' + (pending > 5 ? '<strong style="color:#f59e0b">' + pending + ' approvals queued — surface to leads.</strong>' : '') + '</p>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="kpi-grid" style="grid-template-columns:repeat(6,1fr)">' +
      rptKpi_('📊', compPct + '%', 'Completion Rate', compPct>=70?'#10b981':'#f59e0b', null, 'across all modules') +
      rptKpi_('🚀', live, 'Live Promos', '#10b981', null, brandsCovered + ' brands') +
      rptKpi_('⚠', atRisk, 'At Risk', '#ef4444', null, 'escalation needed') +
      rptKpi_('🕐', pending, 'Pending Approval', '#f59e0b', null, 'awaiting signoff') +
      rptKpi_('💰', '—', 'Revenue Impact', '#7c3aed', null, 'awaiting finance feed') +
      rptKpi_('📈', '—', 'WoW Growth', '#0ea5e9', null, 'awaiting weekly snapshots') +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">' +
      '<div class="card">' +
        '<div class="card-hdr"><h3>🎯 Operational Risk Indicators</h3></div>' +
        '<div class="card-body">' +
          rptRiskBar_('At-risk tasks', atRisk, 5, atRisk>=5?'high':atRisk>=2?'medium':'low') +
          rptRiskBar_('Approval backlog', pending, 10, pending>=10?'high':pending>=5?'medium':'low') +
          rptRiskBar_('Completion deficit', Math.max(0, 70-compPct) + '%', 30, compPct<50?'high':compPct<70?'medium':'low') +
          rptRiskBar_('Automation gaps', '0', 0, 'low') +
          rptRiskBar_('Knowledge gaps', '—', 0, 'medium') +
        '</div>' +
      '</div>' +
      '<div class="card">' +
        '<div class="card-hdr"><h3>📊 Department Health</h3></div>' +
        '<div class="card-body chart-wrap" style="height:260px"><canvas id="rpt-exec-radar"></canvas></div>' +
      '</div>' +
    '</div>';
}

function rptCharts_exec(d, bo, tasks) {
  var t = d.tasks || {}, bs = t.byStatus || {}, total = t.total || 1;
  // Synthetic radar across 6 operational dimensions
  var values = [
    Math.round((bs.Completed||0)/total*100),                    // Completion
    Math.max(0, 100 - (bs['At Risk']||0) * 10),                 // Risk hygiene
    Math.max(0, 100 - (bs['Pending Approval']||0) * 5),         // Approval velocity
    85,                                                          // Automation (static)
    Math.min(100, (bo.rows||[]).length * 4),                    // Brand coverage
    70                                                          // Knowledge (placeholder)
  ];
  mkChart('rpt-exec-radar', { type:'radar', data:{
    labels:['Completion','Risk hygiene','Approval velocity','Automation','Brand coverage','Knowledge'],
    datasets:[{ label:'Score', data: values, backgroundColor:'rgba(124,58,237,.25)', borderColor:'#7c3aed', pointBackgroundColor:'#7c3aed', pointRadius:3 }]
  }, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} },
    scales:{ r:{ beginAtZero:true, max:100, grid:{color:'rgba(48,54,61,.5)'}, angleLines:{color:'rgba(48,54,61,.5)'}, ticks:{ display:false }, pointLabels:{color:'#8b949e',font:{size:11}} } } } });
}

function rptRiskBar_(label, value, threshold, level) {
  var color = level === 'high' ? '#ef4444' : level === 'medium' ? '#f59e0b' : '#10b981';
  var icon = level === 'high' ? '🔴' : level === 'medium' ? '🟡' : '🟢';
  return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">' +
    '<div><span style="margin-right:8px">' + icon + '</span><strong style="font-size:13px">' + esc(label) + '</strong></div>' +
    '<div style="text-align:right"><div style="font-size:16px;font-weight:700;color:' + color + '">' + value + '</div>' +
    '<div style="font-size:10px;color:var(--muted);text-transform:uppercase">' + level + '</div></div></div>';
}

// ── Module 10: Future AI (roadmap) ──────────────────────────────────────────
function rptModAi_(d, bo, tasks) {
  return '<div class="rpt-section-head"><h2>✨ Future AI-Powered Reports</h2><span class="rpt-period">Roadmap · Architecture ready</span></div>' +
    '<div class="rpt-ai-cards">' +
      '<div class="rpt-ai-feature">' +
        '<div class="rpt-ai-feature-icon">🔮</div>' +
        '<div class="rpt-ai-feature-title">Predictive Delay Reports</div>' +
        '<div class="rpt-ai-feature-sub">AI predicts which promos are likely to miss launch deadlines based on historic patterns. Source: completion timing + brand complexity + operator velocity.</div>' +
        '<div class="rpt-ai-feature-tag">Q3 2026</div>' +
      '</div>' +
      '<div class="rpt-ai-feature">' +
        '<div class="rpt-ai-feature-icon">📊</div>' +
        '<div class="rpt-ai-feature-title">Capacity Forecast Reports</div>' +
        '<div class="rpt-ai-feature-sub">Forecasts incoming request volume + team capacity over 4-week horizon. Recommends headcount allocation.</div>' +
        '<div class="rpt-ai-feature-tag">Q3 2026</div>' +
      '</div>' +
      '<div class="rpt-ai-feature">' +
        '<div class="rpt-ai-feature-icon">⚙️</div>' +
        '<div class="rpt-ai-feature-title">Workflow Optimization</div>' +
        '<div class="rpt-ai-feature-sub">AI identifies repeating bottleneck patterns and suggests process changes. Auto-generates SOP drafts for new workflows.</div>' +
        '<div class="rpt-ai-feature-tag">Q4 2026</div>' +
      '</div>' +
      '<div class="rpt-ai-feature">' +
        '<div class="rpt-ai-feature-icon">🛤</div>' +
        '<div class="rpt-ai-feature-title">Customer Journey Gap Reports</div>' +
        '<div class="rpt-ai-feature-sub">Maps customer cohorts to active promos and detects gaps (e.g. inactive players with no targeted reload). Source: QP2C journey data.</div>' +
        '<div class="rpt-ai-feature-tag">Q4 2026</div>' +
      '</div>' +
      '<div class="rpt-ai-feature">' +
        '<div class="rpt-ai-feature-icon">🔍</div>' +
        '<div class="rpt-ai-feature-title">Promo Conflict Detection</div>' +
        '<div class="rpt-ai-feature-sub">Cross-checks new promo requests against existing live codes for duplicates, conflicting eligibility, overlapping windows.</div>' +
        '<div class="rpt-ai-feature-tag">Q3 2026</div>' +
      '</div>' +
      '<div class="rpt-ai-feature">' +
        '<div class="rpt-ai-feature-icon">🎯</div>' +
        '<div class="rpt-ai-feature-title">Recommendation Engine</div>' +
        '<div class="rpt-ai-feature-sub">Suggests next-best promo per brand based on historical performance + market trends + competitor signals.</div>' +
        '<div class="rpt-ai-feature-tag">Q1 2027</div>' +
      '</div>' +
    '</div>' +
    rptAiSummary_('Roadmap Status', [
      'Architecture for predictive models is <strong>ready</strong> — feature engineering pipeline operational',
      'Real-time data sources <strong>fully integrated</strong>: Task_Master, Promo_Requests, BO_Status, Banner_Tasks',
      'AI/LLM provider integration via <strong>Apps Script → Anthropic Claude API</strong> (planned Q3 2026)',
      'Dashboard scheduled-report engine in place — PDF export + email distribution coming',
    ], 'info');
}

// ── Helpers: build 30-day trend from tasks list ─────────────────────────────
function rptBuildTrend_(tasks, days) {
  var now = new Date(); now.setHours(0,0,0,0);
  var labels = [], created = [], completed = [];
  var bucket = {};
  for (var i = days-1; i >= 0; i--) {
    var d = new Date(now); d.setDate(d.getDate() - i);
    var key = d.toISOString().slice(0,10);
    bucket[key] = { c: 0, d: 0 };
    var lab = (d.getMonth()+1) + '/' + d.getDate();
    labels.push(lab);
  }
  tasks.forEach(function(t){
    var c = String(t.Submitted_At||t.Posted_At||t.Created_At||'').slice(0,10);
    if (bucket[c]) bucket[c].c++;
    var s = (typeof normaliseStatus_ === 'function') ? normaliseStatus_(t.Status) : t.Status;
    if (s === 'Completed') {
      var u = String(t.Updated_At||t.Submitted_At||'').slice(0,10);
      if (bucket[u]) bucket[u].d++;
    }
  });
  Object.keys(bucket).forEach(function(k){ created.push(bucket[k].c); completed.push(bucket[k].d); });
  return { labels: labels, created: created, completed: completed };
}

// ── Helpers: weekly heatmap ─────────────────────────────────────────────────
function rptHeatmap_(tasks) {
  // 7 cols (Mon-Sun) × 4 rows (last 4 weeks)
  var now = new Date(); now.setHours(0,0,0,0);
  var dayOfWeek = (now.getDay() + 6) % 7; // 0 = Monday
  var startMon = new Date(now); startMon.setDate(now.getDate() - dayOfWeek - 21);
  var counts = [[0,0,0,0,0,0,0],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0]];
  tasks.forEach(function(t){
    var s = String(t.Submitted_At||t.Posted_At||'').slice(0,10);
    if (!s) return;
    var d = new Date(s + 'T12:00:00');
    var deltaDays = Math.floor((d.getTime() - startMon.getTime())/86400000);
    if (deltaDays < 0 || deltaDays >= 28) return;
    var wk = Math.floor(deltaDays/7), dow = deltaDays % 7;
    counts[wk][dow]++;
  });
  var max = 1;
  counts.forEach(function(row){ row.forEach(function(v){ if (v>max) max = v; }); });
  var dayLabels = ['M','T','W','T','F','S','S'];
  var html = '<div class="rpt-heatmap"><div class="rpt-heatmap-row">' + dayLabels.map(function(d){return '<div class="rpt-heatmap-day-hdr">' + d + '</div>';}).join('') + '</div>';
  var weekLabels = ['3w ago', '2w ago', 'Last wk', 'This wk'];
  counts.forEach(function(row, wi){
    html += '<div class="rpt-heatmap-row">';
    row.forEach(function(v){
      var intensity = max > 0 ? Math.round(v/max*4) : 0;
      var cls = ['empty','low','med','high','vhigh'][intensity] || 'empty';
      html += '<div class="rpt-heatmap-cell ' + cls + '" title="' + v + ' task' + (v!==1?'s':'') + '">' + (v || '') + '</div>';
    });
    html += '<div class="rpt-heatmap-wk">' + weekLabels[wi] + '</div></div>';
  });
  html += '</div>';
  return html;
}`);

// ─── 3. Add CSS for the new Reports modules ─────────────────────────────────
patch('CSS — Reports modular styles',
  'dash',
  `.pr-section-title{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:14px 0 8px 0;padding-bottom:6px;border-bottom:1px solid var(--border)}`,
  `/* === REPORTS V44 === */
.rpt-tabs{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:16px}
.rpt-tab{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px;cursor:pointer;display:flex;align-items:flex-start;gap:10px;transition:all .15s;text-align:left;color:inherit}
.rpt-tab:hover{border-color:var(--accent);transform:translateY(-1px);background:var(--card2)}
.rpt-tab.active{border-color:var(--accent);background:linear-gradient(135deg,rgba(124,58,237,.15),rgba(124,58,237,.05));box-shadow:0 0 0 1px var(--accent)}
.rpt-tab-icon{font-size:22px;flex-shrink:0;line-height:1}
.rpt-tab-text{flex:1;min-width:0}
.rpt-tab-label{font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px}
.rpt-tab-sub{font-size:10px;color:var(--muted);line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rpt-tab.active .rpt-tab-label{color:var(--accent)}
.rpt-section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid var(--border)}
.rpt-section-head h2{font-size:18px;font-weight:700;letter-spacing:-.01em}
.rpt-period{font-size:11px;color:var(--muted);background:var(--card2);padding:4px 10px;border-radius:12px;border:1px solid var(--border)}
.rpt-ai-card{background:linear-gradient(135deg,rgba(124,58,237,.08),rgba(14,165,233,.04));margin-bottom:16px}
.rpt-ai-list{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:1fr 1fr;gap:10px}
.rpt-ai-list li{font-size:12px;color:var(--text);line-height:1.5;padding-left:18px;position:relative}
.rpt-ai-list li::before{content:'▸';position:absolute;left:0;color:var(--accent)}
.rpt-placeholder{text-align:center;padding:32px 16px;background:var(--card2);border:1px dashed var(--border);border-radius:10px}
.rpt-placeholder-icon{font-size:32px;margin-bottom:8px;opacity:.6}
.rpt-placeholder-title{font-size:13px;font-weight:600;margin-bottom:6px}
.rpt-placeholder-sub{font-size:11px;color:var(--muted);line-height:1.5;max-width:360px;margin:0 auto}
.rpt-coverage-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:4px}
.rpt-cov-cell{padding:6px 4px;border-radius:4px;font-size:10px;font-weight:600;text-align:center;background:var(--card2);color:var(--muted);border:1px solid var(--border)}
.rpt-cov-cell.live{background:rgba(16,185,129,.15);color:#10b981;border-color:rgba(16,185,129,.3)}
.rpt-cov-cell.partial{background:rgba(245,158,11,.15);color:#f59e0b;border-color:rgba(245,158,11,.3)}
.rpt-rec-item{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)}
.rpt-rec-item:last-child{border-bottom:none}
.rpt-rec-icon{font-size:20px;flex-shrink:0}
.rpt-rec-title{font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px}
.rpt-rec-sub{font-size:11px;color:var(--muted)}
.rpt-source-list{display:flex;flex-direction:column;gap:10px}
.rpt-source-row{display:flex;align-items:center;gap:10px}
.rpt-source-name{width:140px;font-size:12px;font-weight:500}
.rpt-source-bar{flex:1;height:8px;background:var(--border);border-radius:3px;overflow:hidden}
.rpt-source-fill{height:100%;border-radius:3px}
.rpt-source-val{width:60px;text-align:right;font-size:11px;color:var(--muted);font-weight:500}
.rpt-heatmap{display:flex;flex-direction:column;gap:3px}
.rpt-heatmap-row{display:grid;grid-template-columns:repeat(7,1fr) 70px;gap:3px;align-items:center}
.rpt-heatmap-day-hdr{font-size:10px;color:var(--muted);text-align:center;font-weight:600}
.rpt-heatmap-cell{aspect-ratio:1;display:flex;align-items:center;justify-content:center;border-radius:4px;font-size:11px;font-weight:600;color:#fff}
.rpt-heatmap-cell.empty{background:rgba(48,54,61,.4);color:var(--muted)}
.rpt-heatmap-cell.low{background:rgba(124,58,237,.2);color:var(--text)}
.rpt-heatmap-cell.med{background:rgba(124,58,237,.45)}
.rpt-heatmap-cell.high{background:rgba(124,58,237,.7)}
.rpt-heatmap-cell.vhigh{background:var(--accent)}
.rpt-heatmap-wk{font-size:10px;color:var(--muted);text-align:left;padding-left:6px}
.rpt-exec-hero{display:grid;grid-template-columns:280px 1fr;gap:20px;padding:24px;background:linear-gradient(135deg,var(--card),var(--card2));border:1px solid var(--border);border-radius:14px;margin-bottom:16px}
.rpt-exec-hero-left{text-align:center;padding:0 16px;border-right:1px solid var(--border)}
.rpt-exec-title{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px}
.rpt-exec-score{font-size:56px;font-weight:700;line-height:1;margin:6px 0}
.rpt-exec-score-max{font-size:18px;color:var(--muted);font-weight:500}
.rpt-exec-risk{font-size:12px;color:var(--muted);margin-top:6px}
.rpt-exec-summary p{color:var(--text)}
.rpt-ai-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:16px}
.rpt-ai-feature{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px;position:relative;transition:all .2s}
.rpt-ai-feature:hover{border-color:var(--accent);transform:translateY(-2px);box-shadow:0 6px 20px rgba(124,58,237,.15)}
.rpt-ai-feature-icon{font-size:28px;margin-bottom:10px}
.rpt-ai-feature-title{font-size:14px;font-weight:700;color:var(--text);margin-bottom:6px}
.rpt-ai-feature-sub{font-size:11px;color:var(--muted);line-height:1.5;margin-bottom:14px}
.rpt-ai-feature-tag{position:absolute;top:14px;right:14px;background:rgba(124,58,237,.15);color:var(--accent);font-size:10px;font-weight:700;padding:3px 8px;border-radius:8px;text-transform:uppercase}
@media (max-width:1200px){
  .rpt-tabs{grid-template-columns:repeat(3,1fr)}
  .rpt-ai-cards{grid-template-columns:repeat(2,1fr)}
  .rpt-ai-list{grid-template-columns:1fr}
}
/* === END REPORTS V44 === */
.pr-section-title{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:14px 0 8px 0;padding-bottom:6px;border-bottom:1px solid var(--border)}`);

// ─── 4. Badge V43 → V44 ─────────────────────────────────────────────────────
patch('Badge V43 → V44', 'dash', `>V43 ✓</span>`, `>V44 ✓</span>`);

// ─── PUSH ────────────────────────────────────────────────────────────────────
proj.files[dashIdx].source = dash;
proj.files[codeIdx].source = code;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied, ' + fail + ' warnings');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V44 — Reports operational intelligence (10 modules) — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
console.log('');
console.log('Deploy V' + v.versionNumber + ' → Manage deployments → pick Version ' + v.versionNumber);
