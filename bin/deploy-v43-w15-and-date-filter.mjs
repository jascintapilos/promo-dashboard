#!/usr/bin/env node
/**
 * V43 — Two fixes to Reports:
 *   1. W15 (13–17 Apr) data filled in: promos=50, banners=2, crm=194, games=0
 *      Apr month total recalculated: 89→139, 58→60, 256→450, 20→20.
 *   2. Date filter added — quick pills (All / Jan / Feb / Mar / Apr / May /
 *      Last 4W / Last 8W) + custom date-range picker. Filters weekly table,
 *      KPIs, and monthly chart in real time.
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

// ─── Locate the REPORTS section bounds ───────────────────────────────────────
const RPT_START = '// ============================================================================\n// REPORTS — Jan–May 2026 Analysis + Drive file browser\n// ============================================================================';
const RPT_END   = '\n// ============================================================================\n// SETTINGS';

const startIdx = dash.indexOf(RPT_START);
const endIdx   = dash.indexOf(RPT_END, startIdx);
if (startIdx < 0 || endIdx < 0) {
  console.error('✗ REPORTS section markers not found');
  process.exit(1);
}

// ─── Build the new REPORTS section ───────────────────────────────────────────
// Weeks now include start/end ISO dates for filtering. W15 has real data.
const NEW_REPORTS_SECTION = `// ============================================================================
// REPORTS — Jan–May 2026 Analysis + Drive file browser
// ============================================================================
var __RPT_DATA = {
  weeks:[
    {w:'W01',d:'02–09 Jan',mo:'Jan',s:'2026-01-02',e:'2026-01-09',p:48,b:32,c:0,g:11},
    {w:'W02',d:'12–16 Jan',mo:'Jan',s:'2026-01-12',e:'2026-01-16',p:73,b:2,c:0,g:9},
    {w:'W03',d:'19–23 Jan',mo:'Jan',s:'2026-01-19',e:'2026-01-23',p:125,b:18,c:0,g:10},
    {w:'W04',d:'26–30 Jan',mo:'Jan',s:'2026-01-26',e:'2026-01-30',p:327,b:47,c:0,g:8},
    {w:'W05',d:'02–06 Feb',mo:'Feb',s:'2026-02-02',e:'2026-02-06',p:58,b:23,c:0,g:11},
    {w:'W06',d:'09–13 Feb',mo:'Feb',s:'2026-02-09',e:'2026-02-13',p:69,b:8,c:0,g:10},
    {w:'W07',d:'16–20 Feb',mo:'Feb',s:'2026-02-16',e:'2026-02-20',p:2,b:0,c:0,g:9},
    {w:'W08',d:'23–27 Feb',mo:'Feb',s:'2026-02-23',e:'2026-02-27',p:66,b:30,c:0,g:9},
    {w:'W09',d:'02–06 Mar',mo:'Mar',s:'2026-03-02',e:'2026-03-06',p:12,b:28,c:0,g:10},
    {w:'W10',d:'09–13 Mar',mo:'Mar',s:'2026-03-09',e:'2026-03-13',p:66,b:15,c:0,g:8},
    {w:'W11',d:'16–20 Mar',mo:'Mar',s:'2026-03-16',e:'2026-03-20',p:30,b:8,c:0,g:8},
    {w:'W12',d:'23–27 Mar',mo:'Mar',s:'2026-03-23',e:'2026-03-27',p:12,b:51,c:29,g:7},
    {w:'W13',d:'30 Mar–03 Apr',mo:'Apr',s:'2026-03-30',e:'2026-04-03',p:7,b:52,c:31,g:10},
    {w:'W14',d:'06–10 Apr',mo:'Apr',s:'2026-04-06',e:'2026-04-10',p:32,b:4,c:31,g:9},
    {w:'W15',d:'13–17 Apr',mo:'Apr',s:'2026-04-13',e:'2026-04-17',p:50,b:2,c:194,g:0},
    {w:'W16',d:'20–24 Apr',mo:'Apr',s:'2026-04-20',e:'2026-04-24',p:50,b:2,c:194,g:1},
    {w:'W17',d:'27 Apr–01 May',mo:'May',s:'2026-04-27',e:'2026-05-01',p:57,b:22,c:155,g:3},
    {w:'W18',d:'04–08 May',mo:'May',s:'2026-05-04',e:'2026-05-08',p:184,b:37,c:102,g:13},
    {w:'W19',d:'11–18 May',mo:'May',s:'2026-05-11',e:'2026-05-18',p:107,b:6,c:66,g:7},
  ],
};
var __rptTab = 'analysis';
var __cachedRptFiles = null;
var __selectedReportId = null;
// Filter state — from/to ISO dates, both inclusive
var __rptFilter = { from: '2026-01-01', to: '2026-12-31', preset: 'all' };

function __rptKpi_(label, val, sub, col) {
  return '<div class="card" style="padding:14px;margin:0"><div style="font-size:24px;font-weight:800;color:'+col+'">'+val+'</div><div style="font-size:12px;font-weight:600;color:var(--text);margin:2px 0">'+label+'</div><div style="font-size:10px;color:var(--muted)">'+sub+'</div></div>';
}
function __rptTabBar_(active) {
  var a='flex:1;padding:7px 10px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;background:var(--accent);color:#fff';
  var i='flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px;background:var(--card2);color:var(--muted)';
  return '<div style="display:flex;gap:8px;margin-bottom:14px">'
    +'<button onclick="__rptNav_(\\'analysis\\')" style="'+(active==='analysis'?a:i)+'">📊 Analysis</button>'
    +'<button onclick="__rptNav_(\\'files\\')" style="'+(active==='files'?a:i)+'">📁 Weekly Files</button>'
    +'</div>';
}
function __rptNav_(tab) {
  __rptTab = tab;
  if (tab==='analysis') renderReports_analysis_();
  else renderReports_files_(__cachedRptFiles);
}

// ── Date-filter helpers ──────────────────────────────────────────────────────
function __rptApplyPreset_(preset) {
  __rptFilter.preset = preset;
  var today = '2026-05-22';   // server-side anchor (date of last data refresh)
  var TODAY = new Date(today + 'T00:00:00Z');
  function isoMinusDays(n){
    var d = new Date(TODAY.getTime()); d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0,10);
  }
  switch (preset) {
    case 'all':  __rptFilter.from='2026-01-01'; __rptFilter.to='2026-12-31'; break;
    case 'jan':  __rptFilter.from='2026-01-01'; __rptFilter.to='2026-01-31'; break;
    case 'feb':  __rptFilter.from='2026-02-01'; __rptFilter.to='2026-02-28'; break;
    case 'mar':  __rptFilter.from='2026-03-01'; __rptFilter.to='2026-03-31'; break;
    case 'apr':  __rptFilter.from='2026-04-01'; __rptFilter.to='2026-04-30'; break;
    case 'may':  __rptFilter.from='2026-05-01'; __rptFilter.to='2026-05-31'; break;
    case 'last4w': __rptFilter.from=isoMinusDays(28); __rptFilter.to=today; break;
    case 'last8w': __rptFilter.from=isoMinusDays(56); __rptFilter.to=today; break;
    case 'q1':   __rptFilter.from='2026-01-01'; __rptFilter.to='2026-03-31'; break;
    case 'q2':   __rptFilter.from='2026-04-01'; __rptFilter.to='2026-06-30'; break;
    case 'custom': break;   // keep current from/to
  }
  renderReports_analysis_();
}
function __rptApplyCustom_() {
  var f = document.getElementById('rpt-from');
  var t = document.getElementById('rpt-to');
  if (f && t && f.value && t.value) {
    __rptFilter.from = f.value;
    __rptFilter.to   = t.value;
    __rptFilter.preset = 'custom';
    renderReports_analysis_();
  }
}
function __rptFilteredWeeks_() {
  // overlap test: week.start <= to AND week.end >= from
  return __RPT_DATA.weeks.filter(function(w){
    return w.s <= __rptFilter.to && w.e >= __rptFilter.from;
  });
}

function renderReports() {
  __rptTab = 'analysis';
  renderReports_analysis_();
  if (typeof google !== 'undefined') {
    google.script.run
      .withSuccessHandler(function(f){ __cachedRptFiles = f; })
      .withFailureHandler(function(){   __cachedRptFiles = []; })
      .serverGetWeeklyReports();
  }
}

function renderReports_analysis_() {
  __rptTab = 'analysis';
  var weeks = __rptFilteredWeeks_();

  // Build monthly aggregates from filtered weeks
  var monthMap = {};
  weeks.forEach(function(w){
    if (!monthMap[w.mo]) monthMap[w.mo] = { m: w.mo, p:0, b:0, c:0, g:0 };
    monthMap[w.mo].p += w.p; monthMap[w.mo].b += w.b;
    monthMap[w.mo].c += w.c; monthMap[w.mo].g += w.g;
  });
  var monthOrder = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var mo = monthOrder.filter(function(x){ return monthMap[x]; }).map(function(x){ return monthMap[x]; });

  // KPI totals
  var tp=0,tb=0,tc=0,tg=0;
  weeks.forEach(function(w){ tp+=w.p; tb+=w.b; tc+=w.c; tg+=w.g; });

  // Monthly chart (only on months in filtered range)
  var maxP = mo.length ? Math.max.apply(null, mo.map(function(m){return m.p;})) : 0;
  var maxB = mo.length ? Math.max.apply(null, mo.map(function(m){return m.b;})) : 0;
  var maxC = mo.length ? Math.max.apply(null, mo.map(function(m){return m.c;})) : 0;
  var chart = mo.map(function(m){
    var pp = maxP>0 ? Math.round(m.p/maxP*100) : 0;
    var bp = maxB>0 ? Math.round(m.b/maxB*100) : 0;
    var cp = maxC>0 ? Math.round(m.c/maxC*100) : 0;
    return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">'
      +'<div style="width:30px;font-size:11px;font-weight:700;color:var(--muted)">'+m.m+'</div>'
      +'<div style="flex:1">'
        +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">'
          +'<div style="height:12px;width:'+pp+'%;min-width:2px;background:var(--accent);border-radius:2px"></div>'
          +'<span style="font-size:11px;color:var(--text)">'+m.p+' promos</span></div>'
        +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">'
          +'<div style="height:8px;width:'+bp+'%;min-width:2px;background:#0ea5e9;border-radius:2px"></div>'
          +'<span style="font-size:10px;color:var(--muted)">'+m.b+' banners</span></div>'
        +'<div style="display:flex;align-items:center;gap:6px">'
          +'<div style="height:8px;width:'+cp+'%;min-width:2px;background:#10b981;border-radius:2px"></div>'
          +'<span style="font-size:10px;color:var(--muted)">'+m.c+' CRM</span></div>'
      +'</div>'
      +'<div style="width:52px;text-align:right;font-size:10px;color:var(--muted)">🎮 '+m.g+'</div>'
    +'</div>';
  }).join('') || '<div style="text-align:center;color:var(--muted);padding:20px;font-size:12px">No data in selected range</div>';

  // Weekly table rows
  var wkRows = weeks.map(function(w){
    var hi = w.p >= 100;
    return '<tr style="border-bottom:1px solid var(--border)">'
      +'<td style="padding:5px 8px;font-family:monospace;font-size:10px;color:var(--muted)">'+w.w+'</td>'
      +'<td style="padding:5px 8px;font-size:11px;color:var(--muted);white-space:nowrap">'+w.d+'</td>'
      +'<td style="padding:5px 8px;text-align:right;font-size:12px;font-weight:'+(hi?'700':'400')+';color:'+(hi?'var(--accent)':'var(--text)')+'">'+w.p+'</td>'
      +'<td style="padding:5px 8px;text-align:right;font-size:12px;color:var(--text)">'+w.b+'</td>'
      +'<td style="padding:5px 8px;text-align:right;font-size:12px;color:var(--text)">'+w.c+'</td>'
      +'<td style="padding:5px 8px;text-align:right;font-size:12px;color:var(--text)">'+w.g+'</td>'
      +'</tr>';
  }).join('') || '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--muted);font-size:12px">No weeks in selected range</td></tr>';

  // Filter UI: pills + custom range
  var presetBtn = function(id, label, active){
    var st = active
      ? 'padding:5px 10px;border:none;border-radius:14px;background:var(--accent);color:#fff;font-size:11px;font-weight:600;cursor:pointer'
      : 'padding:5px 10px;border:1px solid var(--border);border-radius:14px;background:var(--card2);color:var(--muted);font-size:11px;cursor:pointer';
    return '<button onclick="__rptApplyPreset_(\\''+id+'\\')" style="'+st+'">'+label+'</button>';
  };
  var p = __rptFilter.preset;
  var filterUI = '<div class="card" style="padding:12px 14px;margin-bottom:14px">'
    +'<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">'
      +'<span style="font-size:11px;font-weight:700;color:var(--muted);margin-right:4px">FILTER:</span>'
      +presetBtn('all','All YTD',p==='all')
      +presetBtn('q1','Q1',p==='q1')
      +presetBtn('q2','Q2',p==='q2')
      +presetBtn('jan','Jan',p==='jan')
      +presetBtn('feb','Feb',p==='feb')
      +presetBtn('mar','Mar',p==='mar')
      +presetBtn('apr','Apr',p==='apr')
      +presetBtn('may','May',p==='may')
      +presetBtn('last4w','Last 4W',p==='last4w')
      +presetBtn('last8w','Last 8W',p==='last8w')
    +'</div>'
    +'<div style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--muted)">'
      +'<span>Custom range:</span>'
      +'<input type="date" id="rpt-from" value="'+__rptFilter.from+'" style="background:var(--card2);border:1px solid var(--border);color:var(--text);padding:4px 6px;border-radius:4px;font-size:11px;color-scheme:dark">'
      +'<span>→</span>'
      +'<input type="date" id="rpt-to" value="'+__rptFilter.to+'" style="background:var(--card2);border:1px solid var(--border);color:var(--text);padding:4px 6px;border-radius:4px;font-size:11px;color-scheme:dark">'
      +'<button onclick="__rptApplyCustom_()" style="padding:4px 10px;border:1px solid var(--accent);border-radius:4px;background:transparent;color:var(--accent);font-size:11px;cursor:pointer;font-weight:600">Apply</button>'
      +'<span style="margin-left:auto;font-size:10px">Showing '+weeks.length+' of '+__RPT_DATA.weeks.length+' weeks</span>'
    +'</div>'
  +'</div>';

  var rangeLabel = (function(){
    if (p==='all') return 'Jan–May 2026';
    if (p==='custom') return __rptFilter.from + ' → ' + __rptFilter.to;
    if (p==='last4w') return 'Last 4 Weeks';
    if (p==='last8w') return 'Last 8 Weeks';
    if (p==='q1') return 'Q1 2026 (Jan–Mar)';
    if (p==='q2') return 'Q2 2026 (Apr–Jun)';
    return p.toUpperCase() + ' 2026';
  })();

  content(
    __rptTabBar_('analysis')
    + filterUI
    +'<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">'
      +__rptKpi_('Promo Codes', tp, rangeLabel, 'var(--accent)')
      +__rptKpi_('Banners', tb, rangeLabel, '#0ea5e9')
      +__rptKpi_('CRM Campaigns', tc, rangeLabel, '#10b981')
      +__rptKpi_('New Games Added', tg, rangeLabel, '#f59e0b')
    +'</div>'
    +'<div class="card" style="margin-bottom:16px">'
      +'<div class="card-hdr"><h3>📅 Monthly Activity</h3><span style="font-size:11px;color:var(--muted)">'+rangeLabel+'</span></div>'
      +'<div style="padding:14px 16px">'+chart+'</div>'
    +'</div>'
    +'<div class="card">'
      +'<div class="card-hdr"><h3>📋 Weekly Breakdown</h3><span style="font-size:10px;color:var(--muted)">'+weeks.length+' week'+(weeks.length===1?'':'s')+'</span></div>'
      +'<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">'
        +'<thead><tr style="border-bottom:2px solid var(--border)">'
          +'<th style="padding:6px 8px;text-align:left;font-size:10px;color:var(--muted)">WK</th>'
          +'<th style="padding:6px 8px;text-align:left;font-size:10px;color:var(--muted)">DATES</th>'
          +'<th style="padding:6px 8px;text-align:right;font-size:10px;color:var(--accent)">PROMOS</th>'
          +'<th style="padding:6px 8px;text-align:right;font-size:10px;color:#0ea5e9">BANNERS</th>'
          +'<th style="padding:6px 8px;text-align:right;font-size:10px;color:#10b981">CRM</th>'
          +'<th style="padding:6px 8px;text-align:right;font-size:10px;color:#f59e0b">GAMES</th>'
        +'</tr></thead>'
        +'<tbody>'+wkRows+'</tbody>'
        +'<tfoot><tr style="border-top:2px solid var(--border)">'
          +'<td colspan="2" style="padding:7px 8px;font-size:11px;font-weight:700">TOTAL ('+rangeLabel+')</td>'
          +'<td style="padding:7px 8px;text-align:right;font-size:14px;font-weight:800;color:var(--accent)">'+tp+'</td>'
          +'<td style="padding:7px 8px;text-align:right;font-size:14px;font-weight:800;color:#0ea5e9">'+tb+'</td>'
          +'<td style="padding:7px 8px;text-align:right;font-size:14px;font-weight:800;color:#10b981">'+tc+'</td>'
          +'<td style="padding:7px 8px;text-align:right;font-size:14px;font-weight:800;color:#f59e0b">'+tg+'</td>'
        +'</tr></tfoot>'
      +'</table></div>'
    +'</div>'
  );
}

function renderReports_files_(files) {
  __rptTab = 'files';
  var tb = __rptTabBar_('files');
  if (!files || !files.length) {
    content(tb + '<div class="empty">📭 No weekly reports found in Drive folder.<br>'
      +'<button class="btn" onclick="__rptNav_(\\'files\\')" style="margin-top:8px">↻ Try again</button>'
      +'&nbsp;<a href="https://drive.google.com/drive/folders/1SvTyOPxDCVnPjmYU-XjMlOupQ2M1T_8P" target="_blank" style="color:var(--accent)">Open Drive folder →</a></div>');
    return;
  }
  var byMonth = {};
  files.forEach(function(f){ var m=f.month||'Other'; if(!byMonth[m]) byMonth[m]=[]; byMonth[m].push(f); });
  if (!__selectedReportId || !files.find(function(f){ return f.id===__selectedReportId; })) {
    __selectedReportId = files[0].id;
  }
  var sel = files.find(function(f){ return f.id===__selectedReportId; });

  var sidebar = '<div style="display:flex;flex-direction:column;gap:10px">';
  Object.keys(byMonth).forEach(function(mo){
    sidebar += '<div><div style="font-size:10px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.06em;padding:6px 10px">'+esc(mo)+'</div>';
    byMonth[mo].forEach(function(f){
      var on = f.id===__selectedReportId;
      sidebar += '<div onclick="selectReport_(\\''+esc(f.id)+'\\')" style="padding:7px 10px;border-radius:6px;cursor:pointer;font-size:11px;background:'+(on?'var(--pill-bg)':'transparent')+';color:'+(on?'var(--accent)':'var(--text)')+';border-left:3px solid '+(on?'var(--accent)':'transparent')+';margin-bottom:2px">'
        +'<div style="font-weight:600;margin-bottom:2px">'+esc(f.name)+'</div>'
        +'<div style="font-size:10px;color:var(--muted)">'+String(f.modifiedTime||'').slice(0,10)+'</div>'
        +'</div>';
    });
    sidebar += '</div>';
  });
  sidebar += '</div>';

  content(tb
    +'<div class="card" style="margin:0;height:calc(100vh - 150px);display:flex;flex-direction:column">'
      +'<div class="card-hdr" style="flex-shrink:0">'
        +'<h3>📊 '+esc(sel.name)+'</h3>'
        +'<div style="display:flex;gap:8px">'
          +'<a class="btn" href="'+esc(sel.openUrl)+'" target="_blank" style="text-decoration:none">↗ Open in tab</a>'
          +'<button class="btn" onclick="renderReports()">↻ Refresh</button>'
        +'</div>'
      +'</div>'
      +'<div style="display:flex;flex:1;overflow:hidden">'
        +'<div style="width:230px;border-right:1px solid var(--border);overflow-y:auto;padding:8px;flex-shrink:0">'+sidebar+'</div>'
        +'<div style="flex:1;background:#fff;overflow:hidden"><iframe src="'+esc(sel.embedUrl)+'" style="width:100%;height:100%;border:0" allow="autoplay"></iframe></div>'
      +'</div>'
    +'</div>'
  );
}

function selectReport_(id) {
  __selectedReportId = id;
  renderReports_files_(__cachedRptFiles || []);
}

function renderReportsData(files) {
  __cachedRptFiles = files;
}`;

dash = dash.slice(0, startIdx) + NEW_REPORTS_SECTION + dash.slice(endIdx);

// ─── Push & promote ──────────────────────────────────────────────────────────
proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V43 — W15 data + date filter (presets + custom range) ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V43: W15 + date filter',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('\nhttps://script.google.com/macros/s/AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ/exec');
