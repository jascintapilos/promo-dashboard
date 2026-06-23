#!/usr/bin/env node
/**
 * V46 — Utilization card + conditional Automation report
 *
 * 1. Module grid becomes 5 columns (Promo / Banner / CRM / Games / Utilization).
 *    Utilization card shows:
 *      • Team workload donut (avg tasks/owner vs target capacity)
 *      • Workload distribution by module (horizontal bars w/ %)
 *      • Top 4 owners (workload bars, names from resolveOwnerNames_)
 *
 * 2. Automation Report card — rendered ONLY if any task in the filtered
 *    range has Submitter (or Owner) containing 'promo_testbot'. Shows:
 *      • Automation rate donut (bot tasks / total tasks)
 *      • Total automated · manual · hours saved (auto × 0.5h)
 *      • Per-module automation breakdown
 *      • Trend vs previous period
 *
 * Both derive from S.tasks (Task_Master) filtered by __rptFilter date range.
 */
import { getGoogleAuth } from '../src/google-auth.js';

const SCRIPT_ID     = '1Zw5W9LjmYL5hzFpHXdr0G_Q7oFRVCAGqZVTBmQCjiOmZIO2R7M6h8l6O';
const DEPLOYMENT_ID = 'AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ';

const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

async function api(method, url, body) {
  const r = await fetch(`https://script.googleapis.com/v1${url}`, {
    method,
    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
  return r.json();
}

const proj = await api('GET', `/projects/${SCRIPT_ID}/content`);
const dashIdx = proj.files.findIndex(f => f.name === 'Dashboard');
let dash = proj.files[dashIdx].source;

// ─── 1. Add helper functions BEFORE renderReports_analysis_ ─────────────────
const HELPER_ANCHOR = `// ── MAIN ANALYSIS RENDER ─`;
const HELPER_BLOCK = `// ── Utilization + Automation helpers ────────────────────────────────────────
function __isBot_(t) {
  var s = String(t.Submitter || '').toLowerCase();
  var o = String(t.Owner || '').toLowerCase();
  return s.indexOf('promo_testbot') >= 0 || s.indexOf('promotestbot') >= 0
      || o.indexOf('promo_testbot') >= 0 || o.indexOf('promotestbot') >= 0;
}
function __tasksInRange_() {
  var from = __rptFilter.from, to = __rptFilter.to;
  return (S.tasks || []).filter(function(t){
    var d = String(t.Submitted_At || t.Assigned_At || t.Created_At || '').slice(0,10);
    return d && d >= from && d <= to;
  });
}
function __utilizationStats_() {
  var tasks = __tasksInRange_();
  // By module
  var byModule = {};
  tasks.forEach(function(t){
    var m = String(t.Module || 'Other');
    byModule[m] = (byModule[m] || 0) + 1;
  });
  // By owner
  var byOwner = {};
  tasks.forEach(function(t){
    var raw = String(t.Owner || '');
    if (!raw) return;
    var name = typeof resolveOwnerNames_==='function' ? resolveOwnerNames_(raw) : raw;
    // Split compound owners
    name.split(/\\s*\\+\\s*/).forEach(function(n){
      n = n.trim();
      if (n) byOwner[n] = (byOwner[n] || 0) + 1;
    });
  });
  // Capacity: rosterSize × tasksPerWeek × weeks
  var weeks = Math.max(1, __rptFilteredWeeks_().length);
  var rosterSize = (S.roster && S.roster.length) || 8;
  var tasksPerOwnerPerWeek = 8;  // target
  var capacity = rosterSize * tasksPerOwnerPerWeek * weeks;
  var utilization = capacity > 0 ? Math.min(100, Math.round((tasks.length / capacity) * 100)) : 0;
  return {
    total: tasks.length, capacity: capacity, utilization: utilization,
    byModule: byModule, byOwner: byOwner, weeks: weeks, rosterSize: rosterSize,
  };
}
function __automationStats_() {
  var tasks = __tasksInRange_();
  var bot = tasks.filter(__isBot_);
  var manual = tasks.length - bot.length;
  var rate = tasks.length > 0 ? Math.round((bot.length / tasks.length) * 100) : 0;
  // Hours saved: assume 30 min per automated task vs manual
  var hoursSaved = Math.round(bot.length * 0.5 * 10) / 10;
  // By module
  var byModule = {};
  bot.forEach(function(t){
    var m = String(t.Module || 'Other');
    byModule[m] = (byModule[m] || 0) + 1;
  });
  // Prev period comparison
  var prev = __rptPrevPeriod_();
  var prevTasks = (S.tasks || []).filter(function(t){
    var d = String(t.Submitted_At || t.Assigned_At || t.Created_At || '').slice(0,10);
    return d && d >= prev.from && d <= prev.to;
  });
  var prevBot = prevTasks.filter(__isBot_);
  return {
    total: tasks.length, bot: bot.length, manual: manual, rate: rate,
    hoursSaved: hoursSaved, byModule: byModule,
    prevBot: prevBot.length, delta: __delta_(bot.length, prevBot.length),
  };
}

// ── Utilization card ────────────────────────────────────────────────────────
function __utilizationCard_() {
  var u = __utilizationStats_();
  // Compact donut
  var donut = __svgDonut_([u.utilization, 100-u.utilization], ['#ec4899','#30363d'], u.utilization, 86);
  // Override donut center text manually (the helper writes "Total")
  donut = donut.replace(/<text x="50" y="48"[^>]*>\\d+<\\/text>/, '<text x="50" y="48" text-anchor="middle" font-size="18" font-weight="800" fill="#e6edf3">'+u.utilization+'%</text>');
  donut = donut.replace(/<text x="50" y="64"[^>]*>Total<\\/text>/, '<text x="50" y="64" text-anchor="middle" font-size="9" fill="#8b949e">Workload</text>');

  // Module workload bars
  var totalM = Object.keys(u.byModule).reduce(function(s,k){ return s + u.byModule[k]; }, 0) || 1;
  var modules = Object.keys(u.byModule).sort(function(a,b){ return u.byModule[b]-u.byModule[a]; }).slice(0, 5);
  var moduleBars = modules.map(function(m){
    var pct = Math.round(u.byModule[m] / totalM * 100);
    return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:10px">'
      +'<span style="flex:1;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:90px">'+esc(m)+'</span>'
      +'<div style="flex:2;height:6px;background:#30363d;border-radius:3px;overflow:hidden"><div style="width:'+pct+'%;height:100%;background:linear-gradient(90deg,#ec4899,#7c3aed)"></div></div>'
      +'<span style="color:var(--muted);font-size:10px;font-weight:600;min-width:28px;text-align:right">'+pct+'%</span>'
      +'</div>';
  }).join('') || '<div style="color:var(--muted);font-size:10px;padding:4px 0">No tasks in range</div>';

  // Top owners
  var owners = Object.keys(u.byOwner).sort(function(a,b){ return u.byOwner[b]-u.byOwner[a]; }).slice(0, 4);
  var maxOwner = owners.length ? u.byOwner[owners[0]] : 1;
  var ownerBars = owners.map(function(o){
    var pct = Math.round(u.byOwner[o] / maxOwner * 100);
    return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;font-size:10px">'
      +'<span style="flex:1;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(o)+'</span>'
      +'<span style="color:var(--muted);font-size:10px;min-width:20px;text-align:right">'+u.byOwner[o]+'</span>'
      +'</div>';
  }).join('') || '<div style="color:var(--muted);font-size:10px;padding:4px 0">No owners assigned</div>';

  return '<div class="card" style="padding:14px;margin:0;display:flex;flex-direction:column">'
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">'
      +'<div style="width:32px;height:32px;border-radius:8px;background:#ec489922;display:flex;align-items:center;justify-content:center;font-size:16px">👥</div>'
      +'<div style="font-size:14px;font-weight:700;color:var(--text)">Utilization</div>'
    +'</div>'
    +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'
      +donut
      +'<div style="flex:1;font-size:10px;line-height:1.4">'
        +'<div style="color:var(--muted);margin-bottom:2px">Tasks: <strong style="color:var(--text)">'+u.total+'</strong></div>'
        +'<div style="color:var(--muted);margin-bottom:2px">Capacity: <strong style="color:var(--text)">'+u.capacity+'</strong></div>'
        +'<div style="color:var(--muted)">Team size: <strong style="color:var(--text)">'+u.rosterSize+'</strong></div>'
      +'</div>'
    +'</div>'
    +'<div style="margin-bottom:8px">'
      +'<div style="font-size:9px;color:var(--muted);font-weight:600;text-transform:uppercase;margin-bottom:4px">By Module</div>'
      +moduleBars
    +'</div>'
    +'<div style="margin-top:auto">'
      +'<div style="font-size:9px;color:var(--muted);font-weight:600;text-transform:uppercase;margin-bottom:4px;padding-top:6px;border-top:1px solid var(--border)">Top Owners</div>'
      +ownerBars
    +'</div>'
  +'</div>';
}

// ── Automation report (full-width row, conditional) ──────────────────────────
function __automationCard_() {
  var a = __automationStats_();
  if (a.bot === 0) return '';  // hide if no bot tasks

  var rateDonut = __svgDonut_([a.bot, a.manual], ['#10b981','#30363d'], a.rate, 100);
  rateDonut = rateDonut.replace(/<text x="50" y="48"[^>]*>\\d+<\\/text>/, '<text x="50" y="48" text-anchor="middle" font-size="20" font-weight="800" fill="#10b981">'+a.rate+'%</text>');
  rateDonut = rateDonut.replace(/<text x="50" y="64"[^>]*>Total<\\/text>/, '<text x="50" y="64" text-anchor="middle" font-size="9" fill="#8b949e">Automated</text>');

  // Per-module breakdown
  var moduleEntries = Object.keys(a.byModule).map(function(m){ return { m: m, n: a.byModule[m] }; })
    .sort(function(x,y){ return y.n - x.n; }).slice(0, 6);
  var maxModule = moduleEntries.length ? moduleEntries[0].n : 1;
  var moduleBars = moduleEntries.map(function(e){
    var pct = Math.round(e.n / maxModule * 100);
    return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:11px">'
      +'<span style="flex:1;color:var(--text);max-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(e.m)+'</span>'
      +'<div style="flex:2;height:8px;background:#30363d;border-radius:4px;overflow:hidden"><div style="width:'+pct+'%;height:100%;background:linear-gradient(90deg,#10b981,#0ea5e9)"></div></div>'
      +'<span style="color:var(--accent);font-weight:700;font-size:11px;min-width:32px;text-align:right">'+e.n+'</span>'
      +'</div>';
  }).join('');

  return '<div class="card" style="padding:16px;margin:0 0 14px 0">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'
      +'<div style="display:flex;align-items:center;gap:10px">'
        +'<div style="width:36px;height:36px;border-radius:8px;background:#10b98122;display:flex;align-items:center;justify-content:center;font-size:18px">🤖</div>'
        +'<div>'
          +'<div style="font-size:14px;font-weight:700;color:var(--text)">Automation Report</div>'
          +'<div style="font-size:10px;color:var(--muted)">Tasks created by promo_testbot</div>'
        +'</div>'
      +'</div>'
      +__deltaPill_(a.delta, false)
    +'</div>'
    +'<div style="display:grid;grid-template-columns:auto 1fr 1fr 1fr;gap:18px;align-items:center">'
      +'<div style="display:flex;align-items:center;justify-content:center">'+rateDonut+'</div>'
      +'<div style="display:flex;flex-direction:column;gap:12px">'
        +'<div><div style="font-size:9px;color:var(--muted);font-weight:600;text-transform:uppercase">Automated</div><div style="font-size:22px;font-weight:800;color:#10b981">'+a.bot+'</div><div style="font-size:10px;color:var(--muted)">of '+a.total+' total tasks</div></div>'
        +'<div><div style="font-size:9px;color:var(--muted);font-weight:600;text-transform:uppercase">Manual</div><div style="font-size:18px;font-weight:700;color:var(--text)">'+a.manual+'</div></div>'
      +'</div>'
      +'<div style="display:flex;flex-direction:column;gap:12px">'
        +'<div><div style="font-size:9px;color:var(--muted);font-weight:600;text-transform:uppercase">⏱ Hours Saved</div><div style="font-size:22px;font-weight:800;color:#f59e0b">'+a.hoursSaved+'h</div><div style="font-size:10px;color:var(--muted)">~30 min/task</div></div>'
        +'<div><div style="font-size:9px;color:var(--muted);font-weight:600;text-transform:uppercase">vs prev period</div><div style="font-size:13px;font-weight:700;color:var(--text)">'+a.prevBot+' bot tasks</div></div>'
      +'</div>'
      +'<div>'
        +'<div style="font-size:9px;color:var(--muted);font-weight:600;text-transform:uppercase;margin-bottom:8px">By Module</div>'
        +(moduleBars || '<div style="font-size:11px;color:var(--muted)">No module breakdown</div>')
      +'</div>'
    +'</div>'
  +'</div>';
}

`;

if (!dash.includes(HELPER_ANCHOR)) {
  console.error('✗ HELPER_ANCHOR not found');
  process.exit(1);
}
if (dash.includes('function __utilizationStats_')) {
  console.log('… helpers already present, skipping');
} else {
  dash = dash.replace(HELPER_ANCHOR, HELPER_BLOCK + HELPER_ANCHOR);
  console.log('✓ Helpers __isBot_, __utilizationStats_, __automationStats_, __utilizationCard_, __automationCard_ inserted');
}

// ─── 2. Module grid: 4 → 5 columns, add Utilization card ─────────────────────
const OLD_MODULE_GRID = `var moduleGrid = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px">'
    + __moduleCard_({icon:'🎯', name:'Promo Code',     color:'#7c3aed', total:t.p, delta:__delta_(t.p,tP.p), weeks:weeks, key:'p', monthSplit:monthSplit('p')})
    + __moduleCard_({icon:'🖼️', name:'Banner',         color:'#0ea5e9', total:t.b, delta:__delta_(t.b,tP.b), weeks:weeks, key:'b', monthSplit:monthSplit('b')})
    + __moduleCard_({icon:'📧', name:'CRM Assignment', color:'#10b981', total:t.c, delta:__delta_(t.c,tP.c), weeks:weeks, key:'c', monthSplit:monthSplit('c')})
    + __moduleCard_({icon:'🎮', name:'Game Addition',  color:'#f59e0b', total:t.g, delta:__delta_(t.g,tP.g), weeks:weeks, key:'g', monthSplit:monthSplit('g')})
  + '</div>';`;

const NEW_MODULE_GRID = `var moduleGrid = '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px">'
    + __moduleCard_({icon:'🎯', name:'Promo Code',     color:'#7c3aed', total:t.p, delta:__delta_(t.p,tP.p), weeks:weeks, key:'p', monthSplit:monthSplit('p')})
    + __moduleCard_({icon:'🖼️', name:'Banner',         color:'#0ea5e9', total:t.b, delta:__delta_(t.b,tP.b), weeks:weeks, key:'b', monthSplit:monthSplit('b')})
    + __moduleCard_({icon:'📧', name:'CRM Assignment', color:'#10b981', total:t.c, delta:__delta_(t.c,tP.c), weeks:weeks, key:'c', monthSplit:monthSplit('c')})
    + __moduleCard_({icon:'🎮', name:'Game Addition',  color:'#f59e0b', total:t.g, delta:__delta_(t.g,tP.g), weeks:weeks, key:'g', monthSplit:monthSplit('g')})
    + __utilizationCard_()
  + '</div>';`;

if (!dash.includes(OLD_MODULE_GRID)) {
  console.error('✗ OLD_MODULE_GRID anchor not found');
  process.exit(1);
}
dash = dash.replace(OLD_MODULE_GRID, NEW_MODULE_GRID);
console.log('✓ Module grid → 5 columns with Utilization card');

// ─── 3. Insert Automation card BEFORE insights row ───────────────────────────
const OLD_CONTENT_CALL = `  content(
    __rptHeader_(weeks, prev)
    + __rptTabBar_('analysis')
    + __rptFilterBar_(weeks)
    + kpis
    + moduleGrid
    + trendsRow
    + insights
  );`;

const NEW_CONTENT_CALL = `  content(
    __rptHeader_(weeks, prev)
    + __rptTabBar_('analysis')
    + __rptFilterBar_(weeks)
    + kpis
    + moduleGrid
    + trendsRow
    + __automationCard_()
    + insights
  );`;

if (!dash.includes(OLD_CONTENT_CALL)) {
  console.error('✗ OLD_CONTENT_CALL anchor not found');
  process.exit(1);
}
dash = dash.replace(OLD_CONTENT_CALL, NEW_CONTENT_CALL);
console.log('✓ Automation card slotted into analysis layout (conditional)');

// ─── 4. Ensure S.tasks is loaded when Reports renders ────────────────────────
const OLD_RENDER_REPORTS = `function renderReports() {
  __rptTab = 'analysis';
  // Try to load cached server data first; if empty, keep hardcoded __RPT_DATA
  if (typeof google !== 'undefined') {
    google.script.run
      .withSuccessHandler(function(d){
        if (d && d.weeks && d.weeks.length) { __RPT_DATA.weeks = d.weeks; __rptSyncedAt = d.syncedAt; }
        renderReports_analysis_();
      })
      .withFailureHandler(function(){ renderReports_analysis_(); })
      .serverGetWeeklyReportData();
    // Also kick off file-list load in background
    google.script.run
      .withSuccessHandler(function(f){ __cachedRptFiles = f; })
      .withFailureHandler(function(){   __cachedRptFiles = []; })
      .serverGetWeeklyReports();
  } else {
    renderReports_analysis_();
  }
}`;

const NEW_RENDER_REPORTS = `function renderReports() {
  __rptTab = 'analysis';
  // Ensure tasks loaded (needed for utilization + automation cards)
  if ((!S.tasks || !S.tasks.length) && typeof google !== 'undefined') {
    google.script.run
      .withSuccessHandler(function(t){ S.tasks = t || []; })
      .withFailureHandler(function(){ S.tasks = S.tasks || []; })
      .serverGetTasks();
  }
  // Try to load cached server data first; if empty, keep hardcoded __RPT_DATA
  if (typeof google !== 'undefined') {
    google.script.run
      .withSuccessHandler(function(d){
        if (d && d.weeks && d.weeks.length) { __RPT_DATA.weeks = d.weeks; __rptSyncedAt = d.syncedAt; }
        renderReports_analysis_();
      })
      .withFailureHandler(function(){ renderReports_analysis_(); })
      .serverGetWeeklyReportData();
    google.script.run
      .withSuccessHandler(function(f){ __cachedRptFiles = f; })
      .withFailureHandler(function(){   __cachedRptFiles = []; })
      .serverGetWeeklyReports();
  } else {
    renderReports_analysis_();
  }
}`;

if (!dash.includes(OLD_RENDER_REPORTS)) {
  console.error('✗ renderReports anchor not found');
  process.exit(1);
}
dash = dash.replace(OLD_RENDER_REPORTS, NEW_RENDER_REPORTS);
console.log('✓ renderReports now loads S.tasks if missing');

// ─── Push & promote ──────────────────────────────────────────────────────────
proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V46: Utilization card + conditional Automation report (promo_testbot) ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V46: utilization + automation',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('\nhttps://script.google.com/macros/s/AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ/exec');
