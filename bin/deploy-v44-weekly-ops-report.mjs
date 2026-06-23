#!/usr/bin/env node
/**
 * V44 — Weekly Operations Report layout (matches reference screenshot):
 *   • Header w/ period + compared-to period
 *   • Date filter retained (pills + custom range)
 *   • 6-card KPI strip with WoW comparison
 *   • 4 module cards (Promo / Banner / CRM / Game Addition) with
 *     donut chart (monthly split) + sparkline (weekly trend)
 *   • Multi-line trend chart SVG (all metrics over filtered weeks)
 *   • Top delayed tasks (from Task_Master)
 *   • Insights row (positive changes / areas to improve)
 *   • Existing "Weekly Files" tab kept intact
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

const RPT_START = '// ============================================================================\n// REPORTS — Jan–May 2026 Analysis + Drive file browser\n// ============================================================================';
const RPT_END   = '\n// ============================================================================\n// SETTINGS';

const startIdx = dash.indexOf(RPT_START);
const endIdx   = dash.indexOf(RPT_END, startIdx);
if (startIdx < 0 || endIdx < 0) {
  console.error('✗ REPORTS section markers not found');
  process.exit(1);
}

const NEW_REPORTS_SECTION = `// ============================================================================
// REPORTS — Weekly Operations Report (V44 layout)
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
var __rptFilter = { from: '2026-05-11', to: '2026-05-18', preset: 'last1w' };

// ── Date / filter helpers ────────────────────────────────────────────────────
function __rptApplyPreset_(preset) {
  __rptFilter.preset = preset;
  var today = '2026-05-22';
  var TODAY = new Date(today + 'T00:00:00Z');
  function isoMinusDays(n){ var d = new Date(TODAY.getTime()); d.setUTCDate(d.getUTCDate()-n); return d.toISOString().slice(0,10); }
  switch (preset) {
    case 'all':    __rptFilter.from='2026-01-01'; __rptFilter.to='2026-12-31'; break;
    case 'jan':    __rptFilter.from='2026-01-01'; __rptFilter.to='2026-01-31'; break;
    case 'feb':    __rptFilter.from='2026-02-01'; __rptFilter.to='2026-02-28'; break;
    case 'mar':    __rptFilter.from='2026-03-01'; __rptFilter.to='2026-03-31'; break;
    case 'apr':    __rptFilter.from='2026-04-01'; __rptFilter.to='2026-04-30'; break;
    case 'may':    __rptFilter.from='2026-05-01'; __rptFilter.to='2026-05-31'; break;
    case 'last1w': __rptFilter.from='2026-05-11'; __rptFilter.to='2026-05-18'; break;
    case 'last4w': __rptFilter.from=isoMinusDays(28); __rptFilter.to=today; break;
    case 'last8w': __rptFilter.from=isoMinusDays(56); __rptFilter.to=today; break;
    case 'q1':     __rptFilter.from='2026-01-01'; __rptFilter.to='2026-03-31'; break;
    case 'q2':     __rptFilter.from='2026-04-01'; __rptFilter.to='2026-06-30'; break;
    case 'custom': break;
  }
  renderReports_analysis_();
}
function __rptApplyCustom_() {
  var f=document.getElementById('rpt-from'), t=document.getElementById('rpt-to');
  if(f&&t&&f.value&&t.value){ __rptFilter.from=f.value; __rptFilter.to=t.value; __rptFilter.preset='custom'; renderReports_analysis_(); }
}
function __rptFilteredWeeks_() {
  return __RPT_DATA.weeks.filter(function(w){ return w.s <= __rptFilter.to && w.e >= __rptFilter.from; });
}
function __rptPrevPeriod_() {
  var from = new Date(__rptFilter.from + 'T00:00:00Z');
  var to   = new Date(__rptFilter.to   + 'T00:00:00Z');
  var days = Math.round((to - from) / 86400000) + 1;
  var prevTo   = new Date(from.getTime() - 86400000);
  var prevFrom = new Date(prevTo.getTime() - (days-1) * 86400000);
  var pfISO = prevFrom.toISOString().slice(0,10);
  var ptISO = prevTo.toISOString().slice(0,10);
  return {
    from: pfISO, to: ptISO,
    weeks: __RPT_DATA.weeks.filter(function(w){ return w.s <= ptISO && w.e >= pfISO; })
  };
}
function __sumWeeks_(ws) {
  var t={p:0,b:0,c:0,g:0};
  ws.forEach(function(w){ t.p+=w.p; t.b+=w.b; t.c+=w.c; t.g+=w.g; });
  return t;
}
function __delta_(curr, prev) {
  if (prev === 0) return curr > 0 ? { pct: 100, dir: 'up' } : { pct: 0, dir: 'flat' };
  var d = ((curr - prev) / prev) * 100;
  return { pct: Math.abs(Math.round(d*10)/10), dir: d > 0.5 ? 'up' : d < -0.5 ? 'down' : 'flat' };
}
function __deltaPill_(d, inverseGood) {
  if (!d) return '';
  if (d.dir==='flat') return '<span style="font-size:10px;color:var(--muted)">~ stable</span>';
  var good = inverseGood ? (d.dir==='down') : (d.dir==='up');
  var col = good ? '#10b981' : '#ef4444';
  var arr = d.dir==='up' ? '↑' : '↓';
  return '<span style="font-size:10px;color:'+col+';font-weight:600">'+arr+' '+d.pct+'% vs prev</span>';
}

// ── SVG chart helpers ────────────────────────────────────────────────────────
function __svgDonut_(parts, colors, total, sizePx) {
  // parts: array of numbers; colors: matching array; total: sum; sizePx: visual diameter
  if (total === 0) total = 1;
  var r = 38, cx = 50, cy = 50;
  var circ = 2 * Math.PI * r;
  var offset = 0;
  var segs = '';
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] <= 0) continue;
    var len = (parts[i] / total) * circ;
    segs += '<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="none" stroke="'+colors[i]+'" stroke-width="14"'
         +' stroke-dasharray="'+len+' '+(circ - len)+'"'
         +' stroke-dashoffset="'+(-offset)+'"'
         +' transform="rotate(-90 '+cx+' '+cy+')" />';
    offset += len;
  }
  return '<svg viewBox="0 0 100 100" style="width:'+sizePx+'px;height:'+sizePx+'px;flex-shrink:0">'+segs
       +'<text x="50" y="48" text-anchor="middle" font-size="20" font-weight="800" fill="#e6edf3">'+total+'</text>'
       +'<text x="50" y="64" text-anchor="middle" font-size="9" fill="#8b949e">Total</text>'
       +'</svg>';
}
function __svgSparkline_(data, color, w, h) {
  if (!data.length) return '';
  var max = Math.max.apply(null, data) || 1;
  var min = Math.min.apply(null, data);
  var rng = max - min || 1;
  var pts = data.map(function(d, i){
    var x = data.length > 1 ? (i / (data.length - 1)) * w : w/2;
    var y = h - ((d - min) / rng) * (h - 4) - 2;
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  var areaPts = pts + ' ' + w + ',' + h + ' 0,' + h;
  var lastX = data.length > 1 ? w : w/2;
  var lastY = h - ((data[data.length-1] - min) / rng) * (h - 4) - 2;
  return '<svg viewBox="0 0 '+w+' '+h+'" style="width:100%;height:'+h+'px;display:block">'
    +'<polygon points="'+areaPts+'" fill="'+color+'" opacity="0.12"/>'
    +'<polyline points="'+pts+'" fill="none" stroke="'+color+'" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>'
    +'<circle cx="'+lastX.toFixed(1)+'" cy="'+lastY.toFixed(1)+'" r="2.5" fill="'+color+'"/>'
    +'</svg>';
}
function __svgMultiLine_(weeks, series, w, h) {
  // series: [{key:'p', color:'#7c3aed', label:'Promos'}, ...]
  var pad = { l: 30, r: 10, t: 14, b: 30 };
  var cw = w - pad.l - pad.r;
  var ch = h - pad.t - pad.b;
  // global max
  var maxVal = 0;
  weeks.forEach(function(wk){ series.forEach(function(s){ if(wk[s.key]>maxVal) maxVal=wk[s.key]; }); });
  if (maxVal === 0) maxVal = 1;
  var nice = Math.pow(10, Math.floor(Math.log10(maxVal)));
  var ticks = [0, Math.round(maxVal*0.25), Math.round(maxVal*0.5), Math.round(maxVal*0.75), maxVal];
  // X scale
  function xAt(i){ return pad.l + (weeks.length > 1 ? (i/(weeks.length-1))*cw : cw/2); }
  function yAt(v){ return pad.t + ch - (v/maxVal)*ch; }
  // Grid
  var grid = '';
  for (var k = 0; k < ticks.length; k++) {
    var y = yAt(ticks[k]);
    grid += '<line x1="'+pad.l+'" y1="'+y+'" x2="'+(w-pad.r)+'" y2="'+y+'" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2 3"/>';
    grid += '<text x="'+(pad.l-4)+'" y="'+(y+3)+'" text-anchor="end" font-size="8" fill="#8b949e">'+ticks[k]+'</text>';
  }
  // X labels
  var xLabs = '';
  weeks.forEach(function(wk, i){
    if (weeks.length > 12 && i % 2 !== 0 && i < weeks.length-1) return;
    var x = xAt(i);
    xLabs += '<text x="'+x+'" y="'+(h-pad.b+12)+'" text-anchor="middle" font-size="8" fill="#8b949e">'+wk.w+'</text>';
  });
  // Lines
  var lines = '';
  series.forEach(function(s){
    var pts = weeks.map(function(wk,i){ return xAt(i)+','+yAt(wk[s.key]); }).join(' ');
    lines += '<polyline points="'+pts+'" fill="none" stroke="'+s.color+'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    weeks.forEach(function(wk,i){ lines += '<circle cx="'+xAt(i)+'" cy="'+yAt(wk[s.key])+'" r="2" fill="'+s.color+'"/>'; });
  });
  // Legend
  var leg = series.map(function(s){
    return '<span style="display:inline-flex;align-items:center;gap:5px;margin-right:14px;font-size:10px;color:var(--muted)"><span style="width:10px;height:3px;background:'+s.color+';border-radius:1px"></span>'+s.label+'</span>';
  }).join('');
  return '<div style="font-size:11px;margin-bottom:8px">'+leg+'</div>'
    +'<svg viewBox="0 0 '+w+' '+h+'" style="width:100%;height:'+h+'px;display:block">'
      +grid + lines + xLabs
    +'</svg>';
}

// ── Tab navigation ───────────────────────────────────────────────────────────
function __rptTabBar_(active) {
  var a='padding:7px 14px;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;background:var(--accent);color:#fff';
  var i='padding:7px 14px;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px;background:var(--card2);color:var(--muted)';
  return '<div style="display:flex;gap:8px;margin-bottom:14px">'
    +'<button onclick="__rptNav_(\\'analysis\\')" style="'+(active==='analysis'?a:i)+'">📊 Executive Summary</button>'
    +'<button onclick="__rptNav_(\\'detail\\')" style="'+(active==='detail'?a:i)+'">📋 All Details</button>'
    +'<button onclick="__rptNav_(\\'files\\')" style="'+(active==='files'?a:i)+'">📁 Weekly Files</button>'
    +'</div>';
}
function __rptNav_(tab) {
  __rptTab = tab;
  if (tab==='analysis') renderReports_analysis_();
  else if (tab==='detail') renderReports_detail_();
  else renderReports_files_(__cachedRptFiles);
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

// ── Header + filter UI ───────────────────────────────────────────────────────
function __rptHeader_(weeks, prev) {
  var p = __rptFilter.preset;
  var label = (function(){
    if (p==='all') return 'Year-to-Date • Jan 1 – May 22, 2026';
    if (p==='last1w') return 'Week 20 • May 12 – May 18, 2026';
    if (p==='last4w') return 'Last 4 Weeks';
    if (p==='last8w') return 'Last 8 Weeks';
    if (p==='q1') return 'Q1 2026 • Jan – Mar';
    if (p==='q2') return 'Q2 2026 • Apr – Jun';
    if (p==='custom') return __rptFilter.from + ' → ' + __rptFilter.to;
    return p.charAt(0).toUpperCase()+p.slice(1) + ' 2026';
  })();
  var cmpLabel = prev.weeks.length ? 'Compared to ' + prev.from + ' – ' + prev.to : '';

  return '<div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px">'
    +'<div>'
      +'<div style="font-size:20px;font-weight:800;color:var(--text);display:flex;align-items:center;gap:8px">Weekly Operations Report <span style="font-size:14px">✨</span></div>'
      +'<div style="font-size:12px;color:var(--muted);margin-top:3px">'+label
        +(cmpLabel?' <span style="background:rgba(124,58,237,.15);color:var(--accent);padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;margin-left:6px">'+cmpLabel+'</span>':'')
      +'</div>'
    +'</div>'
    +'<div style="display:flex;gap:6px;align-items:center">'
      +'<button class="btn" onclick="alert(\\'Schedule report feature coming soon\\')" style="font-size:11px;padding:6px 10px">📅 Schedule</button>'
      +'<a class="btn" href="https://drive.google.com/drive/folders/1SvTyOPxDCVnPjmYU-XjMlOupQ2M1T_8P" target="_blank" style="text-decoration:none;font-size:11px;padding:6px 10px">↓ Export</a>'
      +'<button class="btn" onclick="__rptNav_(\\'files\\')" style="font-size:11px;padding:6px 10px;background:var(--accent);color:#fff;border:none">📤 Share Report</button>'
    +'</div>'
  +'</div>';
}
function __rptFilterBar_(weeks) {
  var p = __rptFilter.preset;
  function pill(id, label){
    var on = p===id;
    var st = on
      ? 'padding:5px 10px;border:none;border-radius:14px;background:var(--accent);color:#fff;font-size:11px;font-weight:600;cursor:pointer'
      : 'padding:5px 10px;border:1px solid var(--border);border-radius:14px;background:var(--card2);color:var(--muted);font-size:11px;cursor:pointer';
    return '<button onclick="__rptApplyPreset_(\\''+id+'\\')" style="'+st+'">'+label+'</button>';
  }
  return '<div class="card" style="padding:10px 14px;margin-bottom:14px">'
    +'<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px">'
      +'<span style="font-size:11px;font-weight:700;color:var(--muted);margin-right:4px">📅 RANGE:</span>'
      +pill('all','All YTD')+pill('q1','Q1')+pill('q2','Q2')
      +pill('jan','Jan')+pill('feb','Feb')+pill('mar','Mar')+pill('apr','Apr')+pill('may','May')
      +pill('last1w','Last 1W')+pill('last4w','Last 4W')+pill('last8w','Last 8W')
    +'</div>'
    +'<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);flex-wrap:wrap">'
      +'<span>Custom:</span>'
      +'<input type="date" id="rpt-from" value="'+__rptFilter.from+'" style="background:var(--card2);border:1px solid var(--border);color:var(--text);padding:3px 6px;border-radius:4px;font-size:11px;color-scheme:dark">'
      +'<span>→</span>'
      +'<input type="date" id="rpt-to" value="'+__rptFilter.to+'" style="background:var(--card2);border:1px solid var(--border);color:var(--text);padding:3px 6px;border-radius:4px;font-size:11px;color-scheme:dark">'
      +'<button onclick="__rptApplyCustom_()" style="padding:3px 10px;border:1px solid var(--accent);border-radius:4px;background:transparent;color:var(--accent);font-size:11px;cursor:pointer;font-weight:600">Apply</button>'
      +'<span style="margin-left:auto;font-size:10px">'+weeks.length+' of '+__RPT_DATA.weeks.length+' weeks</span>'
    +'</div>'
  +'</div>';
}

// ── KPI strip card ───────────────────────────────────────────────────────────
function __kpiCard_(icon, label, val, delta, color, inverseGood) {
  var pill = delta ? __deltaPill_(delta, inverseGood) : '';
  return '<div class="card" style="padding:12px 14px;margin:0;min-width:0">'
    +'<div style="display:flex;align-items:center;gap:10px">'
      +'<div style="width:34px;height:34px;border-radius:8px;background:'+color+'22;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">'+icon+'</div>'
      +'<div style="min-width:0;flex:1">'
        +'<div style="font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+label+'</div>'
        +'<div style="font-size:22px;font-weight:800;color:'+color+';line-height:1.1">'+val+'</div>'
        +'<div style="margin-top:2px">'+pill+'</div>'
      +'</div>'
    +'</div>'
  +'</div>';
}

// ── Module card ──────────────────────────────────────────────────────────────
function __moduleCard_(opts) {
  // opts: {icon, name, total, delta, color, weeks, key, monthSplit:{Jan,Feb,...}}
  var color = opts.color;
  var weeks = opts.weeks;
  var series = weeks.map(function(w){ return w[opts.key]; });
  var sparkline = __svgSparkline_(series, color, 200, 36);

  var months = Object.keys(opts.monthSplit);
  var values = months.map(function(m){ return opts.monthSplit[m]; });
  var monthColors = ['#7c3aed','#0ea5e9','#10b981','#f59e0b','#ef4444','#ec4899','#14b8a6'];
  var total = values.reduce(function(s,v){return s+v;},0);
  var donut = __svgDonut_(values, monthColors, total, 96);

  var legend = months.map(function(m, i){
    var v = opts.monthSplit[m];
    var pct = total ? Math.round(v/total*100) : 0;
    return '<div style="display:flex;align-items:center;gap:6px;font-size:10px;line-height:1.4">'
      +'<span style="width:8px;height:8px;background:'+monthColors[i]+';border-radius:2px;flex-shrink:0"></span>'
      +'<span style="color:var(--text);min-width:26px">'+m+'</span>'
      +'<span style="color:var(--muted)">'+v+' <span style="font-size:9px">('+pct+'%)</span></span>'
    +'</div>';
  }).join('');

  var best = Math.max.apply(null, series);
  var bestIdx = series.indexOf(best);
  var bestWeek = weeks[bestIdx] ? weeks[bestIdx].w : '—';
  var avg = series.length ? Math.round(series.reduce(function(s,v){return s+v;},0)/series.length) : 0;

  return '<div class="card" style="padding:14px;margin:0;display:flex;flex-direction:column">'
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">'
      +'<div style="width:32px;height:32px;border-radius:8px;background:'+color+'22;display:flex;align-items:center;justify-content:center;font-size:16px">'+opts.icon+'</div>'
      +'<div style="font-size:14px;font-weight:700;color:var(--text)">'+opts.name+'</div>'
    +'</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:12px;font-size:10px">'
      +'<div><div style="color:var(--muted);font-size:9px;text-transform:uppercase">Total</div><div style="font-size:18px;font-weight:800;color:'+color+'">'+opts.total+'</div></div>'
      +'<div><div style="color:var(--muted);font-size:9px;text-transform:uppercase">Best</div><div style="font-size:13px;font-weight:700;color:var(--text)">'+best+'<span style="font-size:9px;color:var(--muted);font-weight:400"> '+bestWeek+'</span></div></div>'
      +'<div><div style="color:var(--muted);font-size:9px;text-transform:uppercase">Avg/Wk</div><div style="font-size:13px;font-weight:700;color:var(--text)">'+avg+'</div></div>'
    +'</div>'
    +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'
      +donut
      +'<div style="flex:1;display:flex;flex-direction:column;gap:2px">'+legend+'</div>'
    +'</div>'
    +'<div style="margin-bottom:8px"><div style="font-size:9px;color:var(--muted);font-weight:600;text-transform:uppercase;margin-bottom:2px">Weekly Trend</div>'+sparkline+'</div>'
    +'<div style="margin-top:auto;padding-top:6px;border-top:1px solid var(--border)">'+__deltaPill_(opts.delta, false)+'</div>'
  +'</div>';
}

// ── Top delayed tasks (from S.tasks) ─────────────────────────────────────────
function __delayedTasksCard_() {
  var tasks = (S.tasks || []).filter(function(t){
    if (!t.Due_Date) return false;
    var d = String(t.Due_Date).slice(0,10);
    if (d >= '2026-05-22') return false;  // not overdue
    var status = String(t.Status || '').toLowerCase();
    if (/complete|done|closed/.test(status)) return false;
    return true;
  }).map(function(t){
    var due = new Date(String(t.Due_Date).slice(0,10) + 'T00:00:00Z');
    var today = new Date('2026-05-22T00:00:00Z');
    var hrs = Math.round((today - due) / 3600000);
    var dd = Math.floor(hrs/24);
    var hh = hrs - dd*24;
    var lbl = dd>0 ? dd+'d '+hh+'h' : hrs+'h';
    return {
      title: t.Title || '—',
      module: t.Module || '—',
      owner: typeof resolveOwnerNames_==='function' ? resolveOwnerNames_(t.Owner||'') : (t.Owner||'—'),
      delay: lbl,
      hrs: hrs,
    };
  }).sort(function(a,b){ return b.hrs - a.hrs; }).slice(0, 5);

  var rows = tasks.length ? tasks.map(function(t){
    return '<tr style="border-bottom:1px solid var(--border)">'
      +'<td style="padding:6px 8px;font-size:11px;color:var(--text);font-weight:500;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(t.title)+'</td>'
      +'<td style="padding:6px 8px;font-size:10px"><span style="background:var(--pill-bg);color:var(--accent);padding:2px 6px;border-radius:8px">'+esc(t.module)+'</span></td>'
      +'<td style="padding:6px 8px;font-size:11px;color:var(--text)">'+esc(t.owner||'—')+'</td>'
      +'<td style="padding:6px 8px;font-size:11px;color:#ef4444;font-weight:600;text-align:right;white-space:nowrap">↑ '+t.delay+'</td>'
    +'</tr>';
  }).join('') : '<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--muted);font-size:11px">🎉 No delayed tasks!</td></tr>';

  return '<div class="card" style="padding:0;margin:0;height:100%">'
    +'<div class="card-hdr"><h3>⚠️ Top Delayed Tasks</h3><a class="hint" onclick="nav(\\'tasks\\')" style="cursor:pointer">View all →</a></div>'
    +'<table style="width:100%;border-collapse:collapse">'
      +'<thead><tr style="border-bottom:1px solid var(--border)">'
        +'<th style="padding:6px 8px;text-align:left;font-size:9px;color:var(--muted);font-weight:600;text-transform:uppercase">Task</th>'
        +'<th style="padding:6px 8px;text-align:left;font-size:9px;color:var(--muted);font-weight:600;text-transform:uppercase">Module</th>'
        +'<th style="padding:6px 8px;text-align:left;font-size:9px;color:var(--muted);font-weight:600;text-transform:uppercase">Owner</th>'
        +'<th style="padding:6px 8px;text-align:right;font-size:9px;color:var(--muted);font-weight:600;text-transform:uppercase">Delay</th>'
      +'</tr></thead>'
      +'<tbody>'+rows+'</tbody>'
    +'</table>'
  +'</div>';
}

// ── Insights row (AI summary + positive / improve) ───────────────────────────
function __insightsRow_(t, prevT, weeks, prev) {
  var totalCurr = t.p + t.b + t.c + t.g;
  var totalPrev = prevT.p + prevT.b + prevT.c + prevT.g;
  var deltaTotal = __delta_(totalCurr, totalPrev);

  // Compute changes per module
  function changeRow(label, curr, prev, inverseGood) {
    var d = __delta_(curr, prev);
    if (!d || d.dir==='flat') return null;
    var good = inverseGood ? d.dir==='down' : d.dir==='up';
    return { label: label, pct: d.pct, dir: d.dir, good: good };
  }
  var changes = [
    changeRow('Promo Codes', t.p, prevT.p),
    changeRow('Banners', t.b, prevT.b),
    changeRow('CRM Campaigns', t.c, prevT.c),
    changeRow('New Games', t.g, prevT.g),
  ].filter(Boolean);

  var positives = changes.filter(function(c){return c.good;}).sort(function(a,b){return b.pct-a.pct;});
  var negatives = changes.filter(function(c){return !c.good;}).sort(function(a,b){return b.pct-a.pct;});

  // AI summary text
  var dirWord = deltaTotal.dir==='up' ? 'increased' : deltaTotal.dir==='down' ? 'decreased' : 'stayed flat';
  var summary = '';
  if (weeks.length === 0) {
    summary = 'No data in the selected range.';
  } else {
    summary = 'Total output ' + dirWord + ' by <strong>' + deltaTotal.pct + '%</strong> vs previous '+weeks.length+'-week period. ';
    if (weeks.length >= 4) {
      var promoTrend = weeks.map(function(w){return w.p;});
      var rising = promoTrend[promoTrend.length-1] > promoTrend[0];
      summary += 'Promo throughput is <strong>'+(rising?'rising':'falling')+'</strong> across the range. ';
    }
    if (negatives.length) {
      summary += '<strong>'+negatives[0].label+'</strong> saw the biggest dip ('+negatives[0].pct+'%) — investigate workload.';
    } else if (positives.length) {
      summary += '<strong>'+positives[0].label+'</strong> grew the most (+'+positives[0].pct+'%) — strong momentum.';
    }
  }

  function changeList(arr, color, arrow) {
    if (!arr.length) return '<div style="color:var(--muted);font-size:11px;padding:6px 0">No significant changes</div>';
    return arr.map(function(c){
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px">'
        +'<span style="color:var(--text)">'+arrow+' '+c.label+'</span>'
        +'<span style="color:'+color+';font-weight:700;font-size:11px">'+(c.dir==='up'?'+':'-')+c.pct+'%</span>'
      +'</div>';
    }).join('');
  }

  // Recommendations
  var recs = [];
  if (negatives.length) recs.push('Investigate <strong>'+negatives[0].label+'</strong> drop — check workload + blockers.');
  if (positives.length) recs.push('Replicate <strong>'+positives[0].label+'</strong> success pattern across other modules.');
  if (totalCurr / Math.max(1, weeks.length) > 80) recs.push('High volume sustained — consider rebalancing per-owner capacity.');
  if (recs.length < 3) recs.push('Sync banner production cadence to match promo code throughput.');
  if (recs.length < 3) recs.push('Continue automation rollout — current pace is on track.');

  return '<div style="display:grid;grid-template-columns:1.4fr 1fr 1fr 1.2fr;gap:12px">'
    +'<div class="card" style="padding:14px;margin:0">'
      +'<div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--text);margin-bottom:6px"><span style="font-size:14px">🤖</span> AI Summary</div>'
      +'<div style="font-size:12px;color:var(--text);line-height:1.5">'+summary+'</div>'
    +'</div>'
    +'<div class="card" style="padding:14px;margin:0">'
      +'<div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px"><span style="font-size:14px">📈</span> Top Positive Changes</div>'
      +changeList(positives.slice(0,3), '#10b981', '↑')
    +'</div>'
    +'<div class="card" style="padding:14px;margin:0">'
      +'<div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px"><span style="font-size:14px">⚠️</span> Areas to Improve</div>'
      +changeList(negatives.slice(0,3), '#ef4444', '↓')
    +'</div>'
    +'<div class="card" style="padding:14px;margin:0">'
      +'<div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px"><span style="font-size:14px">💡</span> AI Recommendations</div>'
      +'<div style="font-size:11px;color:var(--text);line-height:1.55">'+recs.slice(0,3).map(function(r){return '• '+r;}).join('<br>')+'</div>'
    +'</div>'
  +'</div>';
}

// ── MAIN ANALYSIS RENDER ─────────────────────────────────────────────────────
function renderReports_analysis_() {
  __rptTab = 'analysis';
  var weeks = __rptFilteredWeeks_();
  var prev  = __rptPrevPeriod_();
  var t  = __sumWeeks_(weeks);
  var tP = __sumWeeks_(prev.weeks);

  // Top KPI strip — 6 cards
  var totalCurr = t.p + t.b + t.c + t.g;
  var totalPrev = tP.p + tP.b + tP.c + tP.g;
  var avgCurr = weeks.length ? Math.round(totalCurr / weeks.length) : 0;
  var avgPrev = prev.weeks.length ? Math.round(totalPrev / prev.weeks.length) : 0;

  var kpis = '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:14px">'
    + __kpiCard_('📊','Total Output', totalCurr, __delta_(totalCurr, totalPrev), '#7c3aed', false)
    + __kpiCard_('🎯','Promo Codes', t.p, __delta_(t.p, tP.p), '#7c3aed', false)
    + __kpiCard_('🖼️','Banners', t.b, __delta_(t.b, tP.b), '#0ea5e9', false)
    + __kpiCard_('📧','CRM Campaigns', t.c, __delta_(t.c, tP.c), '#10b981', false)
    + __kpiCard_('🎮','New Games', t.g, __delta_(t.g, tP.g), '#f59e0b', false)
    + __kpiCard_('📅','Avg/Week', avgCurr, __delta_(avgCurr, avgPrev), '#ec4899', false)
  + '</div>';

  // Monthly split per module
  function monthSplit(key) {
    var ms = {};
    weeks.forEach(function(w){ if(!ms[w.mo]) ms[w.mo]=0; ms[w.mo]+=w[key]; });
    return ms;
  }

  // 4 module cards
  var moduleGrid = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px">'
    + __moduleCard_({icon:'🎯', name:'Promo Code',     color:'#7c3aed', total:t.p, delta:__delta_(t.p,tP.p), weeks:weeks, key:'p', monthSplit:monthSplit('p')})
    + __moduleCard_({icon:'🖼️', name:'Banner',         color:'#0ea5e9', total:t.b, delta:__delta_(t.b,tP.b), weeks:weeks, key:'b', monthSplit:monthSplit('b')})
    + __moduleCard_({icon:'📧', name:'CRM Assignment', color:'#10b981', total:t.c, delta:__delta_(t.c,tP.c), weeks:weeks, key:'c', monthSplit:monthSplit('c')})
    + __moduleCard_({icon:'🎮', name:'Game Addition',  color:'#f59e0b', total:t.g, delta:__delta_(t.g,tP.g), weeks:weeks, key:'g', monthSplit:monthSplit('g')})
  + '</div>';

  // Trend chart + delayed tasks
  var trendChart = '<div class="card" style="padding:14px;margin:0">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><div style="font-size:13px;font-weight:700;color:var(--text)">📈 Weekly Trend</div><div style="font-size:10px;color:var(--muted)">'+weeks.length+' weeks</div></div>'
    + (weeks.length ? __svgMultiLine_(weeks, [
        {key:'p', color:'#7c3aed', label:'Promo Codes'},
        {key:'b', color:'#0ea5e9', label:'Banners'},
        {key:'c', color:'#10b981', label:'CRM'},
        {key:'g', color:'#f59e0b', label:'New Games'},
      ], 600, 200) : '<div style="text-align:center;padding:30px;color:var(--muted);font-size:12px">No data in selected range</div>')
  +'</div>';

  var trendsRow = '<div style="display:grid;grid-template-columns:1.5fr 1fr;gap:12px;margin-bottom:14px">'
    + trendChart
    + __delayedTasksCard_()
  +'</div>';

  // Insights row
  var insights = __insightsRow_(t, tP, weeks, prev);

  content(
    __rptHeader_(weeks, prev)
    + __rptTabBar_('analysis')
    + __rptFilterBar_(weeks)
    + kpis
    + moduleGrid
    + trendsRow
    + insights
  );
}

// ── All Details tab — kept as the existing weekly table ──────────────────────
function renderReports_detail_() {
  __rptTab = 'detail';
  var weeks = __rptFilteredWeeks_();
  var wkRows = weeks.map(function(w){
    var hi = w.p >= 100;
    return '<tr style="border-bottom:1px solid var(--border)">'
      +'<td style="padding:6px 8px;font-family:monospace;font-size:10px;color:var(--muted)">'+w.w+'</td>'
      +'<td style="padding:6px 8px;font-size:11px;color:var(--muted);white-space:nowrap">'+w.d+'</td>'
      +'<td style="padding:6px 8px;text-align:right;font-size:12px;font-weight:'+(hi?'700':'400')+';color:'+(hi?'var(--accent)':'var(--text)')+'">'+w.p+'</td>'
      +'<td style="padding:6px 8px;text-align:right;font-size:12px;color:var(--text)">'+w.b+'</td>'
      +'<td style="padding:6px 8px;text-align:right;font-size:12px;color:var(--text)">'+w.c+'</td>'
      +'<td style="padding:6px 8px;text-align:right;font-size:12px;color:var(--text)">'+w.g+'</td>'
      +'</tr>';
  }).join('');
  var t = __sumWeeks_(weeks);
  content(
    __rptHeader_(weeks, __rptPrevPeriod_())
    + __rptTabBar_('detail')
    + __rptFilterBar_(weeks)
    + '<div class="card"><div class="card-hdr"><h3>📋 Weekly Breakdown</h3><span style="font-size:10px;color:var(--muted)">'+weeks.length+' week'+(weeks.length===1?'':'s')+'</span></div>'
      +'<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">'
        +'<thead><tr style="border-bottom:2px solid var(--border)">'
          +'<th style="padding:7px 8px;text-align:left;font-size:10px;color:var(--muted)">WK</th>'
          +'<th style="padding:7px 8px;text-align:left;font-size:10px;color:var(--muted)">DATES</th>'
          +'<th style="padding:7px 8px;text-align:right;font-size:10px;color:#7c3aed">PROMOS</th>'
          +'<th style="padding:7px 8px;text-align:right;font-size:10px;color:#0ea5e9">BANNERS</th>'
          +'<th style="padding:7px 8px;text-align:right;font-size:10px;color:#10b981">CRM</th>'
          +'<th style="padding:7px 8px;text-align:right;font-size:10px;color:#f59e0b">GAMES</th>'
        +'</tr></thead>'
        +'<tbody>'+wkRows+'</tbody>'
        +'<tfoot><tr style="border-top:2px solid var(--border)">'
          +'<td colspan="2" style="padding:8px;font-size:11px;font-weight:700">TOTAL</td>'
          +'<td style="padding:8px;text-align:right;font-size:14px;font-weight:800;color:#7c3aed">'+t.p+'</td>'
          +'<td style="padding:8px;text-align:right;font-size:14px;font-weight:800;color:#0ea5e9">'+t.b+'</td>'
          +'<td style="padding:8px;text-align:right;font-size:14px;font-weight:800;color:#10b981">'+t.c+'</td>'
          +'<td style="padding:8px;text-align:right;font-size:14px;font-weight:800;color:#f59e0b">'+t.g+'</td>'
        +'</tr></tfoot>'
      +'</table></div></div>'
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

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V44 — Weekly Operations Report layout (KPIs + module cards + trend + insights) ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V44: Weekly Operations Report',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('\nhttps://script.google.com/macros/s/AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ/exec');
